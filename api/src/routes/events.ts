import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { issueToken, normalizeEmail, requireEventAccess, requireUser, tokenActionUrl } from '../lib/auth.js';
import { briefCompletion, mergedRsvpSettings, RsvpSettingsSchema } from '../lib/brief.js';
import { publish, subscribe } from '../lib/bus.js';
import { BLOCK_SECTIONS, LANGUAGES } from '../lib/catalogue.js';
import { AppError, conflict, notFound, unprocessable } from '../lib/errors.js';
import { addMonths, parseDateOnly } from '../lib/format.js';
import { PaginationQuery, pageArgs, pageResult } from '../lib/pagination.js';
import { eventDto, guestDto, inviteeDto, userDto } from '../lib/serializers.js';
import { themeFitsProduct, themeProductWhere } from '../lib/themes.js';
import { eventShareText, SHARE_TEXT_LOCALES, shareLocale, shareSubject, type ShareLocale } from '../lib/share-text.js';
import { sendNow, enqueueMessage } from '../services/messaging/index.js';
import { inviteUrl, provisionEvent } from '../services/provisioning.js';
import { eventStats } from '../services/stats.js';
import { normalizeExtras, normalizeSections } from '../services/pricing.js';
import { addonPaymentRequired, entitlements, missingAddons, paidExtras } from '../services/entitlements.js';
import { addonByCode, ADDONS, extraLanguageCount, isRepeatableAddon } from '../lib/addons.js';
import { assertAddonsEnabled, disabledAddonCodes } from '../lib/features.js';
import { includedInPlan, trimExtraLanguages } from '../services/pricing.js';
import type { PlanCode } from '@prisma/client';
import { EventParams, ExtrasField, rl, type ZApp } from './types.js';
import { queryBoolDefault } from '../lib/query.js';

const LANGUAGE_CODES = new Set<string>(LANGUAGES.map((l) => l.code));
/** Languages arrive as plain strings; unsupported codes and more than 8 are 422 (checked in the handlers). */
export const Languages = z.array(z.string().trim().max(30)).min(1).max(50);
const MAX_EVENT_LANGUAGES = 8;
export function assertLanguages(languages: string[]) {
  const bad = languages.filter((l) => !LANGUAGE_CODES.has(l) && !/^x-[a-z0-9-]{1,20}$/.test(l));
  if (bad.length) throw unprocessable('INVALID_SELECTION', `Unsupported language "${bad[0]}".`, { languages: bad.join(', ') });
  if (new Set(languages).size > MAX_EVENT_LANGUAGES) throw unprocessable('INVALID_SELECTION', `Up to ${MAX_EVENT_LANGUAGES} languages per event.`, { languages: 'Too many' });
}

/**
 * Before payment: the selection holds exactly the extra_language units the languages need beyond the plan cap
 * (added when languages grow, removed when they shrink). They are charged at checkout.
 */
export async function topUpExtraLanguages(languages: string[], planCode: PlanCode, selected: string[]) {
  const plan = await prisma.plan.findUnique({ where: { code: planCode } });
  const need = Math.max(0, new Set(languages).size - (plan?.maxLanguages ?? 1));
  const have = extraLanguageCount(selected);
  if (need === have) return selected;
  if (need > have) return [...selected, ...Array.from({ length: need - have }, () => 'extra_language')];
  return trimExtraLanguages(selected, need);
}
const HostNames = z.object({ partner1: z.string().trim().max(80).optional(), partner2: z.string().trim().max(80).optional(), honoree: z.string().trim().max(80).optional() });
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const Timezone = z.string().max(64).refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown timezone');

/** Validate self-serve add-on picks against the diy plan (repeatable add-ons keep one entry per unit). */
async function validateSelfServeExtras(codes: string[]) {
  const extras = normalizeExtras(codes);
  if (!extras.length) return extras;
  const allowed = new Set((await prisma.planExtra.findMany({ where: { planCode: 'diy', extra: { active: true } }, select: { extraCode: true } })).map((p) => p.extraCode));
  for (const e of extras) if (!allowed.has(e)) throw unprocessable('INVALID_SELECTION', `Extra "${e}" is not available for the self-serve plan.`, { extras: e });
  assertAddonsEnabled(extras);
  return extras;
}

/**
 * Languages ≤ plan limit + one per extra_language (selected before paying, or purchased).
 * After payment, going over → 402 ADDON_PAYMENT_REQUIRED (buy extra_language × n with the add-ons checkout);
 * before payment → 422 (select more extra_language units in the Extras step).
 */
export async function assertLanguageLimit(languages: string[], planCode: PlanCode | null, selected: string[], purchased: string[], paidEventId?: string) {
  const plan = planCode ? await prisma.plan.findUnique({ where: { code: planCode } }) : null;
  const base = plan?.maxLanguages ?? 1;
  const max = base + extraLanguageCount([...selected, ...purchased]);
  if (languages.length > max && paidEventId) {
    throw addonPaymentRequired(paidEventId, [{ code: 'extra_language', qty: languages.length - max }], `Your plan includes up to ${max} language(s). Buy one "extra_language" add-on per additional language.`);
  }
  if (languages.length > max) {
    throw unprocessable('INVALID_SELECTION', `Your plan includes up to ${base} language(s)${max > base ? ` (${max} with your extra language add-ons)` : ''}. Add an "extra_language" add-on for each additional language.`, { languages: 'Too many' });
  }
}

export default async function events(app: ZApp) {
  app.get('/api/events', { schema: { tags: ['events'], summary: 'Events I belong to' } }, async (req) => {
    const user = requireUser(req);
    const rows = await prisma.eventMember.findMany({
      where: { userId: user.id, event: { deletedAt: null } },
      include: { event: { include: { invitations: { orderBy: { createdAt: 'asc' }, take: 1 } } } },
      orderBy: { createdAt: 'desc' },
    });
    return { items: rows.map((m) => eventDto(m.event, { myRole: m.role })) };
  });

  app.post(
    '/api/events',
    {
      schema: {
        tags: ['events'],
        summary: 'Create a self-serve event (free draft; publishing requires the self-serve plan)',
        body: z.object({
          product: z.enum(['wedding_invite', 'save_the_date', 'birthday']).default('wedding_invite'),
          hostNames: HostNames,
          eventDate: DateOnly.nullish(),
          timezone: Timezone.optional(),
          venueName: z.string().trim().max(200).nullish(),
          venueAddress: z.string().trim().max(400).nullish(),
          /** Over the diy cap (2) auto-adds extra_language × n to selectedExtras; unsupported code or > 8 → 422. */
          languages: Languages.default(['en']),
          /** Add-ons picked in the Extras step (stored as selectedExtras, charged at pay-to-publish). Repeat extra_language per extra language. */
          extras: ExtrasField.default([]),
          themeKey: z.string().max(80).nullish(),
          sections: z.array(z.string().max(80)).max(30).default(['our_story', 'timeline', 'faq']),
        }),
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const b = req.body;
      const theme = b.themeKey ? await prisma.theme.findUnique({ where: { key: b.themeKey } }) : await prisma.theme.findFirst({ where: { ...themeProductWhere(b.product), status: 'active' }, orderBy: { sort: 'asc' } });
      if (b.themeKey && (!theme || theme.status === 'retired' || !themeFitsProduct(theme, b.product))) throw unprocessable('INVALID_SELECTION', 'Unknown design for this product.', { themeKey: 'Invalid' });
      const { sections, customNames } = normalizeSections(b.sections);
      assertLanguages(b.languages);
      const selectedExtras = await topUpExtraLanguages(b.languages, 'diy', await validateSelfServeExtras(b.extras));
      const created = await prisma.$transaction((tx) =>
        provisionEvent(tx, {
          email: user.email,
          product: b.product,
          planCode: null,
          serviceMode: 'self_serve',
          hostNames: b.hostNames as Record<string, string>,
          eventDate: parseDateOnly(b.eventDate),
          timezone: b.timezone,
          venueName: b.venueName,
          venueAddress: b.venueAddress,
          languages: b.languages,
          themeId: theme?.id ?? null,
          sections,
          customNames,
          extras: [],
          hasRsvp: b.product !== 'save_the_date',
        }),
      );
      const event = await prisma.event.update({ where: { id: created.event.id }, data: { selectedExtras }, include: { invitations: true } });
      return reply.code(201).send(eventDto(event, { myRole: 'owner' }));
    },
  );

  app.get('/api/events/:id', { schema: { tags: ['events'], params: EventParams } }, async (req) => {
    const { event, role } = await requireEventAccess(req, req.params.id, 'read');
    const [invitations, brief, revisions] = await Promise.all([
      prisma.invitation.findMany({ where: { eventId: event.id }, orderBy: { createdAt: 'asc' } }),
      prisma.brief.findUnique({ where: { eventId: event.id } }),
      prisma.revision.findMany({ where: { eventId: event.id }, select: { status: true } }),
    ]);
    const daysToEvent = event.eventDate ? Math.ceil((event.eventDate.getTime() - Date.now()) / 86_400_000) : null;
    const ent = await entitlements(event);
    return eventDto(
      { ...event, invitations },
      {
        myRole: role,
        daysToEvent,
        purchasedExtras: ent.purchased,
        maxLanguages: ent.languageLimit,
        brief: brief ? { status: brief.status, locked: brief.locked, newSections: brief.newSections, completion: briefCompletion(brief.sections, brief.data as any) } : null,
        revisions: event.serviceMode === 'studio' ? { max: event.maxRevisionRounds, used: revisions.length, open: revisions.some((r) => r.status !== 'completed') } : null,
      },
    );
  });

  // Add-ons dialog data: what's bought, what can still be bought, and what the draft uses but isn't paid.
  app.get('/api/events/:id/addons', { schema: { tags: ['events'], summary: 'Purchased, available and missing add-ons (feeds the Add-ons checkout dialog)', params: EventParams } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'read');
    const ent = await entitlements(event);
    const off = new Set(disabledAddonCodes());
    const counts = new Map<string, number>();
    for (const c of ent.purchased) counts.set(c, (counts.get(c) ?? 0) + 1);
    const offered = ent.plan ? (await prisma.planExtra.findMany({ where: { planCode: ent.plan.code, extra: { active: true } }, include: { extra: true } })).map((pe) => pe.extra) : [];
    const sort = (code: string) => addonByCode(code)?.sort ?? 99;
    const inv = await prisma.invitation.findFirst({ where: { eventId: event.id }, orderBy: { createdAt: 'asc' }, select: { id: true, config: true } });
    return {
      eventId: event.id,
      plan: ent.plan?.code ?? null,
      paid: ent.paid,
      purchased: [...counts].map(([code, qty]) => ({ code, qty })),
      included: ent.plan ? ADDONS.filter((a) => includedInPlan(ent.plan!, a.code) && !off.has(a.code)).map((a) => a.code) : [],
      available: offered
        .filter((e) => !off.has(e.code) && e.priceCents != null && !(ent.plan && includedInPlan(ent.plan, e.code)) && (isRepeatableAddon(e.code) || !counts.has(e.code)))
        .sort((a, b) => sort(a.code) - sort(b.code))
        .map((e) => ({ code: e.code, name: e.nameI18n, priceCents: e.priceCents!, currency: e.currency, ...(isRepeatableAddon(e.code) ? { maxQty: 20 } : {}) })),
      missing: await missingAddons(event, inv),
    };
  });

  app.patch(
    '/api/events/:id',
    {
      schema: {
        tags: ['events'],
        summary: 'Edit event details. Paid event with languages over the cap → 402 ADDON_PAYMENT_REQUIRED: details.missing[].qty = units still short (not the total needed).',
        params: EventParams,
        body: z.object({
          hostNames: HostNames.optional(),
          eventDate: DateOnly.nullish(),
          timezone: Timezone.optional(),
          venueName: z.string().trim().max(200).nullish(),
          venueAddress: z.string().trim().max(400).nullish(),
          languages: Languages.optional(),
          /** Self-serve, before payment only: replace the selected add-ons. */
          selectedExtras: ExtrasField.optional(),
          notifyOnRsvp: z.boolean().optional(),
          remindersEnabled: z.boolean().optional(),
          reminderDaysBefore: z.number().int().min(1).max(60).optional(),
        }),
      },
    },
    async (req) => {
      const { event, user } = await requireEventAccess(req, req.params.id, 'write');
      const b = req.body;
      const data: Record<string, unknown> = {};
      if (b.hostNames) {
        const names = { ...(event.hostNames as object), ...b.hostNames } as Record<string, string>;
        data.hostNames = names;
        data.title = event.product === 'birthday' || event.product === 'bridesmaid' ? names.honoree || event.title : [names.partner1, names.partner2].filter(Boolean).join(' & ') || event.title;
      }
      if (b.eventDate !== undefined) {
        const d = parseDateOnly(b.eventDate);
        data.eventDate = d;
        data.archiveAfter = d ? addMonths(d, config.ARCHIVE_AFTER_MONTHS) : null;
      }
      let selected = event.selectedExtras;
      if (b.selectedExtras) {
        if (event.serviceMode !== 'self_serve' || event.paidAt) throw new AppError(409, 'CONFLICT', 'Add-ons can only be selected before paying. Use the add-on checkout to buy more.');
        selected = await validateSelfServeExtras(b.selectedExtras);
        data.selectedExtras = selected;
      }
      if (b.languages) assertLanguages(b.languages);
      if (b.languages || b.selectedExtras) {
        const planCode = event.planCode ?? (event.serviceMode === 'self_serve' ? 'diy' : null);
        if (!event.paidAt && event.serviceMode === 'self_serve') {
          // Unpaid draft: never rejected for the cap; the missing extra_language units are selected instead.
          const topped = await topUpExtraLanguages(b.languages ?? event.languages, 'diy', selected);
          if (topped !== selected || b.selectedExtras) data.selectedExtras = topped;
        } else {
          await assertLanguageLimit(b.languages ?? event.languages, planCode, [], await paidExtras(event.id), event.id);
        }
      }
      if (b.languages) {
        data.languages = b.languages;
        data.primaryLanguage = b.languages[0];
      }
      for (const k of ['timezone', 'venueName', 'venueAddress', 'notifyOnRsvp', 'remindersEnabled', 'reminderDaysBefore'] as const) if (b[k] !== undefined) data[k] = b[k];
      const updated = await prisma.event.update({ where: { id: event.id }, data, include: { invitations: true } });
      await logActivity({ eventId: event.id, actorType: 'host', actorId: user.id, action: 'event.updated', data: { fields: Object.keys(data) } });
      return eventDto(updated);
    },
  );

  app.get('/api/events/:id/stats', { schema: { tags: ['events'], params: EventParams } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'read');
    return eventStats(event.id, event.invitesSentManual);
  });

  app.patch('/api/events/:id/invites-sent', { schema: { tags: ['events'], params: EventParams, body: z.object({ total: z.number().int().min(0).max(100000) }) } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'write');
    const updated = await prisma.event.update({ where: { id: event.id }, data: { invitesSentManual: req.body.total } });
    const stats = await eventStats(event.id, updated.invitesSentManual);
    publish(event.id, 'stats.updated', stats);
    return stats;
  });

  app.get('/api/events/:id/activity', { schema: { tags: ['events'], params: EventParams, querystring: PaginationQuery } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'read');
    const rows = await prisma.activityLog.findMany({ where: { eventId: event.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(req.query.cursor, req.query.limit) });
    const page = pageResult(rows, req.query.limit);
    return { items: page.items.map((a) => ({ id: a.id, action: a.action, actorType: a.actorType, data: a.data, createdAt: a.createdAt })), nextCursor: page.nextCursor };
  });

  /** Server-Sent Events: guest.created|updated|deleted, stats.updated, stage.changed, revision.updated, brief.updated, invitation.updated */
  app.get('/api/events/:id/stream', { schema: { tags: ['events'], params: EventParams } }, async (req, reply) => {
    const { event } = await requireEventAccess(req, req.params.id, 'read');
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...(req.headers.origin && config.corsOrigins.includes(req.headers.origin) ? { 'access-control-allow-origin': req.headers.origin, 'access-control-allow-credentials': 'true' } : {}),
    });
    res.write(`retry: 5000\nevent: ready\ndata: ${JSON.stringify({ eventId: event.id })}\n\n`);
    const unsub = subscribe(event.id, (m) => res.write(`event: ${m.type}\ndata: ${JSON.stringify(m)}\n\n`));
    const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      unsub();
    });
  });

  app.get('/api/events/:id/rsvp-settings', { schema: { tags: ['events'], params: EventParams } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'read');
    return mergedRsvpSettings(event.rsvpSettings);
  });

  app.patch('/api/events/:id/rsvp-settings', { schema: { tags: ['events'], params: EventParams, body: RsvpSettingsSchema } }, async (req) => {
    const { event, user } = await requireEventAccess(req, req.params.id, 'write');
    const merged = { ...mergedRsvpSettings(event.rsvpSettings), ...req.body };
    await prisma.event.update({ where: { id: event.id }, data: { rsvpSettings: merged } });
    await logActivity({ eventId: event.id, actorType: 'host', actorId: user.id, action: 'rsvp_settings.updated' });
    return merged;
  });

  // ── co-hosts ──
  app.get('/api/events/:id/members', { schema: { tags: ['events'], params: EventParams } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'read');
    const [members, pending] = await Promise.all([
      prisma.eventMember.findMany({ where: { eventId: event.id }, include: { user: true }, orderBy: { createdAt: 'asc' } }),
      prisma.authToken.findMany({ where: { eventId: event.id, purpose: 'cohost_invite', usedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    return {
      items: members.map((m) => ({ userId: m.userId, role: m.role, user: { id: m.user.id, email: m.user.email, name: m.user.name }, createdAt: m.createdAt })),
      pendingInvites: pending.map((t) => ({ email: t.email, role: (t.data as any)?.role ?? 'cohost', expiresAt: t.expiresAt })),
    };
  });

  app.post('/api/events/:id/members', { config: rl(app, 10, '1 minute'), schema: { tags: ['events'], params: EventParams, body: z.object({ email: z.string().trim().toLowerCase().email().max(255), role: z.enum(['cohost', 'viewer']).default('cohost') }) } }, async (req, reply) => {
    const { event, user } = await requireEventAccess(req, req.params.id, 'owner');
    const email = normalizeEmail(req.body.email);
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser && (await prisma.eventMember.findUnique({ where: { eventId_userId: { eventId: event.id, userId: existingUser.id } } }))) throw conflict('CONFLICT', 'This person already has access.');
    const raw = await issueToken({ purpose: 'cohost_invite', email, userId: existingUser?.id ?? null, eventId: event.id, data: { role: req.body.role, invitedBy: user.id } });
    await sendNow({ to: email, template: 'cohost_invite', data: { title: event.title, role: req.body.role === 'viewer' ? 'a viewer' : 'a co-host', inviterName: user.name ?? user.email, actionUrl: tokenActionUrl(raw) }, eventId: event.id });
    await logActivity({ eventId: event.id, actorType: 'host', actorId: user.id, action: 'member.invited', data: { email, role: req.body.role } });
    return reply.code(202).send({ ok: true, email, role: req.body.role });
  });

  app.patch('/api/events/:id/members/:userId', { schema: { tags: ['events'], params: EventParams.extend({ userId: z.string().uuid() }), body: z.object({ role: z.enum(['cohost', 'viewer']) }) } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'owner');
    const m = await prisma.eventMember.findUnique({ where: { eventId_userId: { eventId: event.id, userId: req.params.userId } } });
    if (!m) throw notFound('Member');
    if (m.role === 'owner') throw unprocessable('FORBIDDEN' as any, 'The owner role cannot be changed here.');
    await prisma.eventMember.update({ where: { eventId_userId: { eventId: event.id, userId: m.userId } }, data: { role: req.body.role } });
    return { userId: m.userId, role: req.body.role };
  });

  app.delete('/api/events/:id/members/:userId', { schema: { tags: ['events'], params: EventParams.extend({ userId: z.string().uuid() }) } }, async (req, reply) => {
    const { event, user } = await requireEventAccess(req, req.params.id, 'read');
    const isSelf = req.params.userId === user.id;
    if (!isSelf) await requireEventAccess(req, req.params.id, 'owner');
    const m = await prisma.eventMember.findUnique({ where: { eventId_userId: { eventId: event.id, userId: req.params.userId } } });
    if (!m) throw notFound('Member');
    if (m.role === 'owner') throw new AppError(422, 'FORBIDDEN', 'The owner cannot be removed.');
    await prisma.eventMember.delete({ where: { eventId_userId: { eventId: event.id, userId: m.userId } } });
    return reply.code(204).send();
  });

  // ── sharing ──
  app.get(
    '/api/events/:id/qr',
    { schema: { tags: ['events'], params: EventParams, querystring: z.object({ format: z.enum(['png', 'svg']).default('png'), size: z.coerce.number().int().min(128).max(2048).default(1024), inviteeId: z.string().uuid().optional(), download: queryBoolDefault(false) }) } },
    async (req, reply) => {
      const { event } = await requireEventAccess(req, req.params.id, 'read');
      const inv = await prisma.invitation.findFirst({ where: { eventId: event.id }, orderBy: { createdAt: 'asc' } });
      if (!inv) throw notFound('Invitation');
      let token: string | undefined;
      if (req.query.inviteeId) {
        const invitee = await prisma.invitee.findFirst({ where: { id: req.query.inviteeId, eventId: event.id, deletedAt: null } });
        if (!invitee) throw notFound('Invitee');
        token = invitee.token;
      }
      const url = inviteUrl(inv.slug, token);
      const filename = `qr-${inv.slug}.${req.query.format}`;
      if (req.query.download) reply.header('content-disposition', `attachment; filename="${filename}"`);
      reply.header('cache-control', 'private, max-age=300');
      if (req.query.format === 'svg') return reply.type('image/svg+xml').send(await QRCode.toString(url, { type: 'svg', margin: 2, width: req.query.size, errorCorrectionLevel: 'M' }));
      return reply.type('image/png').send(await QRCode.toBuffer(url, { type: 'png', margin: 2, width: req.query.size, errorCorrectionLevel: 'M' }));
    },
  );

  app.get('/api/events/:id/share-kit', { schema: { tags: ['events'], params: EventParams } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'read');
    const inv = await prisma.invitation.findFirst({ where: { eventId: event.id }, orderBy: { createdAt: 'asc' } });
    if (!inv) throw notFound('Invitation');
    const url = inviteUrl(inv.slug);
    const deadline = mergedRsvpSettings(event.rsvpSettings).deadline;
    const input = { title: event.title, hostNames: event.hostNames, eventDate: event.eventDate, deadline, url };
    const texts: Record<string, string> = {};
    const untranslatedLanguages: string[] = [];
    for (const lang of event.languages) {
      const locale = shareLocale(lang);
      // Only hand-written templates are returned. English is never served under another language's key.
      if (locale) texts[lang] = eventShareText(locale, input);
      else untranslatedLanguages.push(lang);
    }
    const textLocale: ShareLocale = shareLocale(event.primaryLanguage) ?? 'en';
    const primary = eventShareText(textLocale, input);
    const subject = shareSubject(textLocale, event.title);
    return {
      url,
      published: inv.status === 'published',
      texts,
      textLanguage: textLocale,
      untranslatedLanguages,
      supportedTextLanguages: [...SHARE_TEXT_LOCALES],
      whatsapp: `https://wa.me/?text=${encodeURIComponent(primary)}`,
      sms: `sms:?&body=${encodeURIComponent(primary)}`,
      email: { subject, body: primary, mailto: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(primary)}` },
      qr: { png: `${config.API_PUBLIC_URL}/api/events/${event.id}/qr?format=png`, svg: `${config.API_PUBLIC_URL}/api/events/${event.id}/qr?format=svg` },
    };
  });

  // ── privacy ──
  app.get('/api/events/:id/export-all', { schema: { tags: ['events'], summary: 'Data export (JSON) of everything stored for this event', params: EventParams } }, async (req, reply) => {
    const { event } = await requireEventAccess(req, req.params.id, 'owner');
    const [brief, invitations, guests, invitees, revisions, tables, members] = await Promise.all([
      prisma.brief.findUnique({ where: { eventId: event.id } }),
      prisma.invitation.findMany({ where: { eventId: event.id } }),
      prisma.guest.findMany({ where: { eventId: event.id }, include: { companions: true, invitee: true } }),
      prisma.invitee.findMany({ where: { eventId: event.id } }),
      prisma.revision.findMany({ where: { eventId: event.id } }),
      prisma.seatingTable.findMany({ where: { eventId: event.id }, include: { assignments: true } }),
      prisma.eventMember.findMany({ where: { eventId: event.id }, include: { user: true } }),
    ]);
    reply.header('content-disposition', `attachment; filename="event-${event.id}.json"`);
    return {
      exportedAt: new Date().toISOString(),
      event: eventDto(event),
      members: members.map((m) => ({ role: m.role, user: userDto(m.user) })),
      brief,
      invitations: invitations.map((i) => ({ ...i, previewToken: undefined })),
      guests: guests.map(guestDto),
      invitees: invitees.map((i) => inviteeDto(i)),
      revisions,
      seating: tables,
    };
  });

  app.post('/api/events/:id/delete-request', { schema: { tags: ['events'], params: EventParams } }, async (req, reply) => {
    const { event, user } = await requireEventAccess(req, req.params.id, 'owner');
    await prisma.event.update({ where: { id: event.id }, data: { deletionRequestedAt: new Date() } });
    await enqueueMessage({ to: config.STUDIO_INBOX, template: 'deletion_request_studio', data: { title: event.title, eventId: event.id, email: user.email }, eventId: event.id, idempotencyKey: `delete-request:${event.id}` });
    await logActivity({ eventId: event.id, actorType: 'host', actorId: user.id, action: 'event.deletion_requested' });
    return reply.code(202).send({ ok: true });
  });

  void BLOCK_SECTIONS;
}
