import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client, clearDevOutbox, createUser, hostWithEvent, login, makeApp, prisma, tokenFromOutbox } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

describe('authorization', () => {
  it('requires a session for host routes', async () => {
    const anon = new Client(app);
    for (const url of ['/api/events', '/api/admin/events', '/api/admin/board']) {
      const res = await anon.get(url);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    }
  });

  it("hides other hosts' events (404, not 403) across every event sub-resource", async () => {
    const a = await hostWithEvent(app);
    const b = await hostWithEvent(app);
    const id = a.event.id;
    const urls = ['', '/stats', '/guests', '/invitees', '/seating', '/invitation', '/members', '/activity', '/rsvp-settings', '/share-kit', '/export-all'];
    for (const u of urls) {
      const res = await b.client.get(`/api/events/${id}${u}`);
      expect(res.statusCode, u).toBe(404);
    }
    expect((await b.client.patch(`/api/events/${id}`, { venueName: 'Hijack' })).statusCode).toBe(404);
    expect((await b.client.post(`/api/events/${id}/guests`, { fullName: 'Intruder' })).statusCode).toBe(404);
    expect((await b.client.post(`/api/events/${id}/guests/export`, { format: 'csv' })).statusCode).toBe(404);
    // List only shows own events.
    const list = (await b.client.get('/api/events')).json();
    expect(list.items.map((e: any) => e.id)).not.toContain(id);
  });

  it('hosts cannot use studio/admin routes', async () => {
    const { client } = await hostWithEvent(app);
    expect((await client.get('/api/admin/events')).statusCode).toBe(403);
    expect((await client.get('/api/admin/orders')).statusCode).toBe(403);
    expect((await client.post('/api/admin/users', { email: 'x@example.test', role: 'admin' })).statusCode).toBe(403);
  });

  it('staff only see assigned events; admins see all', async () => {
    const { event } = await hostWithEvent(app);
    const staff = await createUser({ role: 'staff' });
    const admin = await createUser({ role: 'admin' });
    const s = await login(app, staff.email);
    const ad = await login(app, admin.email);
    expect((await s.get(`/api/events/${event.id}`)).statusCode).toBe(404);
    expect((await ad.get(`/api/events/${event.id}`)).statusCode).toBe(200);
    await prisma.event.update({ where: { id: event.id }, data: { assignedStaffId: staff.id } });
    expect((await s.get(`/api/events/${event.id}`)).statusCode).toBe(200);
  });

  it('viewer co-hosts are read-only; only the owner manages members', async () => {
    const { client, event } = await hostWithEvent(app);
    const viewer = await createUser();
    await prisma.eventMember.create({ data: { eventId: event.id, userId: viewer.id, role: 'viewer' } });
    const v = await login(app, viewer.email);
    expect((await v.get(`/api/events/${event.id}/guests`)).statusCode).toBe(200);
    const write = await v.post(`/api/events/${event.id}/guests`, { fullName: 'Nope' });
    expect(write.statusCode).toBe(403);
    expect((await v.post(`/api/events/${event.id}/members`, { email: 'friend@example.test' })).statusCode).toBe(403);
    expect((await client.get(`/api/events/${event.id}/members`)).statusCode).toBe(200);
  });

  it('co-host invite: owner invites by email, link joins the event with a password set', async () => {
    const { client, event } = await hostWithEvent(app);
    clearDevOutbox();
    const email = `cohost.${Date.now()}@example.test`;
    const res = await client.post(`/api/events/${event.id}/members`, { email, role: 'cohost' });
    expect(res.statusCode).toBe(202);
    const raw = tokenFromOutbox(email);
    const c = new Client(app);
    const consumed = await c.post('/api/auth/token/consume', { token: raw, password: 'Cohost-Pass-11', name: 'Co Host' });
    expect(consumed.statusCode).toBe(200);
    expect(consumed.json().joinedEventId).toBe(event.id);
    expect((await c.get(`/api/events/${event.id}`)).json().myRole).toBe('cohost');
  });

  it('archived events are read-only for hosts', async () => {
    const { client, event } = await hostWithEvent(app);
    await prisma.event.update({ where: { id: event.id }, data: { archiveAfter: new Date('2020-01-01') } });
    expect((await client.get(`/api/events/${event.id}/guests`)).statusCode).toBe(200);
    expect((await client.post(`/api/events/${event.id}/guests`, { fullName: 'Late' })).statusCode).toBe(403);
  });

  it('mutations with a session require the CSRF header', async () => {
    const { client, event } = await hostWithEvent(app);
    const res = await client.req('PATCH', `/api/events/${event.id}`, { venueName: 'X' }, {}, { csrf: false });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_FAILED');
    const wrong = await client.req('PATCH', `/api/events/${event.id}`, { venueName: 'X' }, { 'x-csrf': 'forged' }, { csrf: false });
    expect(wrong.statusCode).toBe(403);
  });

  it('rejects malformed ids with a validation error', async () => {
    const { client } = await hostWithEvent(app);
    const res = await client.get('/api/events/not-a-uuid');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});
