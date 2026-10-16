import { randomUUID } from 'node:crypto';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { logActivity } from '../../lib/activity.js';
import { mergedRsvpSettings } from '../../lib/brief.js';
import { deliver, type MessageInput } from '../messaging/index.js';
import { expandCampaign, quietHoursDelay } from '../campaigns.js';
import { claimJobs, completeJob, enqueueJob, failJob, releaseStaleJobs } from './queue.js';

type Handler = (payload: any, job: { id: string }) => Promise<void | { reschedule: Date }>;

const handlers: Record<string, Handler> = {
  async send_message(payload: { messageId: string; input: MessageInput }) {
    const msg = await prisma.message.findUnique({ where: { id: payload.messageId } });
    if (!msg || msg.status === 'sent' || msg.status === 'delivered') return;
    if (msg.inviteeId) {
      const inv = await prisma.invitee.findUnique({ where: { id: msg.inviteeId } });
      if (!inv || inv.optedOutAt || inv.deletedAt) {
        await prisma.message.update({ where: { id: msg.id }, data: { status: 'failed', error: 'Recipient opted out or was removed' } });
        return;
      }
    }
    await prisma.message.update({ where: { id: msg.id }, data: { status: 'sending' } });
    await deliver(msg.id, payload.input);
    if (msg.inviteeId) {
      await prisma.invitee.updateMany({ where: { id: msg.inviteeId, status: 'not_sent' }, data: { status: 'sent' } });
      await prisma.invitee.updateMany({ where: { id: msg.inviteeId, sentAt: null }, data: { sentAt: new Date() } });
    }
  },

  async dispatch_campaign(payload: { campaignId: string }) {
    const campaign = await prisma.campaign.findUnique({ where: { id: payload.campaignId }, include: { event: { include: { invitations: { take: 1, orderBy: { createdAt: 'asc' } } } } } });
    if (!campaign || campaign.status !== 'scheduled') return;
    const delay = quietHoursDelay(campaign.event.timezone);
    if (delay) return { reschedule: delay };
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'running' } });
    const slug = campaign.event.invitations[0]?.slug ?? '';
    const queued = await expandCampaign(campaign, campaign.event, slug);
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'done', stats: { recipients: queued } } });
    await logActivity({ eventId: campaign.eventId, actorType: 'system', action: 'campaign.dispatched', data: { campaignId: campaign.id, kind: campaign.kind, recipients: queued } });
  },

  async archive_events() {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const events = await prisma.event.findMany({ where: { deletedAt: null, archiveAfter: { lt: today } }, select: { id: true } });
    const ids = events.map((e) => e.id);
    if (!ids.length) return;
    await prisma.invitation.updateMany({ where: { eventId: { in: ids }, status: { in: ['published', 'preview', 'draft'] } }, data: { status: 'archived', archivedAt: new Date() } });
    await prisma.brief.updateMany({ where: { eventId: { in: ids }, status: { not: 'archived' } }, data: { status: 'archived', locked: true } });
  },

  async rsvp_deadline_reminders() {
    const events = await prisma.event.findMany({ where: { deletedAt: null, remindersEnabled: true }, include: { invitations: { where: { status: 'published' }, take: 1 } } });
    const today = new Date().toISOString().slice(0, 10);
    for (const e of events) {
      const deadline = mergedRsvpSettings(e.rsvpSettings).deadline;
      if (!deadline || !e.invitations.length) continue;
      const remindOn = new Date(`${deadline}T00:00:00Z`);
      remindOn.setUTCDate(remindOn.getUTCDate() - e.reminderDaysBefore);
      if (remindOn.toISOString().slice(0, 10) !== today) continue;
      const key = `auto-reminder:${e.id}:${deadline}`;
      if (await prisma.job.findUnique({ where: { uniqueKey: key } })) continue;
      const campaign = await prisma.campaign.create({ data: { eventId: e.id, kind: 'reminder', channel: 'email', segment: { notResponded: true }, templateKey: 'guest_reminder', scheduledAt: new Date(), automatic: true } });
      await enqueueJob('dispatch_campaign', { campaignId: campaign.id }, { uniqueKey: key });
    }
  },

  async cleanup_tokens() {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600_000);
    await prisma.authToken.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }] } });
    await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  },
};

/** Ensure daily maintenance jobs exist (idempotent via unique keys). */
export async function ensurePeriodicJobs() {
  const day = new Date().toISOString().slice(0, 10);
  await enqueueJob('archive_events', {}, { uniqueKey: `archive_events:${day}` });
  await enqueueJob('rsvp_deadline_reminders', {}, { uniqueKey: `rsvp_deadline_reminders:${day}` });
  await enqueueJob('cleanup_tokens', {}, { uniqueKey: `cleanup_tokens:${day}` });
}

/** Process all currently-due jobs once. Returns number processed. */
export async function runWorkerOnce(workerId = `worker-${process.pid}`, opts: { log?: (m: string) => void } = {}) {
  await releaseStaleJobs();
  let processed = 0;
  for (;;) {
    const jobs = await claimJobs(workerId, 10);
    if (!jobs.length) break;
    for (const job of jobs) {
      const handler = handlers[job.type];
      try {
        if (!handler) throw new Error(`No handler for job type ${job.type}`);
        const res = await handler(job.payload, job);
        if (res && 'reschedule' in res) {
          await prisma.job.update({ where: { id: job.id }, data: { status: 'scheduled', runAt: res.reschedule, attempts: { decrement: 1 }, lockedBy: null } });
        } else {
          await completeJob(job.id);
        }
      } catch (err) {
        opts.log?.(`job ${job.type} ${job.id} failed: ${(err as Error).message}`);
        await failJob(job.id, job.attempts, job.max_attempts, (err as Error).message);
      }
      processed++;
    }
  }
  return processed;
}

export function startWorkerLoop(log: (m: string) => void = console.log) {
  const workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await ensurePeriodicJobs();
      await runWorkerOnce(workerId, { log });
    } catch (err) {
      log(`worker tick error: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, config.WORKER_POLL_MS);
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
