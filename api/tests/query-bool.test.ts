import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { queryBool, queryBoolDefault } from '../src/lib/query.js';
import { Client, createUser, hostWithEvent, login, makeApp, prisma, publishEvent, uniqueEmail, mockCheckout } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

describe('queryBool parser', () => {
  it('accepts exactly true/false/1/0 and rejects everything else', () => {
    expect(queryBool().parse('true')).toBe(true);
    expect(queryBool().parse('1')).toBe(true);
    expect(queryBool().parse('false')).toBe(false);
    expect(queryBool().parse('0')).toBe(false);
    for (const bad of ['yes', 'no', 'TRUE', 'False', '', ' true', '2', 'on']) expect(queryBool().safeParse(bad).success, bad).toBe(false);
    expect(queryBoolDefault(true).parse(undefined)).toBe(true);
    expect(queryBoolDefault(false).parse(undefined)).toBe(false);
    expect(queryBoolDefault(true).parse('false')).toBe(false);
  });
});

describe('boolean query params on routes', () => {
  const csv = 'first name,email\nQuinn,quinn@example.test\nRiley,riley@example.test\n';

  it('invitee import: ?commit=false and ?commit=0 do NOT commit; ?commit=true does; ?commit=yes → 400', async () => {
    const { client, event } = await hostWithEvent(app);
    const url = `/api/events/${event.id}/invitees/import`;
    const count = () => prisma.invitee.count({ where: { eventId: event.id } });
    const headers = { 'content-type': 'text/csv' };

    for (const q of ['?commit=false', '?commit=0', '']) {
      const res = await client.req('POST', url + q, csv, headers);
      expect(res.statusCode, q).toBe(200);
      expect(res.json().valid).toBe(2);
      expect(await count(), q).toBe(0);
    }
    const bad = await client.req('POST', url + '?commit=yes', csv, headers);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');
    expect(bad.json().error.fields).toHaveProperty('querystring.commit');
    expect(await count()).toBe(0);

    const ok = await client.req('POST', url + '?commit=true', csv, headers);
    expect(ok.statusCode).toBe(201);
    expect(await count()).toBe(2);
    const one = await client.req('POST', url + '?commit=1', csv, headers);
    expect(one.statusCode).toBe(201);
    expect(await count()).toBe(4);
  });

  it('guests: ?trash=false lists live guests, ?trash=true the trash; ?permanent=false only trashes', async () => {
    const { client, event } = await hostWithEvent(app);
    const g = (await client.post(`/api/events/${event.id}/guests`, { fullName: 'Trash Me' })).json();
    expect((await client.del(`/api/events/${event.id}/guests/${g.id}?permanent=false`)).statusCode).toBe(204);
    expect(await prisma.guest.count({ where: { id: g.id } })).toBe(1); // soft-deleted, not removed

    const live = (await client.get(`/api/events/${event.id}/guests?trash=false`)).json();
    expect(live.items.map((x: any) => x.id)).not.toContain(g.id);
    const trash = (await client.get(`/api/events/${event.id}/guests?trash=true`)).json();
    expect(trash.items.map((x: any) => x.id)).toContain(g.id);
    expect((await client.get(`/api/events/${event.id}/guests?trash=maybe`)).statusCode).toBe(400);

    expect((await client.del(`/api/events/${event.id}/guests/${g.id}?permanent=1`)).statusCode).toBe(204);
    expect(await prisma.guest.count({ where: { id: g.id } })).toBe(0);
  });

  it('QR: ?download=false has no attachment header; ?download=true does; invalid → 400', async () => {
    const { client, event } = await hostWithEvent(app);
    await publishEvent(client, event.id);
    const off = await client.get(`/api/events/${event.id}/qr?format=svg&download=false`);
    expect(off.statusCode).toBe(200);
    expect(off.headers['content-disposition']).toBeUndefined();
    const on = await client.get(`/api/events/${event.id}/qr?format=svg&download=true`);
    expect(on.headers['content-disposition']).toMatch(/attachment/);
    expect((await client.get(`/api/events/${event.id}/qr?download=please`)).statusCode).toBe(400);
  });

  it('mock checkout: ?redirect=false returns JSON even for browsers; default redirects', async () => {
    const mk = async () =>
      (
        await new Client(app).post('/api/checkout/session', {
          plan: 'experience',
          themeKey: 'harbour',
          info: { partner1: 'A', partner2: 'B', eventDate: '2027-07-10', email: uniqueEmail('qb') },
          consents: { terms: true, privacy: true },
        })
      ).json();
    const a = await mk();
    const json = await mockCheckout(app, a.sessionId, 'complete', { redirect: false, headers: { accept: 'text/html' } });
    expect(json.statusCode).toBe(200);
    expect(json.json().status).toBe('paid');
    const b = await mk();
    const redirect = await mockCheckout(app, b.sessionId, 'complete', { headers: { accept: 'text/html' } });
    expect(redirect.statusCode).toBe(303);
  });

  it('admin checkout drafts: ?abandoned=false excludes abandoned drafts', async () => {
    const admin = await login(app, (await createUser({ role: 'admin' })).email);
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    await new Client(app).put(`/api/checkout/drafts/${ids[0]}`, { plan: 'experience', abandoned: true });
    await new Client(app).put(`/api/checkout/drafts/${ids[1]}`, { plan: 'experience', abandoned: false });
    const listIds = async (q: string) => {
      const out: string[] = [];
      let cursor: string | null = null;
      do {
        const r: any = (await admin.get(`/api/admin/checkout-drafts?limit=200${q}${cursor ? `&cursor=${cursor}` : ''}`)).json();
        out.push(...r.items.map((d: any) => d.id));
        cursor = r.nextCursor;
      } while (cursor);
      return out;
    };
    const notAbandoned = await listIds('&abandoned=false');
    expect(notAbandoned).toContain(ids[1]);
    expect(notAbandoned).not.toContain(ids[0]);
    const abandoned = await listIds('&abandoned=true');
    expect(abandoned).toContain(ids[0]);
    expect(abandoned).not.toContain(ids[1]);
    expect((await admin.get('/api/admin/checkout-drafts?abandoned=nope')).statusCode).toBe(400);
  });
});
