import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { requireEventAccess } from '../lib/auth.js';
import { publish } from '../lib/bus.js';
import { AppError, notFound, validation } from '../lib/errors.js';
import { pageArgs, pageResult } from '../lib/pagination.js';
import { guestDto } from '../lib/serializers.js';
import { buildCsv, buildXlsx, DEFAULT_EXPORT_COLUMNS, EXPORT_COLUMNS, type ExportColumn } from '../services/export.js';
import { companionCreates, guestInclude, ManualGuestInput, unseatIfNotAttending } from '../services/guests.js';
import { eventStats } from '../services/stats.js';
import { slugify } from '../lib/slug.js';
import { EventParams, type ZApp } from './types.js';
import { queryBoolDefault } from '../lib/query.js';

const GuestParams = EventParams.extend({ guestId: z.string().uuid() });

async function emitStats(eventId: string) {
  const e = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  publish(eventId, 'stats.updated', await eventStats(eventId, e.invitesSentManual));
}

function listWhere(eventId: string, q: { status: string; q?: string; trash: boolean }): Prisma.GuestWhereInput {
  return {
    eventId,
    deletedAt: q.trash ? { not: null } : null,
    ...(q.status !== 'all' ? { attendance: q.status as any } : {}),
    ...(q.q
      ? {
          OR: [
            { fullName: { contains: q.q, mode: 'insensitive' } },
            { email: { contains: q.q, mode: 'insensitive' } },
            { companions: { some: { fullName: { contains: q.q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };
}

export default async function guests(app: ZApp) {
  app.get(
    '/api/events/:id/guests',
    {
      schema: {
        tags: ['guests'],
        params: EventParams,
        querystring: z.object({
          status: z.enum(['all', 'yes', 'no', 'pending']).default('all'),
          q: z.string().trim().max(100).optional(),
          trash: queryBoolDefault(false),
          cursor: z.string().max(200).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req) => {
      const { event } = await requireEventAccess(req, req.params.id, 'read');
      const where = listWhere(event.id, req.query);
      const [rows, counts, trashCount] = await Promise.all([
        prisma.guest.findMany({ where, include: guestInclude, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], ...pageArgs(req.query.cursor, req.query.limit) }),
        prisma.guest.groupBy({ by: ['attendance'], where: { eventId: event.id, deletedAt: null }, _count: { _all: true } }),
        prisma.guest.count({ where: { eventId: event.id, deletedAt: { not: null } } }),
      ]);
      const page = pageResult(rows, req.query.limit);
      const c = (a: string) => counts.find((x) => x.attendance === a)?._count._all ?? 0;
      return { items: page.items.map(guestDto), nextCursor: page.nextCursor, counts: { all: c('yes') + c('no') + c('pending'), yes: c('yes'), no: c('no'), pending: c('pending'), trash: trashCount } };
    },
  );

  app.get('/api/events/:id/guests/:guestId', { schema: { tags: ['guests'], params: GuestParams } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'read');
    const g = await prisma.guest.findFirst({ where: { id: req.params.guestId, eventId: event.id }, include: guestInclude });
    if (!g) throw notFound('Guest');
    return guestDto(g);
  });

  app.post('/api/events/:id/guests', { schema: { tags: ['guests'], summary: 'Manually add a guest (e.g. phone RSVP)', params: EventParams, body: ManualGuestInput } }, async (req, reply) => {
    const { event, user } = await requireEventAccess(req, req.params.id, 'write');
    const b = req.body;
    if (b.inviteeId && !(await prisma.invitee.findFirst({ where: { id: b.inviteeId, eventId: event.id, deletedAt: null } }))) throw validation('Unknown invitee.', { inviteeId: 'Invalid' });
    const companions = b.attendance === 'no' ? [] : b.companions;
    const g = await prisma.guest.create({
      data: {
        eventId: event.id,
        inviteeId: b.inviteeId ?? null,
        fullName: b.fullName,
        email: b.email ?? null,
        phone: b.phone,
        attendance: b.attendance,
        partySize: 1 + companions.length,
        primaryMeal: b.primaryMeal,
        primaryDietary: b.primaryDietary,
        dietaryTags: b.dietaryTags,
        extraEvents: b.extraEvents,
        answers: b.answers,
        message: b.message,
        notes: b.notes,
        source: 'manual',
        language: b.language,
        companions: { create: companionCreates(companions) },
      },
      include: guestInclude,
    });
    if (b.inviteeId && b.attendance !== 'pending') await prisma.invitee.update({ where: { id: b.inviteeId }, data: { status: 'responded', respondedAt: new Date() } });
    await logActivity({ eventId: event.id, actorType: 'host', actorId: user.id, action: 'guest.added', data: { guestId: g.id, name: g.fullName, attendance: g.attendance } });
    publish(event.id, 'guest.created', { guest: guestDto(g) });
    await emitStats(event.id);
    return reply.code(201).send(guestDto(g));
  });

  app.patch('/api/events/:id/guests/:guestId', { schema: { tags: ['guests'], params: GuestParams, body: ManualGuestInput.partial() } }, async (req) => {
    const { event, user } = await requireEventAccess(req, req.params.id, 'write');
    const existing = await prisma.guest.findFirst({ where: { id: req.params.guestId, eventId: event.id, deletedAt: null }, include: { companions: true } });
    if (!existing) throw notFound('Guest');
    const b = req.body;
    const attendance = b.attendance ?? existing.attendance;
    const data: Prisma.GuestUpdateInput = {};
    for (const k of ['fullName', 'email', 'phone', 'primaryMeal', 'primaryDietary', 'dietaryTags', 'extraEvents', 'answers', 'message', 'notes', 'language'] as const) {
      if (b[k] !== undefined) (data as any)[k] = b[k];
    }
    data.attendance = attendance;
    const g = await prisma.$transaction(async (tx) => {
      if (b.companions !== undefined || attendance === 'no') {
        const companions = attendance === 'no' ? [] : (b.companions ?? []);
        await tx.guestCompanion.deleteMany({ where: { guestId: existing.id } });
        await tx.guestCompanion.createMany({ data: companionCreates(companions).map((c) => ({ ...c, guestId: existing.id })) });
        data.partySize = 1 + companions.length;
      }
      await tx.guest.update({ where: { id: existing.id }, data });
      await unseatIfNotAttending(existing.id, attendance, tx);
      return tx.guest.findUniqueOrThrow({ where: { id: existing.id }, include: guestInclude });
    });
    await logActivity({ eventId: event.id, actorType: 'host', actorId: user.id, action: 'guest.updated', data: { guestId: g.id, name: g.fullName, attendance: g.attendance } });
    publish(event.id, 'guest.updated', { guest: guestDto(g) });
    await emitStats(event.id);
    return guestDto(g);
  });

  app.delete('/api/events/:id/guests/:guestId', { schema: { tags: ['guests'], summary: 'Move to trash, or ?permanent=true to delete a trashed guest', params: GuestParams, querystring: z.object({ permanent: queryBoolDefault(false) }) } }, async (req, reply) => {
    const { event, user } = await requireEventAccess(req, req.params.id, 'write');
    const g = await prisma.guest.findFirst({ where: { id: req.params.guestId, eventId: event.id } });
    if (!g) throw notFound('Guest');
    if (req.query.permanent) {
      if (!g.deletedAt) throw new AppError(409, 'CONFLICT', 'Move the guest to the trash before deleting permanently.');
      await prisma.guest.delete({ where: { id: g.id } });
      await logActivity({ eventId: event.id, actorType: 'host', actorId: user.id, action: 'guest.purged', data: { name: g.fullName } });
    } else {
      await prisma.guest.update({ where: { id: g.id }, data: { deletedAt: new Date() } });
      await unseatIfNotAttending(g.id, null);
      await logActivity({ eventId: event.id, actorType: 'host', actorId: user.id, action: 'guest.trashed', data: { guestId: g.id, name: g.fullName } });
    }
    publish(event.id, 'guest.deleted', { guestId: g.id, permanent: req.query.permanent });
    await emitStats(event.id);
    return reply.code(204).send();
  });

  app.post('/api/events/:id/guests/:guestId/restore', { schema: { tags: ['guests'], params: GuestParams } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'write');
    const g = await prisma.guest.findFirst({ where: { id: req.params.guestId, eventId: event.id, deletedAt: { not: null } } });
    if (!g) throw notFound('Guest');
    const restored = await prisma.guest.update({ where: { id: g.id }, data: { deletedAt: null }, include: guestInclude });
    publish(event.id, 'guest.created', { guest: guestDto(restored) });
    await emitStats(event.id);
    return guestDto(restored);
  });

  app.post(
    '/api/events/:id/guests/export',
    {
      schema: {
        tags: ['guests'],
        summary: 'Download guests as xlsx (sheets Guests + Companions) or csv',
        params: EventParams,
        body: z.object({
          format: z.enum(['xlsx', 'csv']).default('xlsx'),
          includeHeader: z.boolean().default(true),
          status: z.enum(['all', 'yes', 'no', 'pending']).default('all'),
          columns: z.array(z.enum(Object.keys(EXPORT_COLUMNS) as [ExportColumn, ...ExportColumn[]])).min(1).max(20).default(DEFAULT_EXPORT_COLUMNS),
        }),
      },
    },
    async (req, reply) => {
      const { event, user } = await requireEventAccess(req, req.params.id, 'read');
      const rows = await prisma.guest.findMany({ where: listWhere(event.id, { status: req.body.status, trash: false }), include: { companions: { orderBy: { sort: 'asc' } } }, orderBy: { submittedAt: 'asc' } });
      const base = `guests-${slugify(event.title) || 'event'}-${new Date().toISOString().slice(0, 10)}`;
      await logActivity({ eventId: event.id, actorType: 'host', actorId: user.id, action: 'guests.exported', data: { format: req.body.format, count: rows.length } });
      if (req.body.format === 'csv') {
        reply.header('content-disposition', `attachment; filename="${base}.csv"`);
        return reply.type('text/csv; charset=utf-8').send(buildCsv(rows, req.body.columns));
      }
      reply.header('content-disposition', `attachment; filename="${base}.xlsx"`);
      return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await buildXlsx(event, rows, req.body.columns, req.body.includeHeader));
    },
  );
}
