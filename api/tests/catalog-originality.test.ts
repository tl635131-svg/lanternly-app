import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { briefSectionSchema } from '../src/lib/brief.js';
import { InvitationConfigSchema } from '../src/lib/theme-engine.js';
import { ADDONS, RETIRED_ADDON_CODES } from '../src/lib/addons.js';
import { Client, hostWithEvent, makeApp, prisma, uniqueEmail, mockCheckout } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

const BANNED = /\b(wax|seal(ed)?|envelope|ivory|wine|gold(en)?|burgundy)\b/i;

describe('add-ons (Lanternly set)', () => {
  it('catalogue lists exactly the six current add-ons with CAD placeholder prices (reminder_pack retired, custom_link added)', async () => {
    const cat = (await new Client(app).get('/api/public/catalogue')).json();
    const extras = Object.fromEntries(cat.extras.map((e: any) => [e.code, e.priceCents]));
    expect(extras).toEqual({ own_song: 1500, custom_monogram: 2500, extra_language: 2000, photo_cover_film: 4500, rush_design: 6900, custom_link: 1900 });
    expect(cat.planExtras.premium).toContain('extra_language');
    for (const plan of Object.keys(cat.planExtras)) expect(cat.planExtras[plan]).toContain('custom_link');
    expect(cat.plans.find((p: any) => p.code === 'diy').steps).toEqual(['theme', 'extras', 'languages', 'info', 'summary']);
    expect(Object.fromEntries(cat.plans.map((p: any) => [p.code, p.maxLanguages]))).toMatchObject({ diy: 2, experience: 3, premium: 5, std: 1, birthday: 1, bridesmaid: 1 });
    expect(cat.extras.every((e: any) => e.currency === 'CAD')).toBe(true);
    for (const code of RETIRED_ADDON_CODES) expect(JSON.stringify(cat.planExtras)).not.toContain(`"${code}"`);
    expect(cat.extraBriefSections).toEqual({ own_song: 'own_song', custom_monogram: 'custom_monogram', photo_cover_film: 'photo_cover_film', custom_link: 'custom_link' });
    expect(JSON.stringify(cat)).not.toMatch(BANNED);
    expect(ADDONS).toHaveLength(6);
  });

  it('retired add-on codes are rejected at checkout', async () => {
    const c = new Client(app);
    for (const code of ['wax_seal', 'custom_music', 'illustration', 'animated_video', 'express', 'reminder_pack']) {
      const res = await c.post('/api/checkout/quote', { plan: 'experience', themeKey: 'evening', extras: [code] });
      expect(res.statusCode).toBe(422);
    }
  });

  it('extra language: +1 per unit, can be bought more than once, offered (and charged) on Couture too', async () => {
    const c = new Client(app);
    const four = ['en', 'fr', 'es', 'de'];
    expect((await c.post('/api/checkout/quote', { plan: 'experience', themeKey: 'evening', languages: four })).statusCode).toBe(422);
    const ok = await c.post('/api/checkout/quote', { plan: 'experience', themeKey: 'evening', languages: four, extras: ['extra_language'] });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().lines.find((l: any) => l.code === 'extra_language')).toMatchObject({ qty: 1, totalCents: 2000 });
    const five = [...four, 'it'];
    expect((await c.post('/api/checkout/quote', { plan: 'experience', themeKey: 'evening', languages: five, extras: ['extra_language'] })).statusCode).toBe(422);
    const two = await c.post('/api/checkout/quote', { plan: 'experience', themeKey: 'evening', languages: five, extras: ['extra_language', 'extra_language'] });
    expect(two.statusCode).toBe(200);
    expect(two.json().lines.find((l: any) => l.code === 'extra_language')).toMatchObject({ qty: 2, unitPriceCents: 2000, totalCents: 4000 });
    expect(two.json().extras).toEqual(['extra_language', 'extra_language']);
    // Non-repeatable add-ons are counted once.
    expect((await c.post('/api/checkout/quote', { plan: 'experience', themeKey: 'evening', extras: ['own_song', 'own_song'] })).json().lines.find((l: any) => l.code === 'own_song').qty).toBe(1);
    // Couture: 5 included; "all add-ons included" does not cover extra_language, so a 6th costs CA$20.
    const six = [...five, 'nl'];
    expect((await c.post('/api/checkout/quote', { plan: 'premium', languages: six })).statusCode).toBe(422);
    const couture = await c.post('/api/checkout/quote', { plan: 'premium', languages: six, extras: ['extra_language', 'own_song'] });
    expect(couture.statusCode).toBe(200);
    expect(couture.json().lines.find((l: any) => l.code === 'extra_language')).toMatchObject({ qty: 1, unitPriceCents: 2000, totalCents: 2000 });
    expect(couture.json().lines.find((l: any) => l.code === 'extra_language')).not.toHaveProperty('included');
    expect(couture.json().lines.find((l: any) => l.code === 'own_song')).toMatchObject({ totalCents: 0, included: true });
  });

  it('rush design marks the event as express; info.message is stored and the removed info.letter is rejected', async () => {
    const email = uniqueEmail('rush');
    const s = (
      await new Client(app).post('/api/checkout/session', {
        plan: 'std', themeKey: 'lilac', extras: ['rush_design', 'custom_monogram'], languages: ['en'],
        info: { partner1: 'Noor', partner2: 'Eli', eventDate: '2027-04-10', email, message: 'Save the date!' },
        consents: { terms: true, privacy: true },
      })
    ).json();
    const legacy = await new Client(app).post('/api/checkout/session', { plan: 'std', themeKey: 'lilac', info: { partner1: 'Noor', partner2: 'Eli', eventDate: '2027-04-10', email, letter: 'x' }, consents: { terms: true, privacy: true } });
    expect(legacy.statusCode).toBe(400);
    expect(legacy.json().error.fields).toHaveProperty(['info.letter']);
    expect((await new Client(app).put(`/api/checkout/drafts/${randomUUID()}`, { info: { letter: 'x' } })).statusCode).toBe(400);
    expect(s.orderId).toBeTruthy();
    const done = (await mockCheckout(app, s.sessionId, 'complete', { redirect: false })).json();
    const event = await prisma.event.findUniqueOrThrow({ where: { id: done.eventId } });
    expect(event.express).toBe(true);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: s.orderId } });
    expect((order.buyerInfo as any).message).toBe('Save the date!');
    expect((order.buyerInfo as any).letter).toBeUndefined();
    const brief = await prisma.brief.findUniqueOrThrow({ where: { eventId: done.eventId } });
    expect(brief.sections).toContain('custom_monogram');
  });

  it('brief sections: monogram / song / cover film exist; seal sections are gone', () => {
    expect(briefSectionSchema('custom_wax_seal')).toBeNull();
    expect(briefSectionSchema('custom_illustration')).toBeNull();
    expect(briefSectionSchema('custom_monogram')!.safeParse({ letters: 'N&E', glowColor: '#F4A93A' }).success).toBe(true);
    expect(briefSectionSchema('custom_monogram')!.safeParse({ envelopeColor: '#FFFFFF' }).data).toEqual({});
    expect(briefSectionSchema('photo_cover_film')).toBeTruthy();
    expect(briefSectionSchema('own_song')).toBeTruthy();
  });
});

describe('themes (Lanternly gallery)', () => {
  const EXPECTED: Record<string, [string, string]> = {
    evening: ['#12143A', '#F4A93A'],
    harbour: ['#0F3B3E', '#FF9C7A'],
    meadow: ['#EEF3EA', '#1F3A2A'],
    citrus: ['#FFFFFF', '#C2410C'],
    lilac: ['#E7E3F7', '#2B2466'],
    nocturne: ['#1B1B1F', '#9FE3C4'],
  };

  it('seeds exactly the six designer themes, usable for every product', async () => {
    const { items } = (await new Client(app).get('/api/public/themes')).json();
    const seeded = items.filter((t: any) => t.key in EXPECTED);
    expect(items.map((t: any) => t.key)).toEqual(Object.keys(EXPECTED));
    for (const t of seeded) {
      expect([t.defaultConfig.palette.background, t.defaultConfig.palette.accent]).toEqual(EXPECTED[t.key]);
      expect(t).not.toHaveProperty('product');
      expect(t.products).toEqual(['wedding_invite', 'save_the_date', 'birthday', 'bridesmaid']);
      expect(t.defaultConfig.cover.type).toBe('glow');
      expect(InvitationConfigSchema.safeParse(t.defaultConfig).success).toBe(true);
    }
    expect(JSON.stringify(items)).not.toMatch(BANNED);
    const birthday = (await new Client(app).get('/api/public/themes?product=birthday')).json();
    expect(birthday.items).toHaveLength(6);
    expect((await new Client(app).post('/api/checkout/quote', { plan: 'birthday', themeKey: 'citrus' })).statusCode).toBe(200);
    expect((await new Client(app).get('/api/public/themes/coastal-linen')).statusCode).toBe(404);
  });

  it('cover type "glow" replaces "envelope"; seal/envelope colours are rejected', async () => {
    expect(InvitationConfigSchema.safeParse({ cover: { type: 'glow', glowColor: '#F4A93A' } }).success).toBe(true);
    expect(InvitationConfigSchema.safeParse({ cover: { type: 'envelope' } }).success).toBe(false);
    const { client, event } = await hostWithEvent(app, { themeKey: 'nocturne' });
    const bad = await client.put(`/api/events/${event.id}/invitation`, { config: { cover: { type: 'glow', sealColor: '#000000' } } });
    expect(bad.statusCode).toBe(400);
    const ok = await client.put(`/api/events/${event.id}/invitation`, { config: { cover: { type: 'glow', initials: 'A&G' } } });
    expect(ok.statusCode).toBe(200);
  });

  it('seeded demo invitations carry no reference-derived design or copy', async () => {
    const demo = (await new Client(app).get('/api/public/invitations/maya-and-theo')).json();
    const text = JSON.stringify(demo);
    expect(text).not.toMatch(BANNED);
    expect(text).not.toContain('Together with their families');
    expect((await new Client(app).get('/api/public/invitations/demo-meadow')).statusCode).toBe(200);
    expect((await new Client(app).get('/api/public/invitations/demo-garden-watercolour')).statusCode).toBe(404);
  });
});

describe('testimonials', () => {
  it('returns only flagged sample copy: no ratings, no verified badges, no masked names', async () => {
    const res = (await new Client(app).get('/api/public/reviews')).json();
    expect(res.items.length).toBeGreaterThanOrEqual(3);
    expect(res.onlySamples).toBe(true);
    for (const r of res.items) {
      expect(r.isSample).toBe(true);
      expect(r).not.toHaveProperty('rating');
      expect(r).not.toHaveProperty('verified');
      expect(r.displayName).not.toContain('*');
    }
    expect(res).not.toHaveProperty('average');
    expect(res.items.map((r: any) => r.displayName)).toEqual(expect.arrayContaining(['Aanya & Jordan', 'Priya', 'Lucas & Mei']));
  });

  it('returns an empty list gracefully when nothing is published', async () => {
    const published = await prisma.review.findMany({ where: { published: true }, select: { id: true } });
    await prisma.review.updateMany({ where: { id: { in: published.map((r) => r.id) } }, data: { published: false } });
    try {
      const res = await new Client(app).get('/api/public/reviews');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ items: [], nextCursor: null, count: 0, onlySamples: false });
    } finally {
      await prisma.review.updateMany({ where: { id: { in: published.map((r) => r.id) } }, data: { published: true } });
    }
  });
});
