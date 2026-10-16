import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { requireEventAccess } from '../lib/auth.js';
import { briefCompletion, briefSectionSchema, mergedRsvpSettings } from '../lib/brief.js';
import { publish } from '../lib/bus.js';
import { SECTION_LABELS } from '../lib/catalogue.js';
import { AppError, conflict, notFound, unprocessable, validation } from '../lib/errors.js';
import { assetDto } from '../lib/serializers.js';
import { enqueueMessage } from '../services/messaging/index.js';
import { adminEventUrl } from '../services/provisioning.js';
import { ASSET_KINDS, sniffMime, storage, UPLOAD_RULES } from '../services/storage/index.js';
import { EventParams, rl, type ZApp } from './types.js';
import type { FastifyRequest } from 'fastify';
import { assertOwnSongEnabled, ownSongEnabled } from '../lib/features.js';
import { ensureRights, recordRightsConfirmation, rightsDto, rightsRequired } from '../services/music-rights.js';
import { queryBool } from '../lib/query.js';

export function briefResponse(brief: { sections: string[]; newSections: string[]; customBlockNames: any; data: any; status: string; submittedAt: Date | null; locked: boolean; resubmissionCount: number; updatedAt: Date }) {
  return {
    sections: brief.sections.map((key) => ({ key, label: key.startsWith('custom:') ? (brief.customBlockNames?.[key] ?? key.slice(7)) : (SECTION_LABELS[key] ?? key) })),
    customBlockNames: brief.customBlockNames,
    data: brief.data,
    status: brief.status,
    locked: brief.locked,
    submittedAt: brief.submittedAt,
    resubmissionCount: brief.resubmissionCount,
    newSections: brief.newSections,
    completion: briefCompletion(brief.sections, brief.data ?? {}),
    updatedAt: brief.updatedAt,
  };
}

/** Validate and merge a partial brief update. `allowLocked` for studio staff. */
export async function applyBriefPatch(eventId: string, patch: Record<string, unknown>, opts: { allowLocked: boolean; userId?: string | null; req?: FastifyRequest }) {
  const brief = await prisma.brief.findUnique({ where: { eventId } });
  if (!brief) throw notFound('Brief');
  const data = { ...((brief.data as Record<string, unknown>) ?? {}) };
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!brief.sections.includes(key)) {
      fields[key] = 'This section is not part of your brief';
      continue;
    }
    if (!opts.allowLocked && (brief.locked || brief.status === 'archived') && !brief.newSections.includes(key)) {
      throw conflict('BRIEF_LOCKED', 'Your brief has been submitted and is locked. Contact the studio for changes.');
    }
    const schema = briefSectionSchema(key);
    const parsed = schema!.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) fields[[key, ...issue.path.map(String)].join('.')] ??= issue.message;
      continue;
    }
    const merged = { ...((data[key] as object) ?? {}), ...(parsed.data as object) } as Record<string, any>;
    if (key === 'own_song') {
      assertOwnSongEnabled();
      // A couple's own song (upload or link) needs the "I have the rights to use this music" tick. Library tracks don't.
      const confirmed = (parsed.data as any).rightsConfirmed === true;
      if (merged.assetId) {
        const asset = await prisma.asset.findFirst({ where: { id: merged.assetId, eventId, kind: 'music', deletedAt: null } });
        if (!asset) fields['own_song.assetId'] = 'Upload the song to this event first (kind=music)';
        else await ensureRights(eventId, { assetId: asset.id }, { confirmed, userId: opts.userId ?? null, req: opts.req });
      }
      if (typeof merged.url === 'string' && merged.url) await ensureRights(eventId, { url: merged.url }, { confirmed, userId: opts.userId ?? null, req: opts.req });
    }
    data[key] = merged;
  }
  if (Object.keys(fields).length) throw validation('Some fields are invalid.', fields);
  const updated = await prisma.brief.update({ where: { eventId }, data: { data: data as any, status: brief.status === 'not_started' ? 'in_progress' : brief.status } });
  if (patch.rsvp) {
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    await prisma.event.update({ where: { id: eventId }, data: { rsvpSettings: { ...mergedRsvpSettings(event.rsvpSettings), ...(data.rsvp as object) } } });
  }
  publish(eventId, 'brief.updated', {});
  return updated;
}

export default async function brief(app: ZApp) {
  app.get('/api/events/:id/brief', { schema: { tags: ['brief'], params: EventParams } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'read');
    const brief = await prisma.brief.findUnique({ where: { eventId: event.id } });
    if (!brief) throw notFound('Brief');
    return briefResponse(brief);
  });

  app.patch(
    '/api/events/:id/brief',
    { schema: { tags: ['brief'], summary: 'Autosave: merge section data', params: EventParams, body: z.object({ data: z.record(z.string().max(80), z.unknown()) }) } },
    async (req) => {
      const { event, user } = await requireEventAccess(req, req.params.id, 'write');
      return briefResponse(await applyBriefPatch(event.id, req.body.data, { allowLocked: false, userId: user.id, req }));
    },
  );

  app.post('/api/events/:id/brief/submit', { schema: { tags: ['brief'], params: EventParams } }, async (req) => {
    const { event, user } = await requireEventAccess(req, req.params.id, 'write');
    const brief = await prisma.brief.findUnique({ where: { eventId: event.id } });
    if (!brief) throw notFound('Brief');
    if (brief.status === 'archived') throw conflict('BRIEF_LOCKED', 'This brief is archived.');
    if (brief.locked && brief.newSections.length === 0) throw conflict('BRIEF_LOCKED', 'Your brief was already submitted.');
    const completion = briefCompletion(brief.sections, brief.data as any);
    if (completion.missing.length) throw new AppError(422, 'BRIEF_INCOMPLETE', `${completion.missing.length} section(s) still need details.`, Object.fromEntries(completion.missing.map((m) => [m, 'Incomplete'])));
    const isResubmit = !!brief.submittedAt;
    const updated = await prisma.brief.update({
      where: { eventId: event.id },
      data: { status: 'submitted', locked: true, submittedAt: new Date(), newSections: [], resubmissionCount: isResubmit ? { increment: 1 } : undefined },
    });
    if (event.productionStage === 'order_received') {
      await prisma.event.update({ where: { id: event.id }, data: { productionStage: 'brief_received' } });
      publish(event.id, 'stage.changed', { stage: 'brief_received' });
    }
    await enqueueMessage({ to: config.STUDIO_INBOX, template: 'brief_submitted_studio', data: { title: event.title, isResubmit, adminUrl: adminEventUrl(event.id) }, eventId: event.id });
    await logActivity({ eventId: event.id, actorType: 'host', actorId: user.id, action: 'brief.submitted', data: { isResubmit } });
    return briefResponse(updated);
  });

  // ── uploads ──
  app.get('/api/events/:id/assets', { schema: { tags: ['assets'], params: EventParams, querystring: z.object({ kind: z.enum(Object.keys(ASSET_KINDS) as [string, ...string[]]).optional() }) } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'read');
    const rows = await prisma.asset.findMany({ where: { eventId: event.id, deletedAt: null, ...(req.query.kind ? { kind: req.query.kind } : {}) }, orderBy: { createdAt: 'desc' } });
    return { items: rows.map(assetDto) };
  });

  app.post(
    '/api/events/:id/assets',
    { config: rl(app, 60, '1 minute'), schema: { tags: ['assets'], summary: 'multipart/form-data upload, field "file"', params: EventParams, querystring: z.object({ kind: z.enum(Object.keys(ASSET_KINDS) as [string, ...string[]]), rightsConfirmed: queryBool().optional() }) } },
    async (req, reply) => {
      const { event, user } = await requireEventAccess(req, req.params.id, 'write');
      if (!req.isMultipart()) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send multipart/form-data with a "file" field.');
      const file = await req.file();
      if (!file) throw validation('No file uploaded.', { file: 'Required' });
      const kind = req.query.kind as keyof typeof ASSET_KINDS;
      // Own-song uploads need the rights tick: multipart field rightsConfirmed=true (sent before the file) or ?rightsConfirmed=true.
      const fieldTick = (file.fields as any)?.rightsConfirmed;
      const ticked = req.query.rightsConfirmed === true || (fieldTick && !Array.isArray(fieldTick) && 'value' in fieldTick && ['true', '1'].includes(String(fieldTick.value)));
      if (kind === 'music' && !ownSongEnabled()) {
        file.file.resume();
        assertOwnSongEnabled();
      }
      if (kind === 'music' && !ticked) {
        file.file.resume();
        throw rightsRequired('this audio file');
      }
      const rule = UPLOAD_RULES[ASSET_KINDS[kind]]!;
      const buf = await file.toBuffer();
      if (file.file.truncated || buf.length > rule.maxBytes) throw new AppError(413, 'PAYLOAD_TOO_LARGE', `File is too large (max ${Math.round(rule.maxBytes / 1048576)} MB).`);
      const sniffed = sniffMime(buf);
      const mime = sniffed ?? file.mimetype;
      if (!rule.mimes.includes(mime) || (sniffed === null && !rule.mimes.includes(file.mimetype))) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', `Unsupported file type. Allowed: ${rule.mimes.join(', ')}`);
      if (!sniffed) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'The file content does not match an allowed type.');
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac' }[mime] ?? 'bin';
      const id = randomUUID();
      const key = `events/${event.id}/${id}.${ext}`;
      await storage.put(key, buf, mime);
      const asset = await prisma.asset.create({ data: { id, eventId: event.id, uploadedById: user.id, kind, storageKey: key, originalName: (file.filename || 'upload').slice(0, 200), mime, bytes: buf.length } });
      if (kind === 'music') await recordRightsConfirmation(event.id, user.id, { assetId: asset.id }, req);
      return reply.code(201).send(assetDto(asset));
    },
  );

  // ── music rights confirmations (own song) ──
  app.get('/api/events/:id/music-rights', { schema: { tags: ['assets'], summary: 'Own-song rights confirmations ("Rights confirmed by <name> on <date>")', params: EventParams } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'read');
    assertOwnSongEnabled();
    const rows = await prisma.musicRightsConfirmation.findMany({ where: { eventId: event.id }, orderBy: { confirmedAt: 'desc' }, include: { user: { select: { name: true } } } });
    return { items: rows.map(rightsDto) };
  });
  app.post(
    '/api/events/:id/music-rights',
    {
      schema: {
        tags: ['assets'],
        summary: 'Record "I have the rights to use this music" for an uploaded song or a song link',
        params: EventParams,
        body: z
          .object({ assetId: z.string().uuid().optional(), url: z.string().trim().url().max(500).optional(), confirmed: z.boolean() })
          .refine((b) => !!b.assetId !== !!b.url, { message: 'Send exactly one of assetId or url', path: ['assetId'] }),
      },
    },
    async (req, reply) => {
      const { event, user } = await requireEventAccess(req, req.params.id, 'write');
      assertOwnSongEnabled();
      if (req.body.confirmed !== true) throw rightsRequired();
      if (req.body.assetId && !(await prisma.asset.findFirst({ where: { id: req.body.assetId, eventId: event.id, kind: 'music', deletedAt: null } }))) throw notFound('Asset');
      const row = await recordRightsConfirmation(event.id, user.id, req.body.assetId ? { assetId: req.body.assetId } : { url: req.body.url! }, req);
      return reply.code(201).send({ id: row.id, confirmedAt: row.confirmedAt, userId: row.userId, statement: row.statement });
    },
  );

  app.delete('/api/events/:id/assets/:assetId', { schema: { tags: ['assets'], params: EventParams.extend({ assetId: z.string().uuid() }) } }, async (req, reply) => {
    const { event } = await requireEventAccess(req, req.params.id, 'write');
    const asset = await prisma.asset.findFirst({ where: { id: req.params.assetId, eventId: event.id, deletedAt: null } });
    if (!asset) throw notFound('Asset');
    await prisma.asset.update({ where: { id: asset.id }, data: { deletedAt: new Date() } });
    await storage.delete(asset.storageKey);
    return reply.code(204).send();
  });

  void unprocessable;
}
