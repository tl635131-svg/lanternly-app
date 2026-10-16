import type { Channel } from '@prisma/client';
import { prisma, type Tx } from '../../db.js';
import { renderTemplate, type TemplateKey } from '../email/templates.js';
import { providers } from './providers.js';

export interface MessageInput {
  to: string;
  template: TemplateKey;
  data: Record<string, unknown>;
  channel?: Channel;
  eventId?: string | null;
  userId?: string | null;
  inviteeId?: string | null;
  campaignId?: string | null;
  idempotencyKey?: string | null;
  locale?: string;
}

function provider(channel: Channel) {
  if (channel === 'email') return providers.email;
  if (channel === 'whatsapp') return providers.whatsapp;
  if (channel === 'sms') return providers.sms;
  throw new Error(`Channel ${channel} cannot send messages`);
}

export function channelAvailable(channel: Channel) {
  try {
    return provider(channel).available;
  } catch {
    return false;
  }
}

/**
 * Send immediately (used for security emails: set-password, reset, login links, co-host invites)
 * so the one-time token is never persisted anywhere except inside the outgoing message.
 * Only metadata (template, recipient, status) is logged in `messages`.
 */
export async function sendNow(input: MessageInput) {
  const channel = input.channel ?? 'email';
  if (input.idempotencyKey) {
    const existing = await prisma.message.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;
  }
  const msg = await prisma.message.create({
    data: {
      channel,
      toAddress: input.to,
      templateKey: input.template,
      eventId: input.eventId ?? null,
      userId: input.userId ?? null,
      inviteeId: input.inviteeId ?? null,
      campaignId: input.campaignId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      status: 'sending',
    },
  });
  return deliver(msg.id, input);
}

export async function deliver(messageId: string, input: MessageInput) {
  const channel = input.channel ?? 'email';
  const p = provider(channel);
  try {
    const rendered = renderTemplate(input.template, input.data, input.locale);
    const res = await p.send({ to: input.to, rendered, templateKey: input.template });
    return prisma.message.update({ where: { id: messageId }, data: { status: 'sent', provider: p.name, providerMessageId: res.providerMessageId, sentAt: new Date(), error: null } });
  } catch (err) {
    await prisma.message.update({ where: { id: messageId }, data: { status: 'failed', provider: p.name, error: (err as Error).message.slice(0, 500) } });
    throw err;
  }
}

/** Queue a non-secret message for the background worker (retries with backoff). */
export async function enqueueMessage(input: MessageInput, db: Tx | typeof prisma = prisma) {
  const channel = input.channel ?? 'email';
  if (input.idempotencyKey) {
    const existing = await db.message.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;
  }
  const msg = await db.message.create({
    data: {
      channel,
      toAddress: input.to,
      templateKey: input.template,
      eventId: input.eventId ?? null,
      userId: input.userId ?? null,
      inviteeId: input.inviteeId ?? null,
      campaignId: input.campaignId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      status: 'queued',
    },
  });
  await db.job.create({ data: { type: 'send_message', payload: { messageId: msg.id, input: input as any } } });
  return msg;
}
