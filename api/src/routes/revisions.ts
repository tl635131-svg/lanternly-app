import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { isStudio, requireEventAccess } from '../lib/auth.js';
import { publish } from '../lib/bus.js';
import { AppError, notFound } from '../lib/errors.js';
import { revisionDto } from '../lib/serializers.js';
import { enqueueMessage } from '../services/messaging/index.js';
import { adminEventUrl } from '../services/provisioning.js';
import { EventParams, type ZApp } from './types.js';

export const UNLIMITED_ROUNDS = 99;
export const previewUrl = (slug: string, token: string | null) => (token ? `${config.INVITE_BASE_URL}/${slug}?preview=${encodeURIComponent(token)}` : null);

export async function revisionsSummary(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const [items, inv] = await Promise.all([
    prisma.revision.findMany({ where: { eventId }, orderBy: { roundNumber: 'asc' }, include: { comments: { include: { author: true }, orderBy: { createdAt: 'asc' } } } }),
    prisma.invitation.findFirst({ where: { eventId }, orderBy: { createdAt: 'asc' } }),
  ]);
  const used = items.length;
  const unlimited = event.maxRevisionRounds >= UNLIMITED_ROUNDS;
  const open = items.some((r) => r.status !== 'completed');
  const remaining = unlimited ? null : Math.max(event.maxRevisionRounds - used, 0);
  const canSubmit = event.serviceMode === 'studio' && event.productionStage === 'review' && !event.designApprovedAt && !open && (unlimited || remaining! > 0);
  return {
    maxRounds: event.maxRevisionRounds,
    unlimited,
    used,
    remaining,
    open,
    canSubmit,
    canApprove: event.serviceMode === 'studio' && !event.designApprovedAt && !open && ['review', 'delivered'].includes(event.productionStage),
    stage: event.productionStage,
    draftUrl: inv ? previewUrl(inv.slug, inv.previewToken) : null,
    approvedAt: event.designApprovedAt,
    items: items.map(revisionDto),
  };
}

export default async function revisions(app: ZApp) {
  app.get('/api/events/:id/revisions', { schema: { tags: ['revisions'], params: EventParams } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'read');
    return revisionsSummary(event.id);
  });

  app.post('/api/events/:id/revisions', { schema: { tags: ['revisions'], params: EventParams, body: z.object({ request: z.string().trim().min(5).max(5000) }) } }, async (req, reply) => {
    const { event, user } = await requireEventAccess(req, req.params.id, 'write');
    const summary = await revisionsSummary(event.id);
    if (!summary.canSubmit) {
      const reason =
        event.serviceMode !== 'studio' ? 'Revisions are only available for studio-designed invitations.'
        : event.designApprovedAt ? 'The design is already approved.'
        : summary.open ? 'We are still working on your latest changes.'
        : event.productionStage !== 'review' ? 'You can request changes as soon as we share your first draft.'
        : 'You have used all your revision rounds. Information changes are still welcome — contact the studio.';
      throw new AppError(409, 'REVISION_NOT_ALLOWED', reason, undefined, { summary: { open: summary.open, remaining: summary.remaining, stage: summary.stage } });
    }
    const rev = await prisma.revision.create({ data: { eventId: event.id, roundNumber: summary.used + 1, request: req.body.request, createdById: user.id } });
    await enqueueMessage({ to: config.STUDIO_INBOX, template: 'revision_received_studio', data: { round: rev.roundNumber, title: event.title, request: rev.request, adminUrl: adminEventUrl(event.id) }, eventId: event.id });
    await logActivity({ eventId: event.id, actorType: 'host', actorId: user.id, action: 'revision.created', data: { round: rev.roundNumber } });
    publish(event.id, 'revision.updated', { id: rev.id, status: rev.status });
    return reply.code(201).send(revisionDto(rev));
  });

  app.post('/api/events/:id/approve', { schema: { tags: ['revisions'], summary: 'Approve the final design (irreversible)', params: EventParams } }, async (req) => {
    const { event, user } = await requireEventAccess(req, req.params.id, 'write');
    const summary = await revisionsSummary(event.id);
    if (!summary.canApprove) throw new AppError(409, 'REVISION_NOT_ALLOWED', event.designApprovedAt ? 'Already approved.' : summary.open ? 'Please wait until the open revision round is completed.' : 'There is no draft to approve yet.');
    await prisma.event.update({ where: { id: event.id }, data: { designApprovedAt: new Date() } });
    await logActivity({ eventId: event.id, actorType: 'host', actorId: user.id, action: 'design.approved' });
    await enqueueMessage({ to: config.STUDIO_INBOX, template: 'custom', data: { subject: `Design approved: ${event.title}`, body: `${event.title} approved their final design.`, url: adminEventUrl(event.id), urlLabel: 'Open in studio' }, eventId: event.id });
    publish(event.id, 'revision.updated', { approved: true });
    return revisionsSummary(event.id);
  });

  app.post(
    '/api/events/:id/revisions/:revisionId/comments',
    { schema: { tags: ['revisions'], params: EventParams.extend({ revisionId: z.string().uuid() }), body: z.object({ body: z.string().trim().min(1).max(3000) }) } },
    async (req, reply) => {
      const { event, user } = await requireEventAccess(req, req.params.id, 'write');
      const rev = await prisma.revision.findFirst({ where: { id: req.params.revisionId, eventId: event.id } });
      if (!rev) throw notFound('Revision');
      const c = await prisma.revisionComment.create({ data: { revisionId: rev.id, authorId: user.id, body: req.body.body }, include: { author: true } });
      await logActivity({ eventId: event.id, actorType: isStudio(user) ? 'admin' : 'host', actorId: user.id, action: 'revision.commented', data: { round: rev.roundNumber } });
      publish(event.id, 'revision.updated', { id: rev.id, comment: c.id });
      return reply.code(201).send({ id: c.id, body: c.body, createdAt: c.createdAt, author: { id: user.id, name: user.name, role: user.role } });
    },
  );
}
