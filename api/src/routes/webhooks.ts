import { config } from '../config.js';
import { prisma } from '../db.js';
import { safeEqual } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { cancelOrderBySession, fulfilOrder, refundOrder } from '../services/orders.js';
import { verifyStripeWebhook } from '../services/payments/index.js';
import type { ZApp } from './types.js';

export default async function webhooks(app: ZApp) {
  // Encapsulated: keep the raw body for signature verification (only within this plugin).
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 512 * 1024 }, (_req, body, done) => done(null, body));

  app.post('/api/webhooks/stripe', { schema: { tags: ['webhooks'], summary: 'Stripe events (signature verified)' } }, async (req, reply) => {
    const raw = req.body as Buffer;
    if (!Buffer.isBuffer(raw)) throw new AppError(400, 'BAD_REQUEST', 'Expected a JSON body.');
    const evt = verifyStripeWebhook(raw, req.headers['stripe-signature'] as string | undefined);

    // Idempotency on the provider event id.
    const seen = await prisma.processedWebhookEvent.findUnique({ where: { id: evt.id } });
    if (seen) return reply.send({ received: true, duplicate: true });

    const obj = evt.object;
    switch (evt.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const orderId = obj.metadata?.orderId ?? obj.client_reference_id;
        const order = orderId ? await prisma.order.findUnique({ where: { id: orderId } }) : await prisma.order.findUnique({ where: { checkoutSessionId: obj.id } });
        if (!order) {
          req.log.warn({ evt: evt.id }, 'Stripe session for unknown order');
          break;
        }
        if (obj.payment_status === 'paid' || obj.payment_status === 'no_payment_required') {
          await fulfilOrder(order.id, {
            amountTotal: obj.amount_total ?? null,
            amountTax: obj.total_details?.amount_tax ?? null,
            paymentIntentId: typeof obj.payment_intent === 'string' ? obj.payment_intent : (obj.payment_intent?.id ?? null),
          });
        }
        break;
      }
      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed':
        await cancelOrderBySession(obj.id);
        break;
      case 'charge.refunded': {
        const pi = typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id;
        const order = pi ? await prisma.order.findFirst({ where: { paymentIntentId: pi } }) : null;
        if (order && obj.refunded) await refundOrder(order);
        break;
      }
      default:
        break;
    }
    await prisma.processedWebhookEvent.create({ data: { id: evt.id, provider: 'stripe', type: evt.type } }).catch(() => undefined);
    return reply.send({ received: true });
  });

  /** Email provider delivery events (bounce/delivered/opened). Authenticated with a shared secret header. */
  app.post('/api/webhooks/email', { schema: { tags: ['webhooks'], summary: 'Email delivery events (x-webhook-secret)' } }, async (req, reply) => {
    const secret = config.EMAIL_WEBHOOK_SECRET;
    const given = req.headers['x-webhook-secret'];
    if (!secret) throw new AppError(503, 'INTERNAL_ERROR', 'Email webhook is not configured.');
    if (typeof given !== 'string' || !safeEqual(given, secret)) throw new AppError(401, 'UNAUTHENTICATED', 'Invalid webhook secret.');
    let body: any;
    try {
      body = JSON.parse((req.body as Buffer).toString('utf8'));
    } catch {
      throw new AppError(400, 'BAD_REQUEST', 'Invalid JSON.');
    }
    const events: { providerMessageId: string; type: 'delivered' | 'bounced' | 'opened' | 'failed' }[] = Array.isArray(body?.events) ? body.events.slice(0, 500) : [];
    for (const e of events) {
      if (typeof e?.providerMessageId !== 'string' || !['delivered', 'bounced', 'opened', 'failed'].includes(e.type)) continue;
      const msg = await prisma.message.findFirst({ where: { providerMessageId: e.providerMessageId } });
      if (!msg) continue;
      const now = new Date();
      await prisma.message.update({
        where: { id: msg.id },
        data: { status: e.type, ...(e.type === 'delivered' ? { deliveredAt: now } : {}), ...(e.type === 'opened' ? { openedAt: now } : {}) },
      });
      if (e.type === 'bounced' && msg.inviteeId) await prisma.invitee.update({ where: { id: msg.inviteeId }, data: { status: 'bounced' } });
    }
    return reply.send({ received: events.length });
  });
}
