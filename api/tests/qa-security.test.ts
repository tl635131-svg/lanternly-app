import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mockPayToken } from '../src/routes/dev.js';
import { Client, clearDevOutbox, createUser, hostWithEvent, login, makeApp, mockCheckout, prisma, publishEvent, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => clearDevOutbox());

async function liveEvent(rsvp: Record<string, unknown> = {}) {
  const ctx = await hostWithEvent(app);
  const s = await ctx.client.patch(`/api/events/${ctx.event.id}/rsvp-settings`, { deadline: '2099-01-01', requireEmail: true, mealOptions: ['fish', 'veg'], maxCompanions: 2, mode: 'auto', ...rsvp });
  if (s.statusCode !== 200) throw new Error(s.body);
  const inv = await publishEvent(ctx.client, ctx.event.id);
  return { ...ctx, slug: inv.slug as string };
}

async function pendingCheckout() {
  const email = uniqueEmail('buyer');
  const res = await new Client(app).post(
    '/api/checkout/session',
    { plan: 'experience', themeKey: 'harbour', sections: ['our_story'], extras: [], languages: ['en'], info: { partner1: 'Robin', partner2: 'Sky', eventDate: '2027-07-10', venue: 'Pier 21', email }, consents: { terms: true, privacy: true } },
    { 'idempotency-key': `idem-${randomUUID()}` },
  );
  if (res.statusCode !== 200) throw new Error(res.body);
  return res.json() as { sessionId: string; url: string };
}

describe('H-01: declining an RSVP never needs an email', () => {
  it('general link: decline without email → 201 even when requireEmail is on; yes without email → 400', async () => {
    const { slug } = await liveEvent();
    const c = new Client(app);
    const no = await c.post(`/api/public/invitations/${slug}/rsvps`, { fullName: 'Regretful Guest', attendance: 'no' });
    expect(no.statusCode).toBe(201);
    const yes = await c.post(`/api/public/invitations/${slug}/rsvps`, { fullName: 'Happy Guest', attendance: 'yes', primaryMeal: 'fish' });
    expect(yes.statusCode).toBe(400);
    expect(yes.json().error.fields?.email ?? yes.body).toBeTruthy();
    expect(yes.body).toContain('email');
    const yesWithEmail = await c.post(`/api/public/invitations/${slug}/rsvps`, { fullName: 'Happy Guest', attendance: 'yes', primaryMeal: 'fish', email: 'happy@example.test' });
    expect(yesWithEmail.statusCode).toBe(201);
  });

  it('personal link: decline without email → 201 when requireEmail is on', async () => {
    const { client, event, slug } = await liveEvent();
    const inv = (await client.post(`/api/events/${event.id}/invitees`, { firstName: 'Nadia', lastName: 'Roy', maxPartySize: 2 })).json();
    const g = new URL(inv.personalUrl).searchParams.get('g')!;
    const yes = await new Client(app).post(`/api/public/invitations/${slug}/rsvps`, { g, fullName: 'Nadia Roy', attendance: 'yes', primaryMeal: 'veg' });
    expect(yes.statusCode).toBe(400);
    const no = await new Client(app).post(`/api/public/invitations/${slug}/rsvps`, { g, fullName: 'Nadia Roy', attendance: 'no' });
    expect(no.statusCode).toBe(201);
    const stored = await prisma.guest.findFirstOrThrow({ where: { inviteeId: inv.id } });
    expect(stored.attendance).toBe('no');
    expect(stored.email ?? null).toBeNull();
  });
});

describe('M-05: dev helpers are locked down', () => {
  it('dev outbox: 401 anonymous, 403 for a host, 200 for an admin', async () => {
    expect((await new Client(app).get('/api/dev/outbox')).statusCode).toBe(401);
    const host = await createUser();
    expect((await (await login(app, host.email)).get('/api/dev/outbox')).statusCode).toBe(403);
    const admin = await createUser({ role: 'admin' });
    const res = await (await login(app, admin.email)).get('/api/dev/outbox');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().items)).toBe(true);
  });

  it('run-jobs: needs an admin session and the CSRF header', async () => {
    expect((await new Client(app).post('/api/dev/run-jobs')).statusCode).toBe(401);
    const host = await createUser();
    expect((await (await login(app, host.email)).post('/api/dev/run-jobs')).statusCode).toBe(403);
    const admin = await login(app, (await createUser({ role: 'admin' })).email);
    const noCsrf = await admin.req('POST', '/api/dev/run-jobs', {}, {}, { csrf: false });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().error.code).toBe('CSRF_FAILED');
    const ok = await admin.post('/api/dev/run-jobs');
    expect(ok.statusCode).toBe(200);
    expect(typeof ok.json().processed).toBe('number');
  });

  it('mock checkout: complete/cancel need the page token for that exact session', async () => {
    const a = await pendingCheckout();
    const b = await pendingCheckout();
    const c = new Client(app);
    // No token, wrong token, or another session's token → 403; the order stays pending.
    expect((await c.post(`/api/dev/mock-checkout/${a.sessionId}/complete?redirect=false`, {})).statusCode).toBe(403);
    expect((await c.post(`/api/dev/mock-checkout/${a.sessionId}/complete?redirect=false`, { token: 'nope' })).statusCode).toBe(403);
    expect((await c.post(`/api/dev/mock-checkout/${a.sessionId}/complete?redirect=false`, { token: mockPayToken(b.sessionId) })).statusCode).toBe(403);
    expect((await c.post(`/api/dev/mock-checkout/${a.sessionId}/cancel`, {})).statusCode).toBe(403);
    expect((await prisma.order.findUniqueOrThrow({ where: { checkoutSessionId: a.sessionId } })).status).toBe('pending_payment');

    // The page embeds the token and is un-frameable.
    const page = await c.get(`/api/dev/mock-checkout/${a.sessionId}`);
    expect(page.statusCode).toBe(200);
    const token = page.body.match(/name="token" value="([^"]+)"/)?.[1];
    expect(token).toBe(mockPayToken(a.sessionId));
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(page.headers['cache-control']).toBe('no-store');

    // The page's own form post (urlencoded) settles the order and 303s to the web success page.
    const form = await c.req('POST', `/api/dev/mock-checkout/${a.sessionId}/complete`, `token=${encodeURIComponent(token!)}`, { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' });
    expect(form.statusCode).toBe(303);
    expect(form.headers.location).toContain(`/checkout/success?session_id=${a.sessionId}`);
    expect((await prisma.order.findUniqueOrThrow({ where: { checkoutSessionId: a.sessionId } })).status).toBe('paid');

    // Unknown sessions are 403 (no token can exist for them), not an oracle.
    expect((await c.post(`/api/dev/mock-checkout/mock_cs_doesnotexist/complete`, {})).statusCode).toBe(403);
    expect((await mockCheckout(app, b.sessionId, 'cancel')).statusCode).toBe(200);
  });
});

describe('M-04: security headers and CORS', () => {
  it('JSON responses carry strict security headers and no fingerprinting headers', async () => {
    const res = await new Client(app).get('/health');
    const h = res.headers;
    expect(h['content-security-policy']).toContain("default-src 'none'");
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['strict-transport-security']).toBeUndefined(); // production only
    expect(h['x-powered-by']).toBeUndefined();
    expect(h['server']).toBeUndefined();
  });

  it('/docs gets a CSP that lets Swagger UI load its own assets but still forbids framing', async () => {
    const res = await new Client(app).get('/docs/');
    expect([200, 302]).toContain(res.statusCode);
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('CORS echoes only the configured web origin, with credentials', async () => {
    const ok = await app.inject({ method: 'OPTIONS', url: '/api/auth/me', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'GET' } });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await app.inject({ method: 'OPTIONS', url: '/api/auth/me', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    const simple = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
    expect(simple.headers['access-control-allow-origin']).toBeUndefined();
  });
});
