import { z } from 'zod';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { requireEventAccess } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { CampaignSegment, KIND_TEMPLATE, segmentInvitees } from '../services/campaigns.js';
import { enqueueJob } from '../services/jobs/queue.js';
import { channelAvailable } from '../services/messaging/index.js';
import { EventParams, type ZApp } from './types.js';

const I18nText = (max: number) => z.record(z.string().max(20), z.string().trim().max(max));

function campaignDto(c: any) {
  return {
    id: c.id,
    kind: c.kind,
    channel: c.channel,
    segment: c.segment,
    templateKey: c.templateKey,
    subject: c.subjectI18n,
    body: c.bodyI18n,
    scheduledAt: c.scheduledAt,
    status: c.status,
    stats: c.stats,
    automatic: c.automatic,
    createdAt: c.createdAt,
  };
}

export default async function campaigns(app: ZApp) {
  app.post(
    '/api/events/:id/campaigns',
    {
      schema: {
        tags: ['campaigns'],
        summary: 'Schedule a bulk invite / reminder / update / thank-you (email channel; WhatsApp coming later)',
        params: EventParams,
        body: z.object({
          kind: z.enum(['invite', 'reminder', 'update', 'thank_you']),
          channel: z.enum(['email', 'whatsapp', 'sms']).default('email'),
          segment: CampaignSegment.default({}),
          subject: I18nText(200).optional(),
          body: I18nText(5000).optional(),
          scheduledAt: z.iso.datetime({ offset: true }).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { event, user } = await requireEventAccess(req, req.params.id, 'write');
      const b = req.body;
      if (!channelAvailable(b.channel)) throw new AppError(422, 'CHANNEL_NOT_AVAILABLE', `Sending by ${b.channel} is not available yet. Use personal links (wa.me) for now.`);
      const inv = await prisma.invitation.findFirst({ where: { eventId: event.id }, orderBy: { createdAt: 'asc' } });
      if (!inv || inv.status !== 'published') throw new AppError(409, 'CONFLICT', 'Publish your invitation before sending it to guests.');
      const recipients = await segmentInvitees(event.id, b.segment, b.channel);
      if (recipients.length === 0) throw new AppError(422, 'VALIDATION_ERROR', 'No guests match this selection (they need an email address and must not have opted out).');
      const scheduledAt = b.scheduledAt ? new Date(b.scheduledAt) : new Date();
      if (scheduledAt.getTime() < Date.now() - 60_000) throw new AppError(400, 'VALIDATION_ERROR', 'Scheduled time is in the past.', { scheduledAt: 'Past' });
      const campaign = await prisma.campaign.create({
        data: { eventId: event.id, kind: b.kind, channel: b.channel, segment: b.segment, templateKey: KIND_TEMPLATE[b.kind]!, subjectI18n: b.subject, bodyI18n: b.body, scheduledAt, createdById: user.id, stats: { estimatedRecipients: recipients.length } },
      });
      await enqueueJob('dispatch_campaign', { campaignId: campaign.id }, { runAt: scheduledAt, uniqueKey: `campaign:${campaign.id}` });
      await logActivity({ eventId: event.id, actorType: 'host', actorId: user.id, action: 'campaign.scheduled', data: { campaignId: campaign.id, kind: b.kind, recipients: recipients.length } });
      return reply.code(201).send(campaignDto(campaign));
    },
  );

  app.post('/api/events/:id/campaigns/preview', { schema: { tags: ['campaigns'], summary: 'Count recipients for a segment', params: EventParams, body: z.object({ channel: z.enum(['email', 'whatsapp', 'sms']).default('email'), segment: CampaignSegment.default({}) }) } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'read');
    const rows = await segmentInvitees(event.id, req.body.segment, req.body.channel);
    return { count: rows.length, sample: rows.slice(0, 10).map((r) => ({ id: r.id, firstName: r.firstName, lastName: r.lastName, email: r.email })) };
  });

  app.get('/api/events/:id/campaigns', { schema: { tags: ['campaigns'], params: EventParams } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'read');
    const rows = await prisma.campaign.findMany({ where: { eventId: event.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { items: rows.map(campaignDto) };
  });

  app.get('/api/events/:id/campaigns/:campaignId', { schema: { tags: ['campaigns'], params: EventParams.extend({ campaignId: z.string().uuid() }) } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'read');
    const c = await prisma.campaign.findFirst({ where: { id: req.params.campaignId, eventId: event.id } });
    if (!c) throw notFound('Campaign');
    const messages = await prisma.message.findMany({ where: { campaignId: c.id }, include: { invitee: true }, orderBy: { createdAt: 'asc' }, take: 2000 });
    const byStatus: Record<string, number> = {};
    for (const m of messages) byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
    return {
      ...campaignDto(c),
      results: { total: messages.length, byStatus },
      recipients: messages.map((m) => ({ messageId: m.id, inviteeId: m.inviteeId, name: m.invitee ? [m.invitee.firstName, m.invitee.lastName].filter(Boolean).join(' ') : null, to: m.toAddress, status: m.status, error: m.error, sentAt: m.sentAt })),
    };
  });

  app.post('/api/events/:id/campaigns/:campaignId/cancel', { schema: { tags: ['campaigns'], params: EventParams.extend({ campaignId: z.string().uuid() }) } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'write');
    const c = await prisma.campaign.findFirst({ where: { id: req.params.campaignId, eventId: event.id } });
    if (!c) throw notFound('Campaign');
    if (c.status !== 'scheduled') throw new AppError(409, 'CONFLICT', 'Only scheduled campaigns can be canceled.');
    const updated = await prisma.campaign.update({ where: { id: c.id }, data: { status: 'canceled' } });
    await prisma.job.updateMany({ where: { uniqueKey: `campaign:${c.id}`, status: 'scheduled' }, data: { status: 'canceled' } });
    return campaignDto(updated);
  });
}
