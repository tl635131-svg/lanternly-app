import ExcelJS from 'exceljs';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { requireEventAccess } from '../lib/auth.js';
import { randomToken } from '../lib/crypto.js';
import { AppError, notFound, validation } from '../lib/errors.js';
import { pageArgs, pageResult } from '../lib/pagination.js';
import { inviteeDto } from '../lib/serializers.js';
import { inviteUrl } from '../services/provisioning.js';
import { EventParams, type ZApp } from './types.js';
import { queryBoolDefault } from '../lib/query.js';
import { personalShareText, shareLocale, shareSubject, type ShareLocale } from '../lib/share-text.js';

/** Normalise to E.164. Numbers without a country code default to +1 (Canada/US). */
export function normalizePhone(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw.trim() === '') return null;
  const plus = raw.trim().startsWith('+') || raw.trim().startsWith('00');
  const digits = raw.replace(/\D/g, '').replace(/^00/, '');
  if (plus) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : undefined;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return undefined;
}

const InviteeInput = z.object({
  householdName: z.string().trim().max(120).nullish(),
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().max(80).nullish(),
  email: z.string().trim().toLowerCase().email('Invalid email').max(255).nullish().or(z.literal('').transform(() => null)),
  phone: z.string().trim().max(40).nullish(),
  language: z.string().max(20).nullish(),
  maxPartySize: z.number().int().min(1).max(20).default(1),
  knownCompanions: z.array(z.object({ fullName: z.string().trim().min(1).max(100), type: z.enum(['adult', 'child']).default('adult') })).max(19).default([]),
  groupLabel: z.string().trim().max(60).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
type InviteeInputT = z.infer<typeof InviteeInput>;
const InviteeParams = EventParams.extend({ inviteeId: z.string().uuid() });

function toCreate(eventId: string, b: InviteeInputT): Prisma.InviteeCreateManyInput {
  const phone = normalizePhone(b.phone);
  if (b.phone && !phone) throw validation('Invalid phone number.', { phone: 'Use international format, e.g. +14165550123' });
  return {
    eventId,
    householdName: b.householdName ?? null,
    firstName: b.firstName,
    lastName: b.lastName ?? null,
    email: b.email ?? null,
    phoneE164: phone ?? null,
    language: b.language ?? null,
    maxPartySize: Math.max(b.maxPartySize, 1 + b.knownCompanions.length),
    knownCompanions: b.knownCompanions,
    groupLabel: b.groupLabel ?? null,
    notes: b.notes ?? null,
    token: randomToken(16),
  };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === ';' || ch === '\t') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const HEADER_MAP: Record<string, keyof InviteeInputT | 'phone'> = {
  firstname: 'firstName', first: 'firstName', 'first name': 'firstName', name: 'firstName',
  lastname: 'lastName', last: 'lastName', 'last name': 'lastName', surname: 'lastName',
  household: 'householdName', householdname: 'householdName', 'household name': 'householdName', family: 'householdName',
  email: 'email', 'e-mail': 'email', phone: 'phone', mobile: 'phone', whatsapp: 'phone',
  language: 'language', lang: 'language', maxpartysize: 'maxPartySize', 'party size': 'maxPartySize', seats: 'maxPartySize', partysize: 'maxPartySize',
  group: 'groupLabel', grouplabel: 'groupLabel', notes: 'notes',
};

function rowsToInputs(table: string[][]) {
  const [header, ...body] = table;
  if (!header) return { rows: [] as InviteeInputT[], errors: [{ row: 0, message: 'File is empty' }] };
  const cols = header.map((h) => HEADER_MAP[h.trim().toLowerCase().replace(/^\uFEFF/, '')]);
  if (!cols.includes('firstName')) return { rows: [], errors: [{ row: 1, message: 'A "firstName" (or "name") column is required' }] };
  const rows: InviteeInputT[] = [];
  const errors: { row: number; message: string; fields?: Record<string, string> }[] = [];
  body.slice(0, 2000).forEach((r, idx) => {
    const obj: Record<string, unknown> = {};
    cols.forEach((c, i) => {
      if (c && r[i] !== undefined && r[i]!.trim() !== '') obj[c] = c === 'maxPartySize' ? Number(r[i]) : r[i]!.trim();
    });
    const parsed = InviteeInput.safeParse(obj);
    if (!parsed.success) {
      errors.push({ row: idx + 2, message: 'Invalid row', fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])) });
      return;
    }
    if (parsed.data.phone && !normalizePhone(parsed.data.phone)) {
      errors.push({ row: idx + 2, message: 'Invalid phone', fields: { phone: 'Invalid phone number' } });
      return;
    }
    rows.push(parsed.data);
  });
  return { rows, errors };
}

export default async function invitees(app: ZApp) {
  // Allow posting a raw CSV body (text/csv) to the import endpoint, in addition to multipart and JSON.
  app.addContentTypeParser(['text/csv', 'text/plain'], { parseAs: 'string', bodyLimit: 5 * 1024 * 1024 }, (_req, body, done) => done(null, body));
  async function slugFor(eventId: string) {
    return (await prisma.invitation.findFirst({ where: { eventId }, orderBy: { createdAt: 'asc' }, select: { slug: true } }))?.slug ?? null;
  }

  app.get(
    '/api/events/:id/invitees',
    { schema: { tags: ['invitees'], params: EventParams, querystring: z.object({ status: z.enum(['not_sent', 'sent', 'opened', 'responded', 'bounced', 'opted_out']).optional(), q: z.string().max(100).optional(), cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }) } },
    async (req) => {
      const { event } = await requireEventAccess(req, req.params.id, 'read');
      const q = req.query.q?.trim();
      const where: Prisma.InviteeWhereInput = {
        eventId: event.id,
        deletedAt: null,
        ...(req.query.status ? { status: req.query.status } : {}),
        ...(q ? { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { householdName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {}),
      };
      const [rows, counts] = await Promise.all([
        prisma.invitee.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(req.query.cursor, req.query.limit) }),
        prisma.invitee.groupBy({ by: ['status'], where: { eventId: event.id, deletedAt: null }, _count: { _all: true } }),
      ]);
      const slug = await slugFor(event.id);
      const page = pageResult(rows, req.query.limit);
      return { items: page.items.map((i) => inviteeDto(i, slug)), nextCursor: page.nextCursor, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
    },
  );

  app.post('/api/events/:id/invitees', { schema: { tags: ['invitees'], params: EventParams, body: InviteeInput } }, async (req, reply) => {
    const { event, user } = await requireEventAccess(req, req.params.id, 'write');
    const inv = await prisma.invitee.create({ data: toCreate(event.id, req.body) });
    await logActivity({ eventId: event.id, actorType: 'host', actorId: user.id, action: 'invitee.added', data: { inviteeId: inv.id } });
    return reply.code(201).send(inviteeDto(inv, await slugFor(event.id)));
  });

  /**
   * Import invitees. Send multipart (field "file": .csv or .xlsx) or JSON { rows: [...] }.
   * Without ?commit=true returns a preview { rows, errors }; with commit=true creates the valid rows.
   */
  app.post('/api/events/:id/invitees/import', { schema: { tags: ['invitees'], params: EventParams, querystring: z.object({ commit: queryBoolDefault(false) }) } }, async (req, reply) => {
    const { event, user } = await requireEventAccess(req, req.params.id, 'write');
    let parsed: ReturnType<typeof rowsToInputs>;
    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) throw validation('No file uploaded.', { file: 'Required' });
      const buf = await file.toBuffer();
      if (buf.length > 5 * 1024 * 1024) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'File is too large (5 MB max).');
      if (/\.xlsx$/i.test(file.filename) || file.mimetype.includes('spreadsheetml')) {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf as any);
        const ws = wb.worksheets[0];
        const table: string[][] = [];
        ws?.eachRow((row) => table.push((row.values as unknown[]).slice(1).map((v) => (v == null ? '' : typeof v === 'object' && v && 'text' in (v as any) ? String((v as any).text) : String(v)))));
        parsed = rowsToInputs(table);
      } else {
        parsed = rowsToInputs(parseCsv(buf.toString('utf8')));
      }
    } else if (typeof req.body === 'string') {
      parsed = rowsToInputs(parseCsv(req.body));
    } else {
      const body = z.object({ rows: z.array(z.record(z.string(), z.unknown())).max(2000) }).parse(req.body);
      const rows: InviteeInputT[] = [];
      const errors: { row: number; message: string; fields?: Record<string, string> }[] = [];
      body.rows.forEach((r, i) => {
        const p = InviteeInput.safeParse(r);
        if (p.success && (!p.data.phone || normalizePhone(p.data.phone))) rows.push(p.data);
        else errors.push({ row: i + 1, message: 'Invalid row', fields: p.success ? { phone: 'Invalid phone number' } : Object.fromEntries(p.error.issues.map((x) => [x.path.join('.'), x.message])) });
      });
      parsed = { rows, errors };
    }
    if (!req.query.commit) return { rows: parsed.rows, errors: parsed.errors, valid: parsed.rows.length, invalid: parsed.errors.length };
    const data = parsed.rows.map((r) => toCreate(event.id, r));
    await prisma.invitee.createMany({ data });
    await logActivity({ eventId: event.id, actorType: 'host', actorId: user.id, action: 'invitees.imported', data: { count: data.length } });
    return reply.code(201).send({ created: data.length, errors: parsed.errors });
  });

  app.patch('/api/events/:id/invitees/:inviteeId', { schema: { tags: ['invitees'], params: InviteeParams, body: InviteeInput.partial() } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'write');
    const inv = await prisma.invitee.findFirst({ where: { id: req.params.inviteeId, eventId: event.id, deletedAt: null } });
    if (!inv) throw notFound('Invitee');
    const b = req.body;
    const phone = normalizePhone(b.phone);
    if (b.phone && !phone) throw validation('Invalid phone number.', { phone: 'Use international format, e.g. +14165550123' });
    const updated = await prisma.invitee.update({
      where: { id: inv.id },
      data: {
        householdName: b.householdName,
        firstName: b.firstName,
        lastName: b.lastName,
        email: b.email,
        phoneE164: phone,
        language: b.language,
        maxPartySize: b.maxPartySize,
        knownCompanions: b.knownCompanions,
        groupLabel: b.groupLabel,
        notes: b.notes,
      },
    });
    return inviteeDto(updated, await slugFor(event.id));
  });

  app.delete('/api/events/:id/invitees/:inviteeId', { schema: { tags: ['invitees'], params: InviteeParams } }, async (req, reply) => {
    const { event } = await requireEventAccess(req, req.params.id, 'write');
    const inv = await prisma.invitee.findFirst({ where: { id: req.params.inviteeId, eventId: event.id, deletedAt: null } });
    if (!inv) throw notFound('Invitee');
    // Soft delete + rotate token so the old personal link stops working.
    await prisma.invitee.update({ where: { id: inv.id }, data: { deletedAt: new Date(), token: randomToken(16) } });
    return reply.code(204).send();
  });

  app.get('/api/events/:id/invitees/:inviteeId/link', { schema: { tags: ['invitees'], params: InviteeParams } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'read');
    const inv = await prisma.invitee.findFirst({ where: { id: req.params.inviteeId, eventId: event.id, deletedAt: null } });
    if (!inv) throw notFound('Invitee');
    const slug = await slugFor(event.id);
    if (!slug) throw notFound('Invitation');
    const url = inviteUrl(slug, inv.token);
    // Household language first, then the event's primary language; English if neither has a template.
    const language: ShareLocale = shareLocale(inv.language) ?? shareLocale(event.primaryLanguage) ?? 'en';
    const text = personalShareText(language, { title: event.title, hostNames: event.hostNames, url, firstName: inv.firstName });
    const subject = shareSubject(language, event.title);
    return {
      url,
      text,
      language,
      whatsappUrl: inv.phoneE164 ? `https://wa.me/${inv.phoneE164.replace('+', '')}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`,
      smsUrl: `sms:${inv.phoneE164 ?? ''}?&body=${encodeURIComponent(text)}`,
      mailto: inv.email ? `mailto:${inv.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}` : null,
      qrPng: `/api/events/${event.id}/qr?format=png&inviteeId=${inv.id}`,
    };
  });

  app.post('/api/events/:id/invitees/:inviteeId/rotate-token', { schema: { tags: ['invitees'], summary: 'Invalidate the old personal link and issue a new one', params: InviteeParams } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'write');
    const inv = await prisma.invitee.findFirst({ where: { id: req.params.inviteeId, eventId: event.id, deletedAt: null } });
    if (!inv) throw notFound('Invitee');
    const updated = await prisma.invitee.update({ where: { id: inv.id }, data: { token: randomToken(16) } });
    return inviteeDto(updated, await slugFor(event.id));
  });

  app.post('/api/events/:id/invitees/:inviteeId/mark-sent', { schema: { tags: ['invitees'], summary: 'Mark as sent after sharing manually (e.g. WhatsApp)', params: InviteeParams, body: z.object({ channel: z.enum(['whatsapp', 'sms', 'email', 'link', 'qr']).default('link') }).default({ channel: 'link' }) } }, async (req) => {
    const { event, user } = await requireEventAccess(req, req.params.id, 'write');
    const inv = await prisma.invitee.findFirst({ where: { id: req.params.inviteeId, eventId: event.id, deletedAt: null } });
    if (!inv) throw notFound('Invitee');
    const updated = await prisma.invitee.update({ where: { id: inv.id }, data: { status: inv.status === 'not_sent' ? 'sent' : inv.status, sentAt: inv.sentAt ?? new Date() } });
    await logActivity({ eventId: event.id, actorType: 'host', actorId: user.id, action: 'invitee.marked_sent', data: { inviteeId: inv.id, channel: req.body.channel } });
    return inviteeDto(updated, await slugFor(event.id));
  });
}
