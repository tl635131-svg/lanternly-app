import { z } from 'zod';
import type { Prisma, ProductionStage } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { isStudio, issueToken, normalizeEmail, requireRole, studioCanAccess, tokenActionUrl } from '../lib/auth.js';
import { publish } from '../lib/bus.js';
import { briefCompletion } from '../lib/brief.js';
import { AppError, conflict, notFound, unprocessable, validation } from '../lib/errors.js';
import { addMonths, i18nName, isoDate, parseDateOnly } from '../lib/format.js';
import { pageArgs, pageResult } from '../lib/pagination.js';
import { eventDto, revisionDto, themeDto, userDto } from '../lib/serializers.js';
import { contentFromBrief } from '../lib/theme-engine.js';
import { enqueueMessage, sendNow } from '../services/messaging/index.js';
import { normalizeSections } from '../services/pricing.js';
import { inviteUrl, panelUrl, provisionEvent, sendAccessEmail } from '../services/provisioning.js';
import { eventStats } from '../services/stats.js';
import {
  InvitationUpdateInput,
  invitationFullDto,
  listVersions,
  publishInvitation,
  rollbackInvitation,
  discardDraft,
  rotatePreviewToken,
  unpublishInvitation,
  updateInvitation,
  linkState,
} from '../services/invitations.js';
import { applyBriefPatch, briefResponse } from './brief.js';
import { revisionsSummary } from './revisions.js';
import { EventParams, ExtrasField, rejectRemovedFields, type ZApp } from './types.js';
import { assertLanguageLimit, assertLanguages, Languages, topUpExtraLanguages } from './events.js';
import { paidExtras } from '../services/entitlements.js';
import { createManualOrder, refundOrder } from '../services/orders.js';
import { computeQuote } from '../services/pricing.js';
import { queryBool } from '../lib/query.js';
import { EXTRA_BRIEF_SECTIONS, isRushAddon } from '../lib/addons.js';
import { themeFitsProduct } from '../lib/themes.js';

const STAGES: ProductionStage[] = ['order_received', 'brief_received', 'in_queue', 'designing', 'review', 'delivered'];
const StageEnum = z.enum(STAGES as [ProductionStage, ...ProductionStage[]]);
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const I18n = z.record(z.string().max(20), z.string().max(2000));

async function loadStudioEvent(req: any, id: string) {
  const user = requireRole(req, 'admin', 'staff');
  const event = await prisma.event.findFirst({ where: { id, deletedAt: null } });
  if (!event || !studioCanAccess(user, event)) throw notFound('Event');
  return { user, event };
}

async function loadStudioInvitation(req: any, invitationId: string) {
  const user = requireRole(req, 'admin', 'staff');
  const inv = await prisma.invitation.findUnique({ where: { id: invitationId }, include: { event: true, theme: true } });
  if (!inv || inv.event.deletedAt || !studioCanAccess(user, inv.event)) throw notFound('Invitation');
  return { user, inv };
}

async function ownersOf(eventId: string) {
  return prisma.eventMember.findMany({ where: { eventId, role: 'owner' }, include: { user: true } });
}

async function setStage(eventId: string, stage: ProductionStage, actorId: string) {
  const updated = await prisma.event.update({ where: { id: eventId }, data: { productionStage: stage, ...(stage === 'delivered' ? { deliveredAt: new Date() } : {}) } });
  if (stage === 'delivered') await prisma.brief.updateMany({ where: { eventId }, data: { status: 'archived', locked: true } });
  await logActivity({ eventId, actorType: 'admin', actorId, action: 'stage.changed', data: { stage } });
  publish(eventId, 'stage.changed', { stage });
  return updated;
}

export default async function admin(app: ZApp) {
  // ───── pipeline ─────
  app.get(
    '/api/admin/events',
    {
      schema: {
        tags: ['admin'],
        summary: 'Pipeline list (staff see assigned events only)',
        querystring: z.object({
          stage: StageEnum.optional(),
          product: z.enum(['wedding_invite', 'save_the_date', 'birthday', 'bridesmaid']).optional(),
          serviceMode: z.enum(['self_serve', 'studio']).optional(),
          q: z.string().trim().max(100).optional(),
          sort: z.enum(['eventDate', 'createdAt']).default('eventDate'),
          cursor: z.string().max(200).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req) => {
      const user = requireRole(req, 'admin', 'staff');
      const q = req.query;
      const where: Prisma.EventWhereInput = {
        deletedAt: null,
        ...(user.role === 'staff' ? { assignedStaffId: user.id } : {}),
        ...(q.stage ? { productionStage: q.stage } : {}),
        ...(q.product ? { product: q.product } : {}),
        ...(q.serviceMode ? { serviceMode: q.serviceMode } : {}),
        ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { members: { some: { user: { email: { contains: q.q, mode: 'insensitive' } } } } }, { venueName: { contains: q.q, mode: 'insensitive' } }] } : {}),
      };
      const rows = await prisma.event.findMany({
        where,
        include: { invitations: { take: 1, orderBy: { createdAt: 'asc' } }, brief: { select: { status: true, sections: true, data: true } }, assignedStaff: { select: { id: true, name: true, email: true } } },
        orderBy: q.sort === 'eventDate' ? [{ eventDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(q.cursor, q.limit),
      });
      const page = pageResult(rows, q.limit);
      const ids = page.items.map((e) => e.id);
      const counts = ids.length ? await prisma.guest.groupBy({ by: ['eventId', 'attendance'], where: { eventId: { in: ids }, deletedAt: null }, _count: { _all: true } }) : [];
      return {
        items: page.items.map((e) => {
          const c = (a: string) => counts.find((x) => x.eventId === e.id && x.attendance === a)?._count._all ?? 0;
          return eventDto(e, {
            daysToEvent: e.eventDate ? Math.ceil((e.eventDate.getTime() - Date.now()) / 86_400_000) : null,
            briefStatus: e.brief?.status ?? null,
            briefCompletion: e.brief ? briefCompletion(e.brief.sections, e.brief.data as any) : null,
            rsvp: { confirmed: c('yes'), declined: c('no'), pending: c('pending') },
            assignedStaff: e.assignedStaff,
          });
        }),
        nextCursor: page.nextCursor,
      };
    },
  );

  app.get('/api/admin/board', { schema: { tags: ['admin'], summary: 'Kanban column counts for studio events' } }, async (req) => {
    const user = requireRole(req, 'admin', 'staff');
    const groups = await prisma.event.groupBy({ by: ['productionStage'], where: { deletedAt: null, serviceMode: 'studio', ...(user.role === 'staff' ? { assignedStaffId: user.id } : {}) }, _count: { _all: true } });
    return { columns: STAGES.map((s) => ({ stage: s, count: groups.find((g) => g.productionStage === s)?._count._all ?? 0 })) };
  });

  app.post(
    '/api/admin/events',
    {
      schema: {
        tags: ['admin'],
        summary: 'Manual order (phone / bank transfer). Emails a set-password link — never a password.',
        body: z.object({
          email: z.string().trim().toLowerCase().email().max(255),
          plan: z.enum(['diy', 'std', 'experience', 'premium', 'birthday', 'bridesmaid']),
          hostNames: z.object({ partner1: z.string().max(80).optional(), partner2: z.string().max(80).optional(), honoree: z.string().max(80).optional() }),
          eventDate: DateOnly.nullish(),
          venueName: z.string().max(200).nullish(),
          themeKey: z.string().max(80).nullish(),
          sections: z.array(z.string().max(80)).max(30).default([]),
          /** Add-on codes or `{code, qty}` objects (qty only for repeatable add-ons such as extra_language), like the checkouts. */
          extras: ExtrasField.default([]),
          /** Plan cap (diy 2, Signature 3, Couture 5, small products 1) + extra_language units; extra_language units are set to exactly what the languages need (missing added, excess trimmed), like the checkouts. Max 8. */
          languages: Languages.default(['en']),
          adminNote: z.string().max(2000).nullish(),
          /** true → a real paid order is created: payment_provider `manual`, created_by_admin_id, server-priced plan/add-on lines (extra_language qty n, trimmed to what the languages need), audit entry `order.manual_created`. Its add-ons count as purchased. */
          markPaid: z.boolean().default(true),
          sendAccessEmail: z.boolean().default(true),
        }),
      },
    },
    async (req, reply) => {
      const admin = requireRole(req, 'admin');
      const b = req.body;
      const plan = await prisma.plan.findUnique({ where: { code: b.plan } });
      if (!plan) throw unprocessable('INVALID_SELECTION', 'Unknown plan.');
      const theme = b.themeKey ? await prisma.theme.findUnique({ where: { key: b.themeKey } }) : null;
      if (b.themeKey && !theme) throw unprocessable('INVALID_SELECTION', 'Unknown theme.');
      if (theme && !themeFitsProduct(theme, plan.product)) throw unprocessable('INVALID_SELECTION', 'This design is not available for the selected plan.', { themeKey: 'Wrong product' });
      const allowedExtras = new Set((await prisma.planExtra.findMany({ where: { planCode: plan.code, extra: { active: true } } })).map((pe) => pe.extraCode));
      for (const e of b.extras) if (!allowedExtras.has(e)) throw unprocessable('INVALID_SELECTION', `Add-on "${e}" is not available for this plan.`, { extras: e });
      const { sections, customNames } = normalizeSections(b.sections);
      // Languages: unsupported/ > 8 → 422; over the plan cap → the needed extra_language units are recorded on the order's add-ons.
      assertLanguages(b.languages);
      // N-31: extra_language units = exactly what the languages need (missing added, excess trimmed), same as the checkouts.
      b.extras = await topUpExtraLanguages(b.languages, plan.code, b.extras);
      if (b.extras.includes('extra_language') && !allowedExtras.has('extra_language')) throw unprocessable('INVALID_SELECTION', 'Extra languages are not available for this plan.', { languages: 'Too many' });
      // A paid manual sale is a real order, priced by the server (same rules as checkout).
      const quote = b.markPaid ? await computeQuote({ plan: plan.code, themeKey: b.themeKey ?? null, sections: plan.usesSections ? b.sections : [], extras: b.extras, languages: b.languages, requireTheme: false }) : null;
      const res = await prisma.$transaction(async (tx) => {
        const r = await provisionEvent(tx, {
          email: b.email,
          product: plan.product,
          planCode: plan.code,
          serviceMode: plan.serviceMode,
          hostNames: b.hostNames as Record<string, string>,
          eventDate: parseDateOnly(b.eventDate),
          venueName: b.venueName,
          languages: b.languages,
          themeId: theme?.id ?? null,
          sections,
          customNames,
          extras: b.extras,
          express: b.extras.some(isRushAddon) || plan.code === 'premium',
          maxRevisionRounds: plan.revisionRounds,
          hasRsvp: plan.hasRsvp,
          paid: b.markPaid,
        });
        if (b.adminNote) await tx.event.update({ where: { id: r.event.id }, data: { adminNote: b.adminNote } });
        if (quote) await createManualOrder(tx, { quote, eventId: r.event.id, userId: r.user.id, email: b.email, adminId: admin.id });
        if (!b.markPaid && b.extras.length) await tx.event.update({ where: { id: r.event.id }, data: { selectedExtras: b.extras } });
        return r;
      });
      if (b.sendAccessEmail) await sendAccessEmail(res.user, { template: 'set_password', eventId: res.event.id });
      await logActivity({ eventId: res.event.id, actorType: 'admin', actorId: admin.id, action: 'event.created_manually' });
      const event = await prisma.event.findUniqueOrThrow({ where: { id: res.event.id }, include: { invitations: true } });
      return reply.code(201).send(eventDto(event));
    },
  );

  app.get('/api/admin/events/:id', { schema: { tags: ['admin'], params: EventParams } }, async (req) => {
    const { event } = await loadStudioEvent(req, req.params.id);
    const [invitations, brief, members, orders, stats] = await Promise.all([
      prisma.invitation.findMany({ where: { eventId: event.id }, orderBy: { createdAt: 'asc' } }),
      prisma.brief.findUnique({ where: { eventId: event.id } }),
      prisma.eventMember.findMany({ where: { eventId: event.id }, include: { user: true } }),
      prisma.order.findMany({ where: { eventId: event.id }, orderBy: { createdAt: 'desc' } }),
      eventStats(event.id, event.invitesSentManual),
    ]);
    const stageIndex = STAGES.indexOf(event.productionStage);
    return eventDto(
      { ...event, invitations },
      {
        adminNote: event.adminNote,
        assignedStaffId: event.assignedStaffId,
        deliveryEmailSentAt: event.deliveryEmailSentAt,
        deliveryEmailSentCount: event.deliveryEmailSentCount,
        deletionRequestedAt: event.deletionRequestedAt,
        progress: Math.round((stageIndex / (STAGES.length - 1)) * 100),
        daysToEvent: event.eventDate ? Math.ceil((event.eventDate.getTime() - Date.now()) / 86_400_000) : null,
        brief: brief ? briefResponse(brief) : null,
        revisions: await revisionsSummary(event.id),
        members: members.map((m) => ({ role: m.role, user: userDto(m.user) })),
        orders: orders.map((o) => ({ id: o.id, number: o.number, source: o.paymentProvider === 'manual' ? 'manual' : 'checkout', createdByAdminId: o.createdByAdminId, status: o.status, totalCents: o.totalCents, currency: o.currency, paidAt: o.paidAt })),
        stats,
      },
    );
  });

  app.patch(
    '/api/admin/events/:id',
    {
      schema: {
        tags: ['admin'],
        params: EventParams,
        body: z.object({
          hostNames: z.object({ partner1: z.string().max(80).optional(), partner2: z.string().max(80).optional(), honoree: z.string().max(80).optional() }).optional(),
          title: z.string().trim().min(1).max(160).optional(),
          eventDate: DateOnly.nullish(),
          timezone: z.string().max(64).optional(),
          venueName: z.string().max(200).nullish(),
          venueAddress: z.string().max(400).nullish(),
          /** Same rule as hosts: plan cap + paid extra_language units (max 8). Unpaid: units auto-added to selectedExtras; paid: over the cap → 402 ADDON_PAYMENT_REQUIRED. */
          languages: Languages.optional(),
          productionStage: StageEnum.optional(),
          express: z.boolean().optional(),
          adminNote: z.string().max(5000).nullish(),
          maxRevisionRounds: z.number().int().min(0).max(99).optional(),
          assignedStaffId: z.string().uuid().nullish(),
          highSeasonNotice: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const { event, user } = await loadStudioEvent(req, req.params.id);
      const b = req.body;
      if (b.assignedStaffId !== undefined && user.role !== 'admin') throw new AppError(403, 'FORBIDDEN', 'Only admins can assign staff.');
      if (b.assignedStaffId) {
        const staff = await prisma.user.findUnique({ where: { id: b.assignedStaffId } });
        if (!staff || !isStudio(staff)) throw validation('Assignee must be a studio user.', { assignedStaffId: 'Invalid' });
      }
      const data: Prisma.EventUpdateInput = {};
      if (b.hostNames) data.hostNames = { ...(event.hostNames as object), ...b.hostNames };
      if (b.eventDate !== undefined) {
        const d = parseDateOnly(b.eventDate);
        data.eventDate = d;
        data.archiveAfter = d ? addMonths(d, config.ARCHIVE_AFTER_MONTHS) : null;
      }
      if (b.languages) {
        assertLanguages(b.languages);
        const planCode = event.planCode ?? (event.serviceMode === 'self_serve' ? 'diy' : null);
        if (!event.paidAt) data.selectedExtras = await topUpExtraLanguages(b.languages, planCode ?? 'diy', event.selectedExtras);
        else await assertLanguageLimit(b.languages, planCode, [], await paidExtras(event.id), event.id);
        data.languages = b.languages;
        data.primaryLanguage = b.languages[0];
      }
      if (b.assignedStaffId !== undefined) data.assignedStaff = b.assignedStaffId ? { connect: { id: b.assignedStaffId } } : { disconnect: true };
      for (const k of ['title', 'timezone', 'venueName', 'venueAddress', 'express', 'adminNote', 'maxRevisionRounds', 'highSeasonNotice'] as const) if (b[k] !== undefined) (data as any)[k] = b[k];
      await prisma.event.update({ where: { id: event.id }, data });
      if (b.productionStage && b.productionStage !== event.productionStage) await setStage(event.id, b.productionStage, user.id);
      await logActivity({ eventId: event.id, actorType: 'admin', actorId: user.id, action: 'event.admin_updated', data: { fields: Object.keys(b) } });
      const updated = await prisma.event.findUniqueOrThrow({ where: { id: event.id }, include: { invitations: true } });
      return eventDto(updated, { adminNote: updated.adminNote, assignedStaffId: updated.assignedStaffId });
    },
  );

  app.post('/api/admin/events/:id/stage', { schema: { tags: ['admin'], params: EventParams, body: z.union([z.object({ stage: StageEnum }), z.object({ advance: z.literal(true) })]) } }, async (req) => {
    const { event, user } = await loadStudioEvent(req, req.params.id);
    if (event.serviceMode !== 'studio') throw new AppError(409, 'CONFLICT', 'Self-serve events have no production stages.');
    let stage: ProductionStage;
    if ('stage' in req.body) stage = req.body.stage;
    else {
      const i = STAGES.indexOf(event.productionStage);
      if (i >= STAGES.length - 1) throw new AppError(409, 'CONFLICT', 'Already delivered.');
      stage = STAGES[i + 1]!;
    }
    const updated = await setStage(event.id, stage, user.id);
    return { stage: updated.productionStage, deliveredAt: updated.deliveredAt };
  });

  app.delete('/api/admin/events/:id', { schema: { tags: ['admin'], summary: 'Soft-delete an event and its guests (admin only)', params: EventParams } }, async (req, reply) => {
    const admin = requireRole(req, 'admin');
    const event = await prisma.event.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!event) throw notFound('Event');
    const now = new Date();
    await prisma.$transaction([
      prisma.guest.updateMany({ where: { eventId: event.id, deletedAt: null }, data: { deletedAt: now } }),
      prisma.invitation.updateMany({ where: { eventId: event.id }, data: { status: 'archived', archivedAt: now } }),
      prisma.event.update({ where: { id: event.id }, data: { deletedAt: now } }),
    ]);
    await logActivity({ eventId: event.id, actorType: 'admin', actorId: admin.id, action: 'event.deleted' });
    return reply.code(204).send();
  });

  app.post('/api/admin/events/:id/send-access', { schema: { tags: ['admin'], summary: "Email the owner a set-password / sign-in link", params: EventParams } }, async (req, reply) => {
    const { event, user } = await loadStudioEvent(req, req.params.id);
    const owners = await ownersOf(event.id);
    for (const o of owners) await sendAccessEmail(o.user, { template: 'set_password', eventId: event.id });
    await logActivity({ eventId: event.id, actorType: 'admin', actorId: user.id, action: 'access.sent' });
    return reply.code(202).send({ sent: owners.length });
  });

  // ───── brief ─────
  app.get('/api/admin/events/:id/brief', { schema: { tags: ['admin'], params: EventParams } }, async (req) => {
    const { event } = await loadStudioEvent(req, req.params.id);
    const brief = await prisma.brief.findUnique({ where: { eventId: event.id } });
    if (!brief) throw notFound('Brief');
    return briefResponse(brief);
  });

  app.patch('/api/admin/events/:id/brief', { schema: { tags: ['admin'], summary: 'Edit brief at any time (even locked)', params: EventParams, body: z.object({ data: z.record(z.string().max(80), z.unknown()) }) } }, async (req) => {
    const { event } = await loadStudioEvent(req, req.params.id);
    const user = requireRole(req, 'admin', 'staff');
    return briefResponse(await applyBriefPatch(event.id, req.body.data, { allowLocked: true, userId: user.id, req }));
  });

  app.post(
    '/api/admin/events/:id/brief/sections',
    { schema: { tags: ['admin'], summary: 'Add sections to a brief; host is asked to complete & resubmit', params: EventParams, body: z.object({ sections: z.array(z.string().max(80)).min(1).max(20), notify: z.boolean().default(true) }) } },
    async (req) => {
      const { event, user } = await loadStudioEvent(req, req.params.id);
      const brief = await prisma.brief.findUnique({ where: { eventId: event.id } });
      if (!brief) throw notFound('Brief');
      const extraKeys = Object.values(EXTRA_BRIEF_SECTIONS);
      const blockInput = req.body.sections.filter((s) => !extraKeys.includes(s));
      const { sections: norm, customNames } = normalizeSections(blockInput);
      const toAdd = [...norm, ...req.body.sections.filter((s) => extraKeys.includes(s))].filter((s) => !brief.sections.includes(s));
      if (!toAdd.length) throw conflict('CONFLICT', 'These sections are already in the brief.');
      const rsvpLast = brief.sections.includes('rsvp');
      const sections = [...brief.sections.filter((s) => s !== 'rsvp'), ...toAdd, ...(rsvpLast ? ['rsvp'] : [])];
      const updated = await prisma.brief.update({
        where: { eventId: event.id },
        data: { sections, newSections: brief.submittedAt ? [...brief.newSections, ...toAdd] : brief.newSections, customBlockNames: { ...(brief.customBlockNames as object), ...customNames }, status: brief.status === 'submitted' ? 'in_progress' : brief.status },
      });
      if (req.body.notify && brief.submittedAt) {
        for (const o of await ownersOf(event.id)) await enqueueMessage({ to: o.user.email, template: 'brief_sections_added', data: { count: toAdd.length, panelUrl: `${panelUrl(event.id)}/brief` }, eventId: event.id, userId: o.userId });
      }
      await logActivity({ eventId: event.id, actorType: 'admin', actorId: user.id, action: 'brief.sections_added', data: { sections: toAdd } });
      publish(event.id, 'brief.updated', { newSections: toAdd });
      return briefResponse(updated);
    },
  );

  // ───── revisions ─────
  app.patch(
    '/api/admin/revisions/:revisionId',
    { schema: { tags: ['admin'], params: z.object({ revisionId: z.string().uuid() }), body: z.object({ status: z.enum(['submitted', 'in_progress', 'completed']).optional(), staffNote: z.string().max(5000).nullish(), notify: z.boolean().default(true) }) } },
    async (req) => {
      const user = requireRole(req, 'admin', 'staff');
      const rev = await prisma.revision.findUnique({ where: { id: req.params.revisionId }, include: { event: true } });
      if (!rev || !studioCanAccess(user, rev.event)) throw notFound('Revision');
      const completing = req.body.status === 'completed' && rev.status !== 'completed';
      if (req.body.status && req.body.status !== 'completed' && rev.status === 'completed') {
        const open = await prisma.revision.count({ where: { eventId: rev.eventId, status: { not: 'completed' }, NOT: { id: rev.id } } });
        if (open) throw conflict('CONFLICT', 'Another round is already open.');
      }
      const updated = await prisma.revision.update({ where: { id: rev.id }, data: { status: req.body.status, staffNote: req.body.staffNote, resolvedAt: completing ? new Date() : req.body.status && req.body.status !== 'completed' ? null : undefined }, include: { comments: { include: { author: true } } } });
      if (completing && req.body.notify) {
        for (const o of await ownersOf(rev.eventId)) await enqueueMessage({ to: o.user.email, template: 'revision_completed', data: { round: rev.roundNumber, staffNote: updated.staffNote, panelUrl: `${panelUrl(rev.eventId)}/revisions` }, eventId: rev.eventId, userId: o.userId });
      }
      await logActivity({ eventId: rev.eventId, actorType: 'admin', actorId: user.id, action: 'revision.updated', data: { round: rev.roundNumber, status: updated.status } });
      publish(rev.eventId, 'revision.updated', { id: rev.id, status: updated.status });
      return revisionDto(updated);
    },
  );

  // ───── invitation editor ─────
  app.get('/api/admin/invitations/:invitationId', { schema: { tags: ['admin'], params: z.object({ invitationId: z.string().uuid() }) } }, async (req) => {
    const { inv } = await loadStudioInvitation(req, req.params.invitationId);
    return { ...invitationFullDto(inv), ...(await linkState(inv)) };
  });
  app.put('/api/admin/invitations/:invitationId', { preValidation: rejectRemovedFields({ slug: 'The link is changed with PATCH /api/events/:id/invitation/slug.' }), schema: { tags: ['admin'], params: z.object({ invitationId: z.string().uuid() }), body: InvitationUpdateInput } }, async (req) => {
    const { inv, user } = await loadStudioInvitation(req, req.params.invitationId);
    return invitationFullDto(await updateInvitation(inv, req.body, { id: user.id, type: 'admin', req }));
  });
  app.post('/api/admin/invitations/:invitationId/generate-from-brief', { schema: { tags: ['admin'], summary: 'Fill invitation content/config from the brief (draft)', params: z.object({ invitationId: z.string().uuid() }) } }, async (req) => {
    const { inv, user } = await loadStudioInvitation(req, req.params.invitationId);
    const brief = await prisma.brief.findUnique({ where: { eventId: inv.eventId } });
    if (!brief) throw notFound('Brief');
    const { content, config: cfg } = contentFromBrief(inv.event, brief, { content: inv.content, config: inv.config });
    const updated = await prisma.invitation.update({ where: { id: inv.id }, data: { content: content as any, config: cfg as any, draftChangedAt: new Date() }, include: { theme: true } });
    await logActivity({ eventId: inv.eventId, actorType: 'admin', actorId: user.id, action: 'invitation.generated_from_brief' });
    return invitationFullDto(updated);
  });
  app.post('/api/admin/invitations/:invitationId/preview-token', { schema: { tags: ['admin'], params: z.object({ invitationId: z.string().uuid() }) } }, async (req) => {
    const { inv } = await loadStudioInvitation(req, req.params.invitationId);
    return invitationFullDto(await rotatePreviewToken(inv));
  });
  app.post('/api/admin/invitations/:invitationId/publish', { schema: { tags: ['admin'], params: z.object({ invitationId: z.string().uuid() }) } }, async (req) => {
    const { inv, user } = await loadStudioInvitation(req, req.params.invitationId);
    return invitationFullDto(await publishInvitation(inv, { id: user.id, type: 'admin' }));
  });
  app.post('/api/admin/invitations/:invitationId/discard-draft', { schema: { tags: ['admin'], summary: 'Reset the draft to the live version', params: z.object({ invitationId: z.string().uuid() }) } }, async (req) => {
    const { inv, user } = await loadStudioInvitation(req, req.params.invitationId);
    return invitationFullDto(await discardDraft(inv, { id: user.id, type: 'admin' }));
  });
  app.post('/api/admin/invitations/:invitationId/unpublish', { schema: { tags: ['admin'], params: z.object({ invitationId: z.string().uuid() }) } }, async (req) => {
    const { inv, user } = await loadStudioInvitation(req, req.params.invitationId);
    return invitationFullDto(await unpublishInvitation(inv, { id: user.id, type: 'admin' }));
  });
  app.get('/api/admin/invitations/:invitationId/versions', { schema: { tags: ['admin'], params: z.object({ invitationId: z.string().uuid() }) } }, async (req) => {
    const { inv } = await loadStudioInvitation(req, req.params.invitationId);
    return listVersions(inv.id);
  });
  app.post('/api/admin/invitations/:invitationId/rollback', { schema: { tags: ['admin'], params: z.object({ invitationId: z.string().uuid() }), body: z.object({ version: z.number().int().min(1) }) } }, async (req) => {
    const { inv, user } = await loadStudioInvitation(req, req.params.invitationId);
    return invitationFullDto(await rollbackInvitation(inv, req.body.version, { id: user.id, type: 'admin' }));
  });

  // ───── studio emails ─────
  app.post(
    '/api/admin/events/:id/emails',
    { schema: { tags: ['admin'], params: EventParams, body: z.object({ template: z.enum(['draft_ready', 'invitation_ready', 'std_ready', 'custom']), note: z.string().max(2000).optional(), subject: z.string().max(200).optional(), body: z.string().max(5000).optional() }) } },
    async (req) => {
      const { event, user } = await loadStudioEvent(req, req.params.id);
      const owners = await ownersOf(event.id);
      const inv = await prisma.invitation.findFirst({ where: { eventId: event.id }, orderBy: { createdAt: 'asc' } });
      const b = req.body;
      if ((b.template === 'invitation_ready' || b.template === 'std_ready') && inv?.status !== 'published') throw new AppError(409, 'CONFLICT', 'Publish the invitation before sending the delivery email.');
      if (b.template === 'custom' && !b.body) throw validation('Body is required for custom emails.', { body: 'Required' });
      const summary = await revisionsSummary(event.id);
      for (const o of owners) {
        await enqueueMessage({
          to: o.user.email,
          template: b.template,
          eventId: event.id,
          userId: o.userId,
          data: { name: o.user.name, note: b.note, subject: b.subject, body: b.body, roundsRemaining: summary.unlimited ? 'unlimited' : summary.remaining, panelUrl: panelUrl(event.id), inviteUrl: inv ? inviteUrl(inv.slug) : undefined },
        });
      }
      const data: Prisma.EventUpdateInput = {};
      if (b.template === 'draft_ready' && STAGES.indexOf(event.productionStage) < STAGES.indexOf('review')) await setStage(event.id, 'review', user.id);
      if (b.template === 'invitation_ready' || b.template === 'std_ready') {
        data.deliveryEmailSentAt = new Date();
        data.deliveryEmailSentCount = { increment: 1 };
      }
      const updated = await prisma.event.update({ where: { id: event.id }, data });
      await logActivity({ eventId: event.id, actorType: 'admin', actorId: user.id, action: 'email.sent', data: { template: b.template, recipients: owners.length } });
      return { sent: owners.length, template: b.template, deliveryEmailSentAt: updated.deliveryEmailSentAt, deliveryEmailSentCount: updated.deliveryEmailSentCount };
    },
  );

  // ───── orders & carts (admin) ─────
  app.get('/api/admin/orders', { schema: { tags: ['admin'], querystring: z.object({ status: z.enum(['draft', 'pending_payment', 'paid', 'refunded', 'canceled']).optional(), q: z.string().max(100).optional(), cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }) } }, async (req) => {
    requireRole(req, 'admin');
    const q = req.query;
    const rows = await prisma.order.findMany({
      where: { ...(q.status ? { status: q.status } : {}), ...(q.q ? { OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { number: { contains: q.q, mode: 'insensitive' } }] } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(q.cursor, q.limit),
    });
    const page = pageResult(rows, q.limit);
    return { items: page.items.map((o) => ({ id: o.id, number: o.number, source: o.paymentProvider === 'manual' ? 'manual' : 'checkout', createdByAdminId: o.createdByAdminId, email: o.email, plan: o.planCode, status: o.status, subtotalCents: o.subtotalCents, taxCents: o.taxCents, totalCents: o.totalCents, currency: o.currency, paymentProvider: o.paymentProvider, eventId: o.eventId, paidAt: o.paidAt, createdAt: o.createdAt })), nextCursor: page.nextCursor };
  });
  app.post(
    '/api/admin/orders/:orderId/refund',
    {
      schema: {
        tags: ['admin'],
        summary: 'Refund a MANUAL order (admin only; no money moves). Same effects as a Stripe refund. Checkout orders → 409 (refund in Stripe); already refunded → 409',
        params: z.object({ orderId: z.string().uuid() }),
        body: z.object({ reason: z.string().trim().min(1).max(500) }).strict(),
      },
    },
    async (req) => {
      const admin = requireRole(req, 'admin');
      const order = await prisma.order.findUnique({ where: { id: req.params.orderId } });
      if (!order) throw notFound('Order');
      if (order.paymentProvider !== 'manual') throw conflict('CONFLICT', 'Checkout orders are refunded through Stripe only.', { paymentProvider: order.paymentProvider });
      if (order.status === 'refunded') throw conflict('CONFLICT', 'This order is already refunded.', { status: order.status });
      if (order.status !== 'paid') throw conflict('CONFLICT', 'Only paid orders can be refunded.', { status: order.status });
      // Claim the refund atomically so two clicks can't both run it, then reuse the webhook's refund logic.
      const claimed = await prisma.order.updateMany({ where: { id: order.id, status: 'paid' }, data: { status: 'refunded', refundedAt: new Date() } });
      if (!claimed.count) throw conflict('CONFLICT', 'This order is already refunded.', { status: 'refunded' });
      const updated = await refundOrder(order); // `order` is the pre-claim row (status paid), so the shared effects run once
      await logActivity({ eventId: order.eventId, actorType: 'admin', actorId: admin.id, action: 'order.manual_refunded', data: { orderId: order.id, orderNumber: order.number, reason: req.body.reason, kind: order.kind, extras: order.extras } });
      return { id: updated.id, number: updated.number, status: updated.status, refundedAt: updated.refundedAt, source: 'manual', kind: updated.kind };
    },
  );

  app.get('/api/admin/orders/:orderId', { schema: { tags: ['admin'], params: z.object({ orderId: z.string().uuid() }) } }, async (req) => {
    requireRole(req, 'admin');
    const o = await prisma.order.findUnique({ where: { id: req.params.orderId }, include: { items: true, theme: true } });
    if (!o) throw notFound('Order');
    return { ...o, checkoutUrl: undefined, theme: o.theme ? { key: o.theme.key, name: o.theme.nameI18n } : null, stripeDashboardUrl: o.paymentProvider === 'stripe' && o.paymentIntentId ? `https://dashboard.stripe.com/test/payments/${o.paymentIntentId}` : null };
  });
  app.get('/api/admin/checkout-drafts', { schema: { tags: ['admin'], querystring: z.object({ abandoned: queryBool().optional(), cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }) } }, async (req) => {
    requireRole(req, 'admin');
    const rows = await prisma.checkoutDraft.findMany({ where: { convertedOrderId: null, ...(req.query.abandoned !== undefined ? { abandoned: req.query.abandoned } : {}) }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], ...pageArgs(req.query.cursor, req.query.limit) });
    return pageResult(rows, req.query.limit);
  });

  // ───── catalogue: themes & music (admin) ─────
  const ThemeBody = z.object({
    key: z.string().regex(/^[a-z0-9-]{2,60}$/),
    products: z
      .array(z.enum(['wedding_invite', 'save_the_date', 'birthday', 'bridesmaid']))
      .min(1)
      .max(4)
      .refine((a) => new Set(a).size === a.length, 'Products must be unique')
      .default(['wedding_invite', 'save_the_date', 'birthday', 'bridesmaid'])
      .describe('Products this design fits (default: all four)'),
    name: I18n,
    description: I18n.default({}),
    moodTags: z.array(z.string().max(30)).max(10).default([]),
    previewVideoUrl: z.string().url().nullish(),
    posterUrl: z.string().url().nullish(),
    demoSlug: z.string().max(80).nullish(),
    isNew: z.boolean().default(false),
    isPopular: z.boolean().default(false),
    status: z.enum(['active', 'coming_soon', 'retired']).default('active'),
    defaultConfig: z.record(z.string(), z.unknown()).default({}),
    sort: z.number().int().default(0),
  });
  const themeData = (b: Partial<z.infer<typeof ThemeBody>>) => ({ key: b.key, products: b.products, nameI18n: b.name, descriptionI18n: b.description, moodTags: b.moodTags, previewVideoUrl: b.previewVideoUrl, posterUrl: b.posterUrl, demoSlug: b.demoSlug, isNew: b.isNew, isPopular: b.isPopular, status: b.status, defaultConfig: b.defaultConfig as any, sort: b.sort });
  app.get('/api/admin/themes', { schema: { tags: ['admin'] } }, async (req) => {
    requireRole(req, 'admin', 'staff');
    return { items: (await prisma.theme.findMany({ orderBy: { sort: 'asc' } })).map(themeDto) };
  });
  const noSingleProduct = rejectRemovedFields({ product: '"product" was replaced by "products" (an array of product types).' });
  app.post('/api/admin/themes', { preValidation: noSingleProduct, schema: { tags: ['admin'], body: ThemeBody } }, async (req, reply) => {
    requireRole(req, 'admin');
    return reply.code(201).send(themeDto(await prisma.theme.create({ data: themeData(req.body) as any })));
  });
  app.patch('/api/admin/themes/:themeId', { preValidation: noSingleProduct, schema: { tags: ['admin'], params: z.object({ themeId: z.string().uuid() }), body: ThemeBody.partial() } }, async (req) => {
    requireRole(req, 'admin');
    return themeDto(await prisma.theme.update({ where: { id: req.params.themeId }, data: themeData(req.body) as any }));
  });
  app.delete('/api/admin/themes/:themeId', { schema: { tags: ['admin'], summary: 'Retire a theme (kept for existing invitations)', params: z.object({ themeId: z.string().uuid() }) } }, async (req, reply) => {
    requireRole(req, 'admin');
    await prisma.theme.update({ where: { id: req.params.themeId }, data: { status: 'retired' } });
    return reply.code(204).send();
  });

  const TrackBody = z.object({ title: z.string().min(1).max(120), artist: z.string().min(1).max(120), license: z.string().min(1).max(200), url: z.string().url().nullish(), durationS: z.number().int().min(1).max(3600), moodTags: z.array(z.string().max(30)).max(10).default([]), active: z.boolean().default(true) });
  app.get('/api/admin/music', { schema: { tags: ['admin'] } }, async (req) => {
    requireRole(req, 'admin', 'staff');
    return { items: await prisma.musicTrack.findMany({ orderBy: { title: 'asc' } }) };
  });
  app.post('/api/admin/music', { schema: { tags: ['admin'], body: TrackBody } }, async (req, reply) => {
    requireRole(req, 'admin');
    return reply.code(201).send(await prisma.musicTrack.create({ data: req.body }));
  });
  app.patch('/api/admin/music/:trackId', { schema: { tags: ['admin'], params: z.object({ trackId: z.string().uuid() }), body: TrackBody.partial() } }, async (req) => {
    requireRole(req, 'admin');
    return prisma.musicTrack.update({ where: { id: req.params.trackId }, data: req.body });
  });

  // ───── team ─────
  app.get('/api/admin/users', { schema: { tags: ['admin'], querystring: z.object({ role: z.enum(['host', 'staff', 'admin']).optional(), q: z.string().max(100).optional(), cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }) } }, async (req) => {
    requireRole(req, 'admin');
    const q = req.query;
    const rows = await prisma.user.findMany({ where: { ...(q.role ? { role: q.role } : { role: { in: ['admin', 'staff'] } }), ...(q.q ? { OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }] } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q.cursor, q.limit) });
    const page = pageResult(rows, q.limit);
    return { items: page.items.map(userDto), nextCursor: page.nextCursor };
  });
  app.post('/api/admin/users', { schema: { tags: ['admin'], summary: 'Invite a studio team member (set-password link by email)', body: z.object({ email: z.string().trim().toLowerCase().email().max(255), name: z.string().max(100).optional(), role: z.enum(['staff', 'admin']).default('staff') }) } }, async (req, reply) => {
    const admin = requireRole(req, 'admin');
    const email = normalizeEmail(req.body.email);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && isStudio(existing)) throw conflict('CONFLICT', 'This person is already on the team.');
    const user = existing ? await prisma.user.update({ where: { id: existing.id }, data: { role: req.body.role } }) : await prisma.user.create({ data: { email, name: req.body.name ?? null, role: req.body.role } });
    const raw = await issueToken({ purpose: user.passwordHash ? 'login' : 'set_password', email, userId: user.id });
    await sendNow({ to: email, template: user.passwordHash ? 'login_link' : 'set_password', data: { name: user.name, actionUrl: tokenActionUrl(raw) }, userId: user.id });
    await logActivity({ actorType: 'admin', actorId: admin.id, action: 'team.invited', data: { userId: user.id, role: user.role } });
    return reply.code(201).send(userDto(user));
  });
  app.patch('/api/admin/users/:userId', { schema: { tags: ['admin'], params: z.object({ userId: z.string().uuid() }), body: z.object({ role: z.enum(['host', 'staff', 'admin']).optional(), disabled: z.boolean().optional(), name: z.string().max(100).optional() }) } }, async (req) => {
    const admin = requireRole(req, 'admin');
    if (req.params.userId === admin.id && (req.body.role && req.body.role !== 'admin' || req.body.disabled)) throw new AppError(409, 'CONFLICT', 'You cannot demote or disable yourself.');
    const user = await prisma.user.update({ where: { id: req.params.userId }, data: { role: req.body.role, name: req.body.name, ...(req.body.disabled !== undefined ? { disabledAt: req.body.disabled ? new Date() : null } : {}) } });
    if (req.body.disabled) await prisma.session.deleteMany({ where: { userId: user.id } });
    return userDto(user);
  });
  app.post('/api/admin/users/:userId/send-reset', { schema: { tags: ['admin'], summary: 'Email a password reset link (admins never see or set passwords)', params: z.object({ userId: z.string().uuid() }) } }, async (req, reply) => {
    requireRole(req, 'admin');
    const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!user) throw notFound('User');
    const purpose = user.passwordHash ? 'reset_password' : 'set_password';
    const raw = await issueToken({ purpose, email: user.email, userId: user.id });
    await sendNow({ to: user.email, template: purpose === 'reset_password' ? 'password_reset' : 'set_password', data: { name: user.name, actionUrl: tokenActionUrl(raw) }, userId: user.id });
    return reply.code(202).send({ ok: true });
  });

  // ───── logs, reviews, metrics ─────
  app.get('/api/admin/messages', { schema: { tags: ['admin'], querystring: z.object({ eventId: z.string().uuid().optional(), template: z.string().max(60).optional(), status: z.enum(['queued', 'sending', 'sent', 'delivered', 'failed', 'bounced', 'opened']).optional(), cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }) } }, async (req) => {
    const user = requireRole(req, 'admin', 'staff');
    const q = req.query;
    if (user.role === 'staff' && !q.eventId) throw new AppError(403, 'FORBIDDEN', 'Staff must filter by an assigned event.');
    if (q.eventId && user.role === 'staff') await loadStudioEvent(req, q.eventId);
    const rows = await prisma.message.findMany({ where: { ...(q.eventId ? { eventId: q.eventId } : {}), ...(q.template ? { templateKey: q.template } : {}), ...(q.status ? { status: q.status } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q.cursor, q.limit) });
    const page = pageResult(rows, q.limit);
    return { items: page.items.map((m) => ({ id: m.id, eventId: m.eventId, channel: m.channel, to: m.toAddress, template: m.templateKey, status: m.status, error: m.error, provider: m.provider, sentAt: m.sentAt, createdAt: m.createdAt })), nextCursor: page.nextCursor };
  });

  app.get('/api/admin/reviews', { schema: { tags: ['admin'] } }, async (req) => {
    requireRole(req, 'admin');
    return { items: await prisma.review.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }) };
  });
  const noRating = rejectRemovedFields({ rating: 'Reviews have no rating. Remove "rating".' });
  app.post('/api/admin/reviews', { preValidation: noRating, schema: { tags: ['admin'], body: z.object({ displayName: z.string().min(1).max(100), location: z.string().max(100).nullish(), text: z.string().min(1).max(3000), orderId: z.string().uuid().nullish(), isSample: z.boolean().default(false), published: z.boolean().default(false) }) } }, async (req, reply) => {
    requireRole(req, 'admin');
    return reply.code(201).send(await prisma.review.create({ data: req.body }));
  });
  app.patch('/api/admin/reviews/:reviewId', { preValidation: noRating, schema: { tags: ['admin'], params: z.object({ reviewId: z.string().uuid() }), body: z.object({ displayName: z.string().min(1).max(100).optional(), location: z.string().max(100).nullish(), published: z.boolean().optional(), isSample: z.boolean().optional(), text: z.string().min(1).max(3000).optional() }) } }, async (req) => {
    requireRole(req, 'admin');
    return prisma.review.update({ where: { id: req.params.reviewId }, data: req.body });
  });

  app.get('/api/admin/metrics', { schema: { tags: ['admin'] } }, async (req) => {
    requireRole(req, 'admin');
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [ordersByStatus, revenue30, revenueAll, stages, guests30, events] = await Promise.all([
      prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.order.aggregate({ where: { status: 'paid', paidAt: { gte: since } }, _sum: { totalCents: true, taxCents: true }, _count: { _all: true } }),
      prisma.order.aggregate({ where: { status: 'paid' }, _sum: { totalCents: true }, _count: { _all: true } }),
      prisma.event.groupBy({ by: ['productionStage'], where: { deletedAt: null, serviceMode: 'studio' }, _count: { _all: true } }),
      prisma.guest.count({ where: { submittedAt: { gte: since }, deletedAt: null } }),
      prisma.event.groupBy({ by: ['serviceMode'], where: { deletedAt: null }, _count: { _all: true } }),
    ]);
    return {
      currency: config.CURRENCY,
      orders: Object.fromEntries(ordersByStatus.map((o) => [o.status, o._count._all])),
      revenueLast30Days: { totalCents: revenue30._sum.totalCents ?? 0, taxCents: revenue30._sum.taxCents ?? 0, orders: revenue30._count._all },
      revenueAllTime: { totalCents: revenueAll._sum.totalCents ?? 0, orders: revenueAll._count._all },
      stages: Object.fromEntries(STAGES.map((s) => [s, stages.find((x) => x.productionStage === s)?._count._all ?? 0])),
      events: Object.fromEntries(events.map((e) => [e.serviceMode, e._count._all])),
      rsvpsLast30Days: guests30,
    };
  });

  void i18nName;
  void isoDate;
}
