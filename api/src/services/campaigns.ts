import { inviteeWaitingWhere } from './stats.js';
import { z } from 'zod';
import type { Campaign, Event, Invitee, Prisma } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { signForever } from '../lib/crypto.js';
import { mergedRsvpSettings } from '../lib/brief.js';
import { enqueueMessage } from './messaging/index.js';
import { inviteUrl } from './provisioning.js';
import type { TemplateKey } from './email/templates.js';

export const CampaignSegment = z
  .object({
    statuses: z.array(z.enum(['not_sent', 'sent', 'opened', 'responded', 'bounced'])).max(6).optional(),
    notResponded: z.boolean().optional(),
    attending: z.boolean().optional(), // only invitees whose response is "yes" (e.g. thank-you)
    inviteeIds: z.array(z.string().uuid()).max(5000).optional(),
    groupLabel: z.string().max(60).optional(),
  })
  .strict();
export type CampaignSegmentT = z.infer<typeof CampaignSegment>;

export const KIND_TEMPLATE: Record<string, TemplateKey> = { invite: 'guest_invite', reminder: 'guest_reminder', update: 'guest_update', thank_you: 'guest_thank_you' };

export function unsubscribeUrl(inviteeId: string) {
  return `${config.WEB_URL}/unsubscribe?token=${encodeURIComponent(signForever(`invitee:${inviteeId}`, 'unsubscribe'))}`;
}

export async function segmentInvitees(eventId: string, segment: CampaignSegmentT, channel: 'email' | 'whatsapp' | 'sms') {
  const where: Prisma.InviteeWhereInput = { eventId, deletedAt: null, optedOutAt: null };
  if (channel === 'email') where.email = { not: null };
  else where.phoneE164 = { not: null };
  if (segment.statuses?.length) where.status = { in: segment.statuses };
  if (segment.inviteeIds?.length) where.id = { in: segment.inviteeIds };
  if (segment.groupLabel) where.groupLabel = segment.groupLabel;
  if (segment.notResponded) Object.assign(where, inviteeWaitingWhere); // same definition as stats `waiting`
  if (segment.attending) where.guests = { some: { deletedAt: null, attendance: 'yes' } };
  where.status = where.status ?? { not: 'bounced' };
  return prisma.invitee.findMany({ where, orderBy: { createdAt: 'asc' } });
}

function localHour(tz: string, at = new Date()) {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(at));
  } catch {
    return at.getUTCHours();
  }
}

/** Next allowed send time respecting quiet hours (no sends 21:00–09:00 in the event's timezone). */
export function quietHoursDelay(tz: string, at = new Date()): Date | null {
  if (!config.QUIET_HOURS_ENABLED) return null;
  const h = localHour(tz, at);
  if (h >= 9 && h < 21) return null;
  const hoursUntil9 = h >= 21 ? 24 - h + 9 : 9 - h;
  const next = new Date(at.getTime() + hoursUntil9 * 3600_000);
  next.setUTCMinutes(0, 0, 0);
  return next;
}

function pick(i18n: unknown, lang: string, fallback: string) {
  const o = (i18n ?? {}) as Record<string, string>;
  return o[lang] ?? o[fallback] ?? undefined;
}

export async function expandCampaign(campaign: Campaign, event: Event, slug: string) {
  const invitees = await segmentInvitees(event.id, campaign.segment as CampaignSegmentT, campaign.channel as 'email');
  const template = (KIND_TEMPLATE[campaign.kind] ?? 'guest_update') as TemplateKey;
  const deadline = mergedRsvpSettings(event.rsvpSettings).deadline;
  let queued = 0;
  for (const inv of invitees as Invitee[]) {
    const lang = inv.language ?? event.primaryLanguage;
    await enqueueMessage({
      to: inv.email!,
      channel: campaign.channel,
      template,
      eventId: event.id,
      inviteeId: inv.id,
      campaignId: campaign.id,
      idempotencyKey: `campaign:${campaign.id}:${inv.id}`,
      locale: lang,
      data: {
        firstName: inv.firstName,
        title: event.title,
        deadline,
        inviteUrl: inviteUrl(slug, inv.token),
        unsubscribeUrl: unsubscribeUrl(inv.id),
        subject: pick(campaign.subjectI18n, lang, event.primaryLanguage),
        body: pick(campaign.bodyI18n, lang, event.primaryLanguage),
      },
    });
    queued++;
  }
  return queued;
}
