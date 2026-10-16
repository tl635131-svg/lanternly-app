import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { conflict, validation } from '../lib/errors.js';

export const TableInput = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(60),
  shape: z.enum(['round', 'rect', 'square', 'u_shape', 'serpentine', 'head']),
  seats: z.number().int().min(1).max(60),
  note: z.string().trim().max(300).nullish(),
  x: z.number().min(-10000).max(10000).default(0),
  y: z.number().min(-10000).max(10000).default(0),
  rotation: z.number().min(-360).max(360).default(0),
});
export const LayoutElement = z.object({
  id: z.string().max(64),
  kind: z.enum(['dance_floor', 'stage', 'bar', 'entrance', 'cake', 'dj', 'buffet', 'other']),
  label: z.string().max(60).optional(),
  x: z.number(),
  y: z.number(),
  w: z.number().min(0).max(5000),
  h: z.number().min(0).max(5000),
  rotation: z.number().min(-360).max(360).default(0),
});
export const AssignmentInput = z
  .object({ tableId: z.string().uuid(), guestId: z.string().uuid().nullish(), companionId: z.string().uuid().nullish(), seatIndex: z.number().int().min(0).max(59).nullish() })
  .refine((a) => !!a.guestId !== !!a.companionId, 'Each assignment needs exactly one of guestId or companionId');
export const SeatingPutInput = z.object({
  version: z.number().int().min(0),
  layout: z.array(LayoutElement).max(100).default([]),
  tables: z.array(TableInput).max(200),
  assignments: z.array(AssignmentInput).max(2000),
});

/** Confirmed parties (main guest + companions) eligible for seating. */
async function parties(eventId: string) {
  const guests = await prisma.guest.findMany({
    where: { eventId, deletedAt: null, attendance: 'yes' },
    include: { companions: { orderBy: { sort: 'asc' } } },
    orderBy: { submittedAt: 'asc' },
  });
  return guests.map((g) => ({
    guestId: g.id,
    name: g.fullName,
    partySize: 1 + g.companions.length,
    members: [
      { kind: 'guest' as const, id: g.id, fullName: g.fullName, type: 'adult' as const, meal: g.primaryMeal, dietary: g.primaryDietary || (g.dietaryTags.length ? g.dietaryTags.join(', ') : null) },
      ...g.companions.map((c) => ({ kind: 'companion' as const, id: c.id, fullName: c.fullName, type: c.type, meal: c.meal, dietary: c.dietary })),
    ],
  }));
}

export async function getSeating(eventId: string) {
  const [plan, tables, assignments, ps] = await Promise.all([
    prisma.seatingPlan.findUnique({ where: { eventId } }),
    prisma.seatingTable.findMany({ where: { eventId }, orderBy: { sort: 'asc' } }),
    prisma.seatAssignment.findMany({ where: { table: { eventId } } }),
    parties(eventId),
  ]);
  const memberById = new Map(ps.flatMap((p) => p.members.map((m) => [m.id, m] as const)));
  const seatedIds = new Set(assignments.map((a) => a.guestId ?? a.companionId!));
  const tableSummaries = tables.map((t) => {
    const seated = assignments.filter((a) => a.tableId === t.id);
    const members = seated.map((a) => memberById.get(a.guestId ?? a.companionId!)).filter(Boolean);
    return {
      id: t.id,
      label: t.label,
      shape: t.shape,
      seats: t.seats,
      note: t.note,
      x: t.x,
      y: t.y,
      rotation: t.rotation,
      used: seated.length,
      overBy: Math.max(seated.length - t.seats, 0),
      kidsCount: members.filter((m) => m!.type === 'child').length,
      dietaryCount: members.filter((m) => !!m!.dietary).length,
    };
  });
  const totalPeople = ps.reduce((s, p) => s + p.partySize, 0);
  return {
    version: plan?.version ?? 0,
    layout: (plan?.layout as unknown[]) ?? [],
    tables: tableSummaries,
    assignments: assignments.map((a) => ({ id: a.id, tableId: a.tableId, guestId: a.guestId, companionId: a.companionId, seatIndex: a.seatIndex })),
    parties: ps.map((p) => ({ ...p, members: p.members.map((m) => ({ ...m, seated: seatedIds.has(m.id) })) })),
    stats: {
      confirmedPeople: totalPeople,
      seated: seatedIds.size,
      unseated: Math.max(totalPeople - seatedIds.size, 0),
      tables: tables.length,
      seats: tables.reduce((s, t) => s + t.seats, 0),
    },
  };
}

/** Full replace with optimistic concurrency (version). */
export async function putSeating(eventId: string, input: z.infer<typeof SeatingPutInput>) {
  const ps = await parties(eventId);
  const validGuests = new Set(ps.map((p) => p.guestId));
  const validCompanions = new Set(ps.flatMap((p) => p.members.filter((m) => m.kind === 'companion').map((m) => m.id)));
  const tableIds = new Set(input.tables.map((t) => t.id));
  if (tableIds.size !== input.tables.length) throw validation('Duplicate table ids.');
  const seen = new Set<string>();
  const fields: Record<string, string> = {};
  input.assignments.forEach((a, i) => {
    const target = (a.guestId ?? a.companionId)!;
    if (!tableIds.has(a.tableId)) fields[`assignments.${i}.tableId`] = 'Unknown table';
    if (a.guestId && !validGuests.has(a.guestId)) fields[`assignments.${i}.guestId`] = 'Guest is not a confirmed attendee of this event';
    if (a.companionId && !validCompanions.has(a.companionId)) fields[`assignments.${i}.companionId`] = 'Companion is not a confirmed attendee of this event';
    if (seen.has(target)) fields[`assignments.${i}`] = 'Person is assigned twice';
    seen.add(target);
  });
  if (Object.keys(fields).length) throw validation('Seating plan is invalid.', fields);

  // Tables may only be (re)used within the same event.
  const foreign = await prisma.seatingTable.count({ where: { id: { in: [...tableIds] }, NOT: { eventId } } });
  if (foreign > 0) throw validation('Table id belongs to another event.');

  await prisma.$transaction(async (tx) => {
    const current = await tx.seatingPlan.upsert({ where: { eventId }, create: { eventId, layout: [], version: 0 }, update: {} });
    if (current.version !== input.version) throw conflict('VERSION_CONFLICT', 'The seating plan was changed elsewhere. Reload and try again.', { currentVersion: current.version });
    await tx.seatingPlan.update({ where: { eventId }, data: { layout: input.layout as Prisma.InputJsonValue, version: { increment: 1 } } });
    await tx.seatAssignment.deleteMany({ where: { table: { eventId } } });
    await tx.seatingTable.deleteMany({ where: { eventId, id: { notIn: [...tableIds] } } });
    for (const [i, t] of input.tables.entries()) {
      const data = { label: t.label, shape: t.shape, seats: t.seats, note: t.note ?? null, x: t.x, y: t.y, rotation: t.rotation, sort: i };
      await tx.seatingTable.upsert({ where: { id: t.id }, create: { id: t.id, eventId, ...data }, update: data });
    }
    if (input.assignments.length) {
      await tx.seatAssignment.createMany({ data: input.assignments.map((a) => ({ tableId: a.tableId, guestId: a.guestId ?? null, companionId: a.companionId ?? null, seatIndex: a.seatIndex ?? null })) });
    }
  });
  return getSeating(eventId);
}

/**
 * Auto-arrange: first-fit-decreasing by party size, keeping parties together when possible.
 * Keeps existing assignments; only places unseated people.
 */
export async function autoArrange(eventId: string, opts: { keepPartiesTogether: boolean }) {
  const s = await getSeating(eventId);
  const remaining = new Map(s.tables.map((t) => [t.id, t.seats - t.used]));
  const proposed = s.assignments.map((a) => ({ tableId: a.tableId, guestId: a.guestId, companionId: a.companionId, seatIndex: a.seatIndex }));
  const unseated: { guestId: string; members: string[] }[] = [];
  const queue = s.parties
    .map((p) => ({ guestId: p.guestId, members: p.members.filter((m) => !m.seated) }))
    .filter((p) => p.members.length > 0)
    .sort((a, b) => b.members.length - a.members.length);
  const tablesBySpace = () => [...remaining.entries()].sort((a, b) => b[1] - a[1]);
  for (const party of queue) {
    const fit = tablesBySpace().find(([, free]) => free >= party.members.length);
    if (fit) {
      for (const m of party.members) proposed.push({ tableId: fit[0], guestId: m.kind === 'guest' ? m.id : null, companionId: m.kind === 'companion' ? m.id : null, seatIndex: null });
      remaining.set(fit[0], fit[1] - party.members.length);
    } else if (!opts.keepPartiesTogether) {
      const left: string[] = [];
      for (const m of party.members) {
        const t = tablesBySpace().find(([, free]) => free > 0);
        if (!t) {
          left.push(m.id);
          continue;
        }
        proposed.push({ tableId: t[0], guestId: m.kind === 'guest' ? m.id : null, companionId: m.kind === 'companion' ? m.id : null, seatIndex: null });
        remaining.set(t[0], t[1] - 1);
      }
      if (left.length) unseated.push({ guestId: party.guestId, members: left });
    } else {
      unseated.push({ guestId: party.guestId, members: party.members.map((m) => m.id) });
    }
  }
  return { version: s.version, assignments: proposed, unseated };
}
