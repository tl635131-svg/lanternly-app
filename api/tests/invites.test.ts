import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client, hostWithEvent, makeApp, prisma, publishEvent } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

describe('invite (event + invitation) CRUD', () => {
  it('creates a self-serve event with a draft invitation built from the theme engine', async () => {
    const { client, event } = await hostWithEvent(app, { themeKey: 'citrus', sections: ['our_story', 'timeline', 'faq', 'dress_code'] });
    expect(event.title).toBe('Ada & Grace');
    expect(event.serviceMode).toBe('self_serve');
    expect(event.myRole).toBe('owner');
    const inv = (await client.get(`/api/events/${event.id}/invitation`)).json();
    expect(inv.status).toBe('draft');
    expect(inv.theme.key).toBe('citrus');
    expect(inv.slug).toMatch(/^[a-z0-9-]+$/);
    expect(inv.editable).toBe(true);
    expect(inv.canPublish).toBe(false);
    expect(inv.content).toHaveProperty('en');
  });

  it('reads, updates and lists the event', async () => {
    const { client, event } = await hostWithEvent(app);
    const got = await client.get(`/api/events/${event.id}`);
    expect(got.statusCode).toBe(200);
    const patched = await client.patch(`/api/events/${event.id}`, { hostNames: { partner2: 'Linus' }, venueName: 'Lakeside Barn', eventDate: '2027-09-01' });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().title).toBe('Ada & Linus');
    expect(patched.json().venueName).toBe('Lakeside Barn');
    const list = (await client.get('/api/events')).json();
    expect(list.items.some((e: any) => e.id === event.id)).toBe(true);
  });

  it('validates event input', async () => {
    const { client } = await hostWithEvent(app);
    const bad = await client.post('/api/events', { hostNames: {}, eventDate: '14/08/2027' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields).toHaveProperty('eventDate');
    const unknownTheme = await client.post('/api/events', { hostNames: { partner1: 'A', partner2: 'B' }, themeKey: 'does-not-exist' });
    expect(unknownTheme.statusCode).toBe(422);
  });

  it('saves content/config via PUT with schema validation', async () => {
    const { client, event } = await hostWithEvent(app);
    const inv = (await client.get(`/api/events/${event.id}/invitation`)).json();
    const content = { ...inv.content, en: { ...inv.content.en, hero: { title: 'Ada & Grace', dateText: 'August 14, 2027' } } };
    const ok = await client.put(`/api/events/${event.id}/invitation`, { content });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().content.en.hero.title).toBe('Ada & Grace');
    const badConfig = await client.put(`/api/events/${event.id}/invitation`, { config: { palette: { primary: 'javascript:alert(1)' } } });
    expect(badConfig.statusCode).toBe(400);
    const reserved = await client.patch(`/api/events/${event.id}/invitation/slug`, { slug: 'admin' });
    expect(reserved.statusCode).toBe(400);
  });

  it('publishing requires payment (402) and then goes live publicly', async () => {
    const { client, event } = await hostWithEvent(app);
    const unpaid = await client.post(`/api/events/${event.id}/invitation/publish`);
    expect(unpaid.statusCode).toBe(402);
    expect(unpaid.json().error.code).toBe('PAYMENT_REQUIRED');
    const inv = (await client.get(`/api/events/${event.id}/invitation`)).json();
    expect((await new Client(app).get(`/api/public/invitations/${inv.slug}`)).statusCode).toBe(404);
    const published = await publishEvent(client, event.id);
    expect(published.status).toBe('published');
    const pub = await new Client(app).get(`/api/public/invitations/${inv.slug}`);
    expect(pub.statusCode).toBe(200);
    expect(pub.json().event.title).toBe('Ada & Grace');
    expect(pub.headers['x-robots-tag']).toContain('noindex');

    // Versions + unpublish
    const versions = (await client.get(`/api/events/${event.id}/invitation/versions`)).json();
    expect(versions.items ?? versions).toBeTruthy();
    expect((await client.post(`/api/events/${event.id}/invitation/unpublish`)).statusCode).toBe(200);
    expect((await new Client(app).get(`/api/public/invitations/${inv.slug}`)).statusCode).toBe(404);
  });

  it('preview token lets the host preview a draft', async () => {
    const { client, event } = await hostWithEvent(app);
    const inv = (await client.get(`/api/events/${event.id}/invitation`)).json();
    const token = new URL(inv.previewUrl).searchParams.get('preview');
    expect(token).toBeTruthy();
    const res = await new Client(app).get(`/api/public/invitations/${inv.slug}?preview=${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().invitation.preview).toBe(true);
    expect(res.json().rsvp.open).toBe(false);
  });

  it('archived invitation returns 410', async () => {
    const { client, event } = await hostWithEvent(app);
    await publishEvent(client, event.id);
    const inv = await prisma.invitation.findFirstOrThrow({ where: { eventId: event.id } });
    await prisma.invitation.update({ where: { id: inv.id }, data: { status: 'archived' } });
    const res = await new Client(app).get(`/api/public/invitations/${inv.slug}`);
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('GONE');
  });

  it('serves the seeded studio demo invitation with sections and music', async () => {
    const res = await new Client(app).get('/api/public/invitations/maya-and-theo?lang=fr');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lang).toBe('fr');
    expect(body.languages).toEqual(['en', 'fr']);
    expect(body.music.title).toBe('Harbour Morning');
    const en = (await new Client(app).get('/api/public/invitations/maya-and-theo')).json();
    expect(Object.keys(en.content.sections)).toEqual(expect.arrayContaining(['our_story', 'timeline', 'dress_code', 'gift_list', 'faq', 'countdown', 'accommodation', 'transport', 'venue']));
    expect(en.rsvp.mealOptions).toEqual(['beef', 'salmon', 'vegetarian']);
  });
});
