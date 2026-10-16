import { z } from 'zod';
import type { Event, Invitation, Invitee, Theme } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { giftForDisplay, mergedRsvpSettings } from '../lib/brief.js';
import { publish } from '../lib/bus.js';
import { DIETARY_TAGS } from '../lib/catalogue.js';
import { hmac, randomToken, safeEqual, sha256 } from '../lib/crypto.js';
import { AppError, notFound } from '../lib/errors.js';
import { isoDate } from '../lib/format.js';
import { buildIcs } from '../lib/ics.js';
import { guestDto } from '../lib/serializers.js';
import { publicTrackUrl } from '../lib/music.js';
import { collectUuids } from '../lib/theme-engine.js';
import { applyRsvpRules, companionCreates, guestInclude, RsvpInput, unseatIfNotAttending } from '../services/guests.js';
import { enqueueMessage, sendNow } from '../services/messaging/index.js';
import { inviteUrl, panelUrl } from '../services/provisioning.js';
import { eventStats } from '../services/stats.js';
import { signedAssetUrl } from '../services/storage/index.js';
import { unsubscribeUrl } from '../services/campaigns.js';
import { rl, type ZApp } from './types.js';
import { liveSnapshot } from '../services/invitations.js';

type Loaded = Invitation & { theme: Theme | null; event: Event };
const SlugParams = z.object({ slug: z.string().min(1).max(80) });

/**
 * Resolve a slug, or an old slug kept in invitation_slug_redirects after a custom_link rename (RSVPs and other
 * writes on old links are forwarded to the current invitation).
 * Guests get the live snapshot (`publishedVersion`); a valid preview token shows the draft.
 */
async function loadInvitation(slug: string, preview?: string): Promise<{ inv: Loaded; isPreview: boolean; aliased: boolean }> {
  const s = slug.toLowerCase();
  let inv = await prisma.invitation.findUnique({ where: { slug: s }, include: { theme: true, event: true } });
  let aliased = false;
  if (!inv) {
    const alias = await prisma.invitationSlugRedirect.findUnique({ where: { oldSlug: s }, include: { invitation: { include: { theme: true, event: true } } } });
    if (alias) {
      inv = alias.invitation;
      aliased = true;
    }
  }
  if (!inv || inv.event.deletedAt) throw notFound('Invitation');
  const isPreview = !!preview && !!inv.previewToken && safeEqual(preview, inv.previewToken);
  if (inv.status === 'archived' && !isPreview) {
    throw new AppError(410, 'GONE', 'This celebration has passed. Thank you for being part of it.', undefined, { archived: { title: inv.event.title, eventDate: isoDate(inv.event.eventDate) } });
  }
  if (inv.status !== 'published' && !isPreview) throw notFound('Invitation');
  if (!isPreview) {
    const live = await liveSnapshot(inv);
    if (!live) throw notFound('Invitation');
    const theme = live.themeId === inv.themeId ? inv.theme : live.themeId ? await prisma.theme.findUnique({ where: { id: live.themeId } }) : null;
    inv = { ...inv, content: live.content, config: live.config, themeId: live.themeId, theme };
  }
  return { inv, isPreview, aliased };
}

/** True when the client prefers HTML over JSON (a browser page load rather than fetch()). */
function wantsHtml(accept?: string) {
  if (!accept) return false;
  const a = accept.toLowerCase();
  const html = a.indexOf('text/html');
  if (html < 0) return false;
  const json = a.indexOf('application/json');
  return json < 0 || html < json;
}

/** Guest-facing content: the gift block is reduced to its display fields (message, registry links, Interac, bank). */
function displayContent(c: unknown) {
  const content = (c ?? {}) as Record<string, any>;
  if (!content.sections?.gift_list) return content;
  return { ...content, sections: { ...content.sections, gift_list: giftForDisplay(content.sections.gift_list) } };
}

async function isDemo(slug: string) {
  return !!(await prisma.theme.findFirst({ where: { demoSlug: slug }, select: { id: true } }));
}

function rsvpState(event: Event, inv: Invitation, isPreview: boolean) {
  const s = mergedRsvpSettings(event.rsvpSettings);
  if (inv.kind === 'save_the_date') return { settings: s, open: false, reason: 'not_applicable' as const };
  if (isPreview && inv.status !== 'published') return { settings: s, open: false, reason: 'preview' as const };
  if (inv.status === 'archived') return { settings: s, open: false, reason: 'archived' as const };
  if (s.mode === 'closed') return { settings: s, open: false, reason: 'closed' as const };
  if (s.mode === 'open' || !s.deadline) return { settings: s, open: true, reason: null };
  // Open through the end of the deadline day in the event's timezone (approximated with +14h slack for far-east zones).
  const end = new Date(`${s.deadline}T23:59:59Z`).getTime() + 14 * 3600_000;
  return Date.now() <= end ? { settings: s, open: true, reason: null } : { settings: s, open: false, reason: 'deadline_passed' as const };
}

async function findInvitee(eventId: string, g?: string) {
  if (!g) return null;
  return prisma.invitee.findFirst({ where: { token: g, eventId, deletedAt: null } });
}

async function existingResponse(invitee: Invitee | null) {
  if (!invitee) return null;
  const g = await prisma.guest.findFirst({ where: { inviteeId: invitee.id, deletedAt: null }, include: guestInclude, orderBy: { submittedAt: 'desc' } });
  return g ? publicGuest(g) : null;
}

function publicGuest(g: any) {
  const d = guestDto(g);
  return { id: d.id, fullName: d.fullName, email: d.email, attendance: d.attendance, partySize: d.partySize, primaryMeal: d.primaryMeal, primaryDietary: d.primaryDietary, dietaryTags: d.dietaryTags, companions: d.companions, extraEvents: d.extraEvents, answers: d.answers, message: d.message, submittedAt: d.submittedAt };
}

// Short-lived idempotency cache for RSVP submissions (double-click / retry protection).
const idem = new Map<string, { at: number; status: number; body: unknown }>();
function idemGet(key: string) {
  const v = idem.get(key);
  if (v && Date.now() - v.at < 10 * 60_000) return v;
  idem.delete(key);
  return null;
}

async function afterRsvp(inv: Loaded, guest: any, kind: 'created' | 'updated', editToken: string | null) {
  const event = inv.event;
  await logActivity({ eventId: event.id, actorType: 'guest', action: `rsvp.${kind}`, data: { guestId: guest.id, name: guest.fullName, attendance: guest.attendance, partySize: guest.partySize } });
  publish(event.id, kind === 'created' ? 'guest.created' : 'guest.updated', { guest: guestDto(guest) });
  publish(event.id, 'stats.updated', await eventStats(event.id, event.invitesSentManual));
  if (event.notifyOnRsvp) {
    const owners = await prisma.eventMember.findMany({ where: { eventId: event.id, role: { in: ['owner', 'cohost'] } }, include: { user: true } });
    for (const o of owners) {
      await enqueueMessage({ to: o.user.email, template: 'rsvp_received_host', data: { guestName: guest.fullName, attendance: guest.attendance, partySize: guest.partySize, message: guest.message, panelUrl: panelUrl(event.id) }, eventId: event.id, userId: o.userId });
    }
  }
  if (guest.email && editToken) {
    // Sent immediately: the link carries the guest's edit token, which is never persisted in plain text.
    await sendNow({
      to: guest.email,
      template: 'guest_rsvp_confirmation',
      eventId: event.id,
      inviteeId: guest.inviteeId,
      data: { guestName: guest.fullName, title: event.title, attendance: guest.attendance, dateText: isoDate(event.eventDate), editUrl: `${inviteUrl(inv.slug)}?rsvp=${guest.id}&edit=${encodeURIComponent(editToken)}`, unsubscribeUrl: guest.inviteeId ? unsubscribeUrl(guest.inviteeId) : undefined },
    }).catch(() => undefined);
  }
}

export default async function publicInvitations(app: ZApp) {
  const rsvpKey = (req: any) => `rsvp:${req.ip}:${String(req.params?.slug ?? '').toLowerCase()}`;

  app.get(
    '/api/public/invitations/:slug',
    { config: rl(app, 120, '1 minute'), schema: { tags: ['guest'], summary: 'Everything needed to render a guest invitation', params: SlugParams, querystring: z.object({ lang: z.string().max(20).optional(), g: z.string().max(100).optional(), preview: z.string().max(100).optional() }) } },
    async (req, reply) => {
      const { inv, isPreview, aliased } = await loadInvitation(req.params.slug, req.query.preview);
      // Page requests (browser navigation, Accept: text/html) for an old slug → 301 to the current invitation page,
      // keeping the query string (?g=, ?lang=, …). JSON clients get 200 with `invitation.redirectedFrom`.
      if (aliased && wantsHtml(req.headers.accept)) {
        const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        return reply.code(301).header('location', `${inviteUrl(inv.slug)}${qs}`).header('cache-control', 'no-store').send({ movedTo: inv.slug });
      }
      const event = inv.event;
      const content = (inv.content ?? {}) as Record<string, unknown>;
      const lang = req.query.lang && content[req.query.lang] ? req.query.lang : content[inv.locale] ? inv.locale : (Object.keys(content)[0] ?? inv.locale);
      const invitee = await findInvitee(event.id, req.query.g);
      const rsvp = rsvpState(event, inv, isPreview);
      const cfg = (inv.config ?? {}) as any;

      // Resolve referenced uploads to signed URLs (only assets that belong to this event).
      const ids = [...collectUuids(content[lang]), ...collectUuids(cfg)];
      const assets = ids.length ? await prisma.asset.findMany({ where: { id: { in: ids }, eventId: event.id, deletedAt: null } }) : [];
      const track = cfg.music?.trackId ? await prisma.musicTrack.findFirst({ where: { id: cfg.music.trackId, active: true } }) : null;

      reply.header('x-robots-tag', 'noindex, nofollow');
      reply.header('cache-control', isPreview || invitee ? 'private, no-store' : 'public, max-age=30');
      return {
        invitation: { id: inv.id, slug: inv.slug, redirectedFrom: aliased ? req.params.slug.toLowerCase() : null, kind: inv.kind, status: inv.status, version: isPreview ? inv.version : (inv.publishedVersion ?? inv.version), publishedVersion: inv.publishedVersion, defaultLanguage: inv.locale, preview: isPreview, demo: await isDemo(inv.slug) },
        theme: inv.theme ? { key: inv.theme.key, defaultConfig: inv.theme.defaultConfig } : null,
        config: cfg,
        languages: event.languages.filter((l) => content[l]),
        lang,
        content: displayContent(content[lang]),
        event: { title: event.title, hostNames: event.hostNames, eventDate: isoDate(event.eventDate), timezone: event.timezone, venueName: event.venueName, venueAddress: event.venueAddress },
        rsvp:
          inv.kind === 'save_the_date'
            ? null
            : {
                open: rsvp.open,
                closedReason: rsvp.reason,
                deadline: rsvp.settings.deadline,
                requireEmail: rsvp.settings.requireEmail,
                mealOptions: rsvp.settings.mealOptions,
                maxCompanions: invitee ? Math.max(invitee.maxPartySize - 1, 0) : rsvp.settings.maxCompanions,
                allowChildren: rsvp.settings.allowChildren,
                allergyChecklist: rsvp.settings.allergyChecklist,
                dietaryTags: DIETARY_TAGS,
                extraEvents: rsvp.settings.extraEvents,
                customQuestions: rsvp.settings.customQuestions,
              },
        invitee: invitee
          ? { firstName: invitee.firstName, lastName: invitee.lastName, householdName: invitee.householdName, maxPartySize: invitee.maxPartySize, knownCompanions: invitee.knownCompanions, language: invitee.language, existingResponse: await existingResponse(invitee) }
          : null,
        assets: Object.fromEntries(assets.map((a) => [a.id, { url: signedAssetUrl(a.id), mime: a.mime, kind: a.kind }])),
        music: track ? { title: track.title, artist: track.artist, url: publicTrackUrl(track.url), license: track.license, volume: cfg.music?.volume ?? 0.6, autoplayOnOpen: cfg.music?.autoplayOnOpen ?? true } : cfg.music?.assetId && assets.find((a) => a.id === cfg.music.assetId) ? { title: 'Custom track', url: signedAssetUrl(cfg.music.assetId), volume: cfg.music?.volume ?? 0.6, autoplayOnOpen: cfg.music?.autoplayOnOpen ?? true } : cfg.music?.externalUrl ? { title: 'Custom track', url: cfg.music.externalUrl, external: true, volume: cfg.music?.volume ?? 0.6, autoplayOnOpen: cfg.music?.autoplayOnOpen ?? true } : null,
        calendarUrl: event.eventDate ? `${config.API_PUBLIC_URL}/api/public/invitations/${inv.slug}/calendar.ics` : null,
      };
    },
  );

  app.post(
    '/api/public/invitations/:slug/open',
    { config: rl(app, 60, '1 minute'), schema: { tags: ['guest'], summary: 'Open analytics ping', params: SlugParams, body: z.object({ g: z.string().max(100).optional(), lang: z.string().max(20).optional() }).default({}) } },
    async (req, reply) => {
      const { inv, isPreview } = await loadInvitation(req.params.slug).catch(() => ({ inv: null, isPreview: false }) as any);
      if (inv && !isPreview && req.body.g) {
        const invitee = await findInvitee(inv.eventId, req.body.g);
        if (invitee) {
          await prisma.invitee.update({ where: { id: invitee.id }, data: { openCount: { increment: 1 }, lastOpenedAt: new Date(), ...(invitee.status === 'not_sent' || invitee.status === 'sent' ? { status: 'opened' } : {}) } });
        }
      }
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/public/invitations/:slug/rsvps',
    {
      config: app.limits.enabled ? { rateLimit: { max: app.limits.rsvpPerMinute, timeWindow: '1 minute', keyGenerator: rsvpKey } } : {},
      schema: { tags: ['guest'], summary: 'Submit an RSVP', params: SlugParams, headers: z.object({ 'idempotency-key': z.string().max(200).optional() }).passthrough(), body: RsvpInput },
    },
    async (req, reply) => {
      const idemKey = req.headers['idempotency-key'] as string | undefined;
      const cacheKey = idemKey ? `${req.params.slug}:${idemKey}` : null;
      if (cacheKey) {
        const hit = idemGet(cacheKey);
        if (hit) return reply.code(hit.status).send(hit.body);
      }
      const { inv } = await loadInvitation(req.params.slug);
      const b = req.body;
      // Honeypot: silently accept and drop bot submissions.
      if (b.website) return reply.code(201).send({ id: crypto.randomUUID(), editToken: randomToken(18), attendance: b.attendance, partySize: 1 + (b.attendance === 'yes' ? b.companions.length : 0) });
      const state = rsvpState(inv.event, inv, false);
      if (!state.open) throw new AppError(403, 'RSVP_CLOSED', state.reason === 'deadline_passed' ? 'Replies are closed. Please contact the hosts directly.' : 'Replies are not open for this invitation.', undefined, { reason: state.reason });
      if (await isDemo(inv.slug)) return reply.code(201).send({ id: crypto.randomUUID(), editToken: null, attendance: b.attendance, partySize: 1 + (b.attendance === 'yes' ? b.companions.length : 0), demo: true });

      const invitee = await findInvitee(inv.eventId, b.g);
      if (b.g && !invitee) throw new AppError(404, 'NOT_FOUND', 'This personal link is no longer valid.');
      if (invitee) {
        const existing = await prisma.guest.findFirst({ where: { inviteeId: invitee.id, deletedAt: null } });
        if (existing) throw new AppError(409, 'ALREADY_RESPONDED', 'You have already replied. You can edit your reply instead.', undefined, { guestId: existing.id });
      }
      const rules = applyRsvpRules(b, state.settings, { maxPartySize: invitee?.maxPartySize ?? null });
      const editToken = randomToken(24);
      const guest = await prisma.$transaction(async (tx) => {
        const g = await tx.guest.create({
          data: {
            eventId: inv.eventId,
            inviteeId: invitee?.id ?? null,
            fullName: b.fullName,
            email: b.email ?? null,
            attendance: b.attendance,
            partySize: rules.partySize,
            primaryMeal: rules.primaryMeal,
            primaryDietary: rules.primaryDietary,
            dietaryTags: rules.dietaryTags,
            extraEvents: rules.extraEvents,
            answers: rules.answers,
            message: b.message,
            source: 'rsvp_form',
            language: b.language,
            editTokenHash: sha256(editToken),
            ipHash: hmac(req.ip, 'ip'),
            userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
            companions: { create: companionCreates(rules.companions) },
          },
          include: guestInclude,
        });
        if (invitee) await tx.invitee.update({ where: { id: invitee.id }, data: { status: 'responded', respondedAt: new Date() } });
        return g;
      });
      await afterRsvp(inv, guest, 'created', editToken);
      const body = { id: guest.id, editToken, attendance: guest.attendance, partySize: guest.partySize };
      if (cacheKey) idem.set(cacheKey, { at: Date.now(), status: 201, body });
      return reply.code(201).send(body);
    },
  );

  async function authorizeGuestEdit(inv: Loaded, guestId: string, creds: { editToken?: string; g?: string }) {
    const guest = await prisma.guest.findFirst({ where: { id: guestId, eventId: inv.eventId, deletedAt: null }, include: guestInclude });
    if (!guest) throw notFound('Reply');
    const byToken = !!creds.editToken && !!guest.editTokenHash && safeEqual(sha256(creds.editToken), guest.editTokenHash);
    const byInvitee = !!creds.g && !!guest.invitee && safeEqual(creds.g, guest.invitee.token);
    if (!byToken && !byInvitee) throw notFound('Reply'); // don't reveal existence
    return guest;
  }

  app.get(
    '/api/public/invitations/:slug/rsvps/:guestId',
    { config: rl(app, 30, '1 minute'), schema: { tags: ['guest'], summary: 'Read my own reply (editToken or personal link token)', params: SlugParams.extend({ guestId: z.string().uuid() }), querystring: z.object({ editToken: z.string().max(100).optional(), g: z.string().max(100).optional() }) } },
    async (req) => {
      const { inv } = await loadInvitation(req.params.slug);
      return publicGuest(await authorizeGuestEdit(inv, req.params.guestId, req.query));
    },
  );

  app.patch(
    '/api/public/invitations/:slug/rsvps/:guestId',
    {
      config: app.limits.enabled ? { rateLimit: { max: app.limits.rsvpPerMinute, timeWindow: '1 minute', keyGenerator: rsvpKey } } : {},
      schema: { tags: ['guest'], summary: 'Edit my reply', params: SlugParams.extend({ guestId: z.string().uuid() }), body: RsvpInput.extend({ editToken: z.string().max(100).optional() }) },
    },
    async (req) => {
      const { inv } = await loadInvitation(req.params.slug);
      const b = req.body;
      const guest = await authorizeGuestEdit(inv, req.params.guestId, { editToken: b.editToken, g: b.g });
      const state = rsvpState(inv.event, inv, false);
      if (!state.open) throw new AppError(403, 'RSVP_CLOSED', 'Replies are closed. Please contact the hosts directly.', undefined, { reason: state.reason });
      const rules = applyRsvpRules(b, state.settings, { maxPartySize: guest.invitee?.maxPartySize ?? null });
      const updated = await prisma.$transaction(async (tx) => {
        await tx.guestCompanion.deleteMany({ where: { guestId: guest.id } });
        await tx.guest.update({
          where: { id: guest.id },
          data: {
            fullName: b.fullName,
            email: b.email ?? null,
            attendance: b.attendance,
            partySize: rules.partySize,
            primaryMeal: rules.primaryMeal,
            primaryDietary: rules.primaryDietary,
            dietaryTags: rules.dietaryTags,
            extraEvents: rules.extraEvents,
            answers: rules.answers,
            message: b.message,
            language: b.language,
            companions: { create: companionCreates(rules.companions) },
          },
        });
        await unseatIfNotAttending(guest.id, b.attendance, tx);
        return tx.guest.findUniqueOrThrow({ where: { id: guest.id }, include: guestInclude });
      });
      await afterRsvp(inv, updated, 'updated', null);
      return publicGuest(updated);
    },
  );

  app.get('/api/public/invitations/:slug/calendar.ics', { config: rl(app, 60, '1 minute'), schema: { tags: ['guest'], params: SlugParams } }, async (req, reply) => {
    const { inv } = await loadInvitation(req.params.slug);
    const e = inv.event;
    if (!e.eventDate) throw notFound('Event date');
    const content = (inv.content as any)?.[inv.locale];
    const firstVenue = content?.sections?.venue?.items?.[0];
    const ics = buildIcs({
      uid: `${inv.id}@invitations`,
      title: e.title,
      date: isoDate(e.eventDate)!,
      startTime: firstVenue?.startsAt && /^\d{2}:\d{2}$/.test(firstVenue.startsAt) ? firstVenue.startsAt : null,
      timezone: e.timezone,
      location: [e.venueName, e.venueAddress].filter(Boolean).join(', ') || null,
      url: inviteUrl(inv.slug),
    });
    reply.header('content-disposition', `attachment; filename="${inv.slug}.ics"`);
    return reply.type('text/calendar; charset=utf-8').send(ics);
  });
}
