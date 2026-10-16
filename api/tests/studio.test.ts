import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client, createUser, login, makeApp, prisma, tokenFromOutbox, uniqueEmail, clearDevOutbox, mockCheckout } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

/** Buy a studio plan through the mock checkout and sign in as the new host via the set-password link. */
async function studioEvent() {
  clearDevOutbox();
  const email = uniqueEmail('studio');
  const s = (
    await new Client(app).post('/api/checkout/session', {
      plan: 'experience',
      themeKey: 'evening',
      sections: ['our_story', 'timeline', 'faq'],
      languages: ['en'],
      info: { partner1: 'June', partner2: 'Ari', eventDate: '2027-10-02', email },
      consents: { terms: true, privacy: true },
    })
  ).json();
  const done = (await mockCheckout(app, s.sessionId, 'complete', { redirect: false })).json();
  const host = new Client(app);
  await host.post('/api/auth/token/consume', { token: tokenFromOutbox(email), password: 'Studio-Host-1' });
  return { host, eventId: done.eventId as string };
}

describe('studio tracker (stages, revisions, comments, approval)', () => {
  it('moves through stages, handles a revision round with comments, and records approval', async () => {
    const { host, eventId } = await studioEvent();
    const admin = await login(app, (await createUser({ role: 'admin' })).email);

    const ev = (await host.get(`/api/events/${eventId}`)).json();
    expect(ev.serviceMode).toBe('studio');
    expect(ev.productionStage).toBe('order_received');

    // Revisions are only possible once the design is in review.
    expect((await host.post(`/api/events/${eventId}/revisions`, { request: 'Make it bluer please' })).statusCode).toBe(409);

    const staged = await admin.post(`/api/admin/events/${eventId}/stage`, { stage: 'review' });
    expect(staged.statusCode).toBe(200);
    const board = (await admin.get('/api/admin/board')).json();
    expect(board.columns.find((c: any) => c.stage === 'review').count).toBeGreaterThanOrEqual(1);

    const rev = await host.post(`/api/events/${eventId}/revisions`, { request: 'Could the cover be a little warmer?' });
    expect(rev.statusCode).toBe(201);
    const revisionId = rev.json().id;
    // Only one open round at a time.
    expect((await host.post(`/api/events/${eventId}/revisions`, { request: 'And another thing' })).statusCode).toBe(409);
    // Cannot approve while a round is open.
    expect((await host.post(`/api/events/${eventId}/approve`)).statusCode).toBe(409);

    expect((await host.post(`/api/events/${eventId}/revisions/${revisionId}/comments`, { body: 'Thanks!' })).statusCode).toBe(201);
    expect((await admin.post(`/api/events/${eventId}/revisions/${revisionId}/comments`, { body: 'On it.' })).statusCode).toBe(201);

    const completed = await admin.patch(`/api/admin/revisions/${revisionId}`, { status: 'completed', staffNote: 'Warmer cover done.' });
    expect(completed.statusCode).toBe(200);

    const summary = (await host.get(`/api/events/${eventId}/revisions`)).json();
    expect(summary.used).toBe(1);
    expect(summary.canApprove).toBe(true);

    const approved = await host.post(`/api/events/${eventId}/approve`);
    expect(approved.statusCode).toBe(200);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).designApprovedAt).toBeTruthy();
    expect((await host.post(`/api/events/${eventId}/approve`)).statusCode).toBe(409);

    // Studio publishes the invitation.
    const inv = await prisma.invitation.findFirstOrThrow({ where: { eventId } });
    expect((await admin.post(`/api/admin/invitations/${inv.id}/publish`)).statusCode).toBe(200);
    expect((await new Client(app).get(`/api/public/invitations/${inv.slug}`)).statusCode).toBe(200);
  });

  it('hosts cannot edit a studio invitation directly or use admin routes', async () => {
    const { host, eventId } = await studioEvent();
    const res = await host.put(`/api/events/${eventId}/invitation`, { locale: 'en' });
    expect([403, 409]).toContain(res.statusCode);
    expect((await host.post(`/api/admin/events/${eventId}/stage`, { stage: 'delivered' })).statusCode).toBe(403);
  });
});
