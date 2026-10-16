import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { signTestWebhook } from '../src/services/payments/index.js';
import { Client, clearDevOutbox, getDevOutbox, hostWithEvent, makeApp, prisma, tokenFromOutbox, uniqueEmail, mockCheckout } from './helpers.js';

const WHSEC = process.env.STRIPE_WEBHOOK_SECRET!;
let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => clearDevOutbox());

const studioOrder = (email: string, extra: Record<string, unknown> = {}) => ({
  plan: 'experience',
  themeKey: 'harbour',
  sections: ['our_story', 'timeline', 'faq', 'dress_code', 'gift_list', 'accommodation', 'custom:Kids corner'],
  extras: ['own_song'],
  languages: ['en', 'fr'],
  info: { partner1: 'Robin', partner2: 'Sky', eventDate: '2027-07-10', venue: 'Pier 21', email },
  consents: { terms: true, privacy: true },
  ...extra,
});

function webhook(evt: object, secret = WHSEC) {
  const payload = JSON.stringify(evt);
  return { payload, headers: { 'content-type': 'application/json', 'stripe-signature': signTestWebhook(payload, secret) } };
}
const sessionCompleted = (order: { id: string; checkoutSessionId: string | null }, id = `evt_${randomUUID()}`) => ({
  id,
  object: 'event',
  type: 'checkout.session.completed',
  livemode: false,
  data: { object: { id: order.checkoutSessionId, object: 'checkout.session', client_reference_id: order.id, metadata: { orderId: order.id }, payment_status: 'paid', amount_total: 34_000, total_details: { amount_tax: 3_900 }, payment_intent: 'pi_test_123' } },
});

describe('pricing quote (CAD)', () => {
  it('prices plan + extra blocks + extras server-side', async () => {
    const res = await new Client(app).post('/api/checkout/quote', { plan: 'experience', themeKey: 'harbour', sections: ['our_story', 'timeline', 'faq', 'dress_code', 'gift_list', 'accommodation', 'transport'], extras: ['own_song'], languages: ['en'] });
    expect(res.statusCode).toBe(200);
    const q = res.json();
    expect(q.currency).toBe('CAD');
    const plan = q.lines.find((l: any) => l.kind === 'plan');
    const blocks = q.lines.find((l: any) => l.kind === 'extra_block');
    expect(plan.unitPriceCents).toBe(24900);
    expect(blocks.qty).toBe(2); // 7 sections, 5 included
    expect(q.subtotalCents).toBe(24900 + 2 * 800 + 1500);
  });

  it('rejects invalid selections', async () => {
    const c = new Client(app);
    expect((await c.post('/api/checkout/quote', { plan: 'experience', themeKey: 'no-such-theme' })).statusCode).toBe(422);
    expect((await c.post('/api/checkout/quote', { plan: 'experience', themeKey: 'harbour', languages: ['en', 'fr', 'es', 'de'] })).statusCode).toBe(422);
    expect((await c.post('/api/checkout/quote', { plan: 'no-such-plan' })).statusCode).toBe(400);
  });
});

describe('checkout with the mock payment driver', () => {
  it('creates a pending order + session, then completing payment provisions the account, event and invitation', async () => {
    const email = uniqueEmail('buyer');
    const draftId = randomUUID();
    expect((await new Client(app).put(`/api/checkout/drafts/${draftId}`, { plan: 'experience', lastStep: 'info', info: { email } })).statusCode).toBe(204);

    const res = await new Client(app).post('/api/checkout/session', studioOrder(email, { draftId }), { 'idempotency-key': `idem-${draftId}` });
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s.url).toContain('/api/dev/mock-checkout/');
    expect(s.sessionId).toMatch(/^mock_cs_/);
    expect(s.currency).toBe('CAD');
    expect(s.orderNumber).toMatch(/^ORD-\d{4}-\d{5}$/);

    // Double-click with the same idempotency key re-uses the pending session.
    const again = (await new Client(app).post('/api/checkout/session', studioOrder(email, { draftId }), { 'idempotency-key': `idem-${draftId}` })).json();
    expect(again.sessionId).toBe(s.sessionId);

    const pending = (await new Client(app).get(`/api/checkout/session/${s.sessionId}/verify`)).json();
    expect(pending).toMatchObject({ valid: false, status: 'pending_payment' });
    expect(pending.order.eventId).toBeNull();

    const page = await new Client(app).get(`/api/dev/mock-checkout/${s.sessionId}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('TEST MODE');
    // L-15: UTF-8 declared in header and markup; amounts as CA$; plain hyphen.
    expect(page.headers['content-type']).toMatch(/text\/html; charset=utf-8/i);
    expect(page.body).toContain('<meta charset="utf-8">');
    expect(page.body).toMatch(/CA\$\d[\d,]*\.\d{2}/);
    expect(page.body).toContain('TEST MODE - mock payment');
    expect(page.body).not.toContain('—');

    const done = await mockCheckout(app, s.sessionId, 'complete', { redirect: false });
    expect(done.statusCode).toBe(200);
    expect(done.json().status).toBe('paid');

    const verified = (await new Client(app).get(`/api/checkout/session/${s.sessionId}/verify`)).json();
    expect(verified.valid).toBe(true);
    expect(verified.order.taxCents).toBe(Math.round(verified.order.subtotalCents * 0.13));
    const eventId = verified.order.eventId;
    expect(eventId).toBeTruthy();

    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: { members: { include: { user: true } }, brief: true, invitations: true } });
    expect(event.serviceMode).toBe('studio');
    expect(event.paidAt).toBeTruthy();
    expect(event.members[0]!.user.email).toBe(email);
    expect(event.members[0]!.user.passwordHash).toBeNull(); // no password is ever created for the buyer
    expect(event.brief!.sections).toEqual(expect.arrayContaining(['our_story', 'custom:kids-corner']));
    expect(event.invitations).toHaveLength(1);
    const draft = await prisma.checkoutDraft.findUniqueOrThrow({ where: { id: draftId } });
    expect(draft.convertedOrderId).toBe(s.orderId);

    // Access email = set-password link (never a password)
    const mail = getDevOutbox().find((m) => m.to === email)!;
    expect(mail.templateKey).toBe('order_confirmation');
    const raw = tokenFromOutbox(email);
    const c = new Client(app);
    expect((await c.post('/api/auth/token/consume', { token: raw, password: 'Buyer-Pass-2027' })).statusCode).toBe(200);
    expect((await c.get(`/api/events/${eventId}`)).statusCode).toBe(200);

    // Completing again is idempotent (no second event).
    await mockCheckout(app, s.sessionId, 'complete', { redirect: false });
    expect(await prisma.event.count({ where: { members: { some: { user: { email } } } } })).toBe(1);
  });

  it('requires names, date, valid email and both consents', async () => {
    const res = await new Client(app).post('/api/checkout/session', { ...studioOrder('bad'), consents: { terms: true, privacy: false } });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().error.fields)).toEqual(expect.arrayContaining(['info.email', 'consents.privacy']));
    const noNames = await new Client(app).post('/api/checkout/session', studioOrder(uniqueEmail(), { info: { email: uniqueEmail(), eventDate: '2027-01-01' } }));
    expect(noNames.statusCode).toBe(400);
    expect(noNames.json().error.fields).toHaveProperty('info.partner1');
  });

  it('self-serve: the owner buys the diy plan for an existing event, which unlocks publishing', async () => {
    const { client, event } = await hostWithEvent(app);
    const stranger = await hostWithEvent(app);
    const body = { plan: 'diy', eventId: event.id, info: { email: 'ignored@example.test' }, consents: { terms: true, privacy: true } };
    expect((await stranger.client.post('/api/checkout/session', body)).statusCode).toBe(404);
    expect((await client.post('/api/checkout/session', { ...body, plan: 'premium' })).statusCode).toBe(422);
    const s = (await client.post('/api/checkout/session', body)).json();
    const order = await prisma.order.findUniqueOrThrow({ where: { id: s.orderId } });
    expect(order.email).toBe((await prisma.user.findFirstOrThrow({ where: { memberships: { some: { eventId: event.id } } } })).email);
    expect(order.subtotalCents).toBe(9900);
    await mockCheckout(app, s.sessionId, 'complete', { redirect: false });
    expect((await client.post(`/api/events/${event.id}/invitation/publish`)).statusCode).toBe(200);
    expect((await client.post('/api/checkout/session', body)).statusCode).toBe(409);
  });

  it('cancel marks the order canceled', async () => {
    const s = (await new Client(app).post('/api/checkout/session', studioOrder(uniqueEmail()))).json();
    await mockCheckout(app, s.sessionId, 'cancel');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: s.orderId } })).status).toBe('canceled');
  });
});

describe('Stripe webhook (signature verified, idempotent)', () => {
  async function pendingOrder() {
    const s = (await new Client(app).post('/api/checkout/session', studioOrder(uniqueEmail('wh')))).json();
    return prisma.order.findUniqueOrThrow({ where: { id: s.orderId } });
  }

  it('rejects missing or invalid signatures', async () => {
    const order = await pendingOrder();
    const evt = sessionCompleted(order);
    const missing = await app.inject({ method: 'POST', url: '/api/webhooks/stripe', payload: JSON.stringify(evt), headers: { 'content-type': 'application/json' } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    const wrong = webhook(evt, 'whsec_wrong_secret');
    expect((await app.inject({ method: 'POST', url: '/api/webhooks/stripe', ...wrong })).statusCode).toBe(400);
    // Tampered body with a signature for different content
    const good = webhook(evt);
    const tampered = await app.inject({ method: 'POST', url: '/api/webhooks/stripe', payload: good.payload.replace('"paid"', '"unpaid"'), headers: good.headers });
    expect(tampered.statusCode).toBe(400);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('pending_payment');
  });

  it('checkout.session.completed marks the order paid with Stripe tax totals, exactly once', async () => {
    const order = await pendingOrder();
    const evt = sessionCompleted(order);
    const first = await app.inject({ method: 'POST', url: '/api/webhooks/stripe', ...webhook(evt) });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ received: true });
    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid).toMatchObject({ status: 'paid', taxCents: 3900, totalCents: 34000, paymentIntentId: 'pi_test_123' });
    expect(paid.eventId).toBeTruthy();

    const dup = await app.inject({ method: 'POST', url: '/api/webhooks/stripe', ...webhook(evt) });
    expect(dup.json()).toEqual({ received: true, duplicate: true });
    // Different event id for the same session (Stripe retries / async_payment_succeeded) → still one event provisioned
    await app.inject({ method: 'POST', url: '/api/webhooks/stripe', ...webhook(sessionCompleted(order)) });
    expect(await prisma.event.count({ where: { orders: { some: { id: order.id } } } })).toBe(1);
  });

  it('rejects live-mode events', async () => {
    const order = await pendingOrder();
    const res = await app.inject({ method: 'POST', url: '/api/webhooks/stripe', ...webhook({ ...sessionCompleted(order), livemode: true }) });
    expect(res.statusCode).toBe(400);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('pending_payment');
  });

  it('session expired → canceled; charge.refunded → refunded', async () => {
    const a = await pendingOrder();
    await app.inject({ method: 'POST', url: '/api/webhooks/stripe', ...webhook({ id: `evt_${randomUUID()}`, type: 'checkout.session.expired', livemode: false, data: { object: { id: a.checkoutSessionId } } }) });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('canceled');

    const b = await pendingOrder();
    await app.inject({ method: 'POST', url: '/api/webhooks/stripe', ...webhook({ ...sessionCompleted(b), data: { object: { ...sessionCompleted(b).data.object, payment_intent: `pi_${b.id.slice(0, 8)}` } } }) });
    await app.inject({ method: 'POST', url: '/api/webhooks/stripe', ...webhook({ id: `evt_${randomUUID()}`, type: 'charge.refunded', livemode: false, data: { object: { id: 'ch_1', payment_intent: `pi_${b.id.slice(0, 8)}`, refunded: true } } }) });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('refunded');
  });

  it('email delivery webhook requires the shared secret', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/webhooks/email', payload: '{"events":[]}', headers: { 'content-type': 'application/json', 'x-webhook-secret': 'nope' } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/webhooks/email', payload: '{"events":[]}', headers: { 'content-type': 'application/json', 'x-webhook-secret': process.env.EMAIL_WEBHOOK_SECRET! } });
    expect(ok.statusCode).toBe(200);
  });
});
