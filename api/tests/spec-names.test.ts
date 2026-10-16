/**
 * Names aligned with the final spec (spec/api.md, spec/data-model.md):
 * PATCH …/invitation/slug, invitation_slug_redirects + 301 for pages, FEATURE_OWN_SONG → 403 FEATURE_DISABLED,
 * 402 ADDON_PAYMENT_REQUIRED (publish changes, slug, languages), add-ons checkout errors and GET …/addons.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { features } from '../src/config.js';
import { refundOrder } from '../src/services/orders.js';
import { Client, clearDevOutbox, createUser, hostWithEvent, login, makeApp, mockCheckout, prisma, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
let admin: Client;
beforeAll(async () => {
  app = await makeApp();
  admin = await login(app, (await createUser({ role: 'admin' })).email);
});
afterAll(async () => {
  features.ownSong = true;
  await app.close();
});
beforeEach(() => clearDevOutbox());

const CONSENTS = { terms: true, privacy: true };
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(2048, 1)]);

async function paySelfServe(client: Client, eventId: string, extras: unknown[] = []) {
  const s = await client.post('/api/checkout/session', { plan: 'diy', eventId, extras, info: { email: 'ignored@example.test' }, consents: CONSENTS });
  if (s.statusCode !== 200) throw new Error(s.body);
  await mockCheckout(app, s.json().sessionId, 'complete', { redirect: false });
}

async function studioEvent(plan: 'experience' | 'premium' = 'experience') {
  const email = uniqueEmail('studio');
  const s = (await new Client(app).post('/api/checkout/session', { plan, ...(plan === 'experience' ? { themeKey: 'harbour' } : {}), info: { partner1: 'Ana', partner2: 'Ben', eventDate: '2027-08-01', email }, consents: CONSENTS })).json();
  const done = (await mockCheckout(app, s.sessionId, 'complete', { redirect: false })).json();
  const member = async (role: 'cohost' | 'viewer') => {
    const u = await createUser();
    await prisma.eventMember.create({ data: { eventId: done.eventId, userId: u.id, role } });
    return login(app, u.email);
  };
  return { eventId: done.eventId as string, member };
}

describe('PATCH /api/events/:id/invitation/slug', () => {
  it('self-serve: returns {slug, url, previousSlugs}; reserved 400, taken 409, viewer 403, CSRF required; PUT {slug} → 400', async () => {
    const { client, event } = await hostWithEvent(app, { hostNames: { partner1: 'Lia', partner2: 'Noor' } });
    const url = `/api/events/${event.id}/invitation/slug`;
    const auto = (await client.get(`/api/events/${event.id}/invitation`)).json().slug;
    const reserved = await client.patch(url, { slug: 'admin' });
    expect(reserved.statusCode).toBe(400);
    expect(reserved.json().error).toMatchObject({ code: 'VALIDATION_ERROR', fields: { slug: 'reserved' } });
    expect((await client.patch(url, { slug: 'No Spaces' })).statusCode).toBe(400);
    expect((await client.patch(url, { slug: 'ab' })).statusCode).toBe(400);
    const taken = await client.patch(url, { slug: 'maya-and-theo' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('CONFLICT');
    expect((await client.req('PATCH', url, { slug: `lia-noor-${randomUUID().slice(0, 5)}` }, {}, { csrf: false })).statusCode).toBe(403);

    // Normalised, not rejected: lowercased, hyphen runs collapsed, leading/trailing hyphens stripped.
    const tag = randomUUID().slice(0, 6);
    const norm = await client.patch(url, { slug: `--Lia---Noor--${tag}-` });
    expect(norm.statusCode).toBe(200);
    expect(norm.json().slug).toBe(`lia-noor-${tag}`);
    expect((await client.patch(url, { slug: '-a-' })).statusCode).toBe(400); // too short after normalising
    expect((await client.patch(url, { slug: '--Admin--' })).json().error.fields).toEqual({ slug: 'reserved' });
    const mine = `lia-noor-${randomUUID().slice(0, 6)}`;
    const ok = await client.patch(url, { slug: mine });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ slug: mine, url: `http://localhost:3000/i/${mine}` });
    expect(ok.json().previousSlugs.sort()).toEqual([auto, `lia-noor-${tag}`].sort());
    // Unpaid self-serve: picking a link selects custom_link (charged at the first payment).
    expect((await client.get(`/api/events/${event.id}`)).json().selectedExtras).toContain('custom_link');
    // The old PUT {slug} alias is removed: 400 pointing at the PATCH route, and nothing changes.
    const viaPut = await client.put(`/api/events/${event.id}/invitation`, { slug: `${mine}-b`, locale: 'en' });
    expect(viaPut.statusCode).toBe(400);
    expect(viaPut.json().error).toMatchObject({ code: 'VALIDATION_ERROR', fields: { slug: 'The link is changed with PATCH /api/events/:id/invitation/slug.' } });
    expect((await client.get(`/api/events/${event.id}/invitation`)).json().slug).toBe(mine);
    expect((await client.patch(url, { slug: `${mine}-b` })).json().previousSlugs.sort()).toEqual([auto, `lia-noor-${tag}`, mine].sort());
  });

  it('studio: a co-host needs custom_link (402 ADDON_PAYMENT_REQUIRED); Couture includes it; viewers 403; admins may always rename', async () => {
    const { eventId, member } = await studioEvent('experience');
    const url = `/api/events/${eventId}/invitation/slug`;
    const cohost = await member('cohost');
    const blocked = await cohost.patch(url, { slug: `ana-ben-${randomUUID().slice(0, 6)}` });
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json().error).toMatchObject({ code: 'ADDON_PAYMENT_REQUIRED', details: { addon: 'custom_link', eventId, checkout: '/api/checkout/addons', missing: [{ code: 'custom_link', qty: 1 }] } });
    expect((await (await member('viewer')).patch(url, { slug: `ana-ben-${randomUUID().slice(0, 6)}` })).statusCode).toBe(403);
    const byAdmin = await admin.patch(url, { slug: `ana-ben-${randomUUID().slice(0, 6)}` });
    expect(byAdmin.statusCode).toBe(200);
    expect(byAdmin.json().previousSlugs).toHaveLength(1);

    const couture = await studioEvent('premium');
    expect((await (await couture.member('cohost')).patch(`/api/events/${couture.eventId}/invitation/slug`, { slug: `couture-${randomUUID().slice(0, 6)}` })).statusCode).toBe(200);
  });
});

describe('invitation_slug_redirects and 301 for page requests', () => {
  it('stores old slugs in invitation_slug_redirects(old_slug); pages 301 with ?g= and ?lang= kept; JSON returns redirectedFrom', async () => {
    const { client, event } = await hostWithEvent(app, { languages: ['en', 'fr'] });
    const old = (await client.get(`/api/events/${event.id}/invitation`)).json().slug;
    const next = `moved-${randomUUID().slice(0, 6)}`;
    await client.patch(`/api/events/${event.id}/invitation/slug`, { slug: next });
    await paySelfServe(client, event.id, ['custom_link']);
    expect((await client.post(`/api/events/${event.id}/invitation/publish`)).statusCode).toBe(200);
    const rows = await prisma.$queryRaw<{ old_slug: string }[]>`SELECT old_slug FROM invitation_slug_redirects WHERE invitation_id = (SELECT id FROM invitations WHERE slug = ${next})`;
    expect(rows.map((r) => r.old_slug)).toEqual([old]);

    const page = await new Client(app).get(`/api/public/invitations/${old}?g=tok123&lang=fr`, { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' });
    expect(page.statusCode).toBe(301);
    expect(page.headers.location).toBe(`http://localhost:3000/i/${next}?g=tok123&lang=fr`);
    const json = await new Client(app).get(`/api/public/invitations/${old}?lang=fr`, { accept: 'application/json' });
    expect(json.statusCode).toBe(200);
    expect(json.json().invitation).toMatchObject({ slug: next, redirectedFrom: old });
    // The current slug never redirects.
    const current = await new Client(app).get(`/api/public/invitations/${next}`, { accept: 'text/html' });
    expect(current.statusCode).toBe(200);
    expect(current.json().invitation.redirectedFrom).toBeNull();
  });
});

describe('FEATURE_OWN_SONG=false → 403 FEATURE_DISABLED', () => {
  it('hides own_song in the catalogue and blocks every own-song path; library tracks still work', async () => {
    const { client, event } = await hostWithEvent(app);
    const studio = await studioEvent('experience');
    features.ownSong = false;
    try {
      const cat = (await new Client(app).get('/api/public/catalogue')).json();
      expect(cat.extras.map((e: any) => e.code)).not.toContain('own_song');
      for (const codes of Object.values(cat.planExtras) as string[][]) expect(codes).not.toContain('own_song');
      expect(cat.extraBriefSections).not.toHaveProperty('own_song');

      const expect403 = (res: any) => {
        expect(res.statusCode).toBe(403);
        expect(res.json().error).toMatchObject({ code: 'FEATURE_DISABLED', details: { feature: 'own_song' } });
      };
      // Checkout lines (quote, session, add-ons checkout, Extras step).
      expect403(await new Client(app).post('/api/checkout/quote', { plan: 'experience', themeKey: 'harbour', extras: ['own_song'] }));
      expect403(await client.post('/api/checkout/session', { plan: 'diy', eventId: event.id, extras: ['own_song'], info: { email: 'x@example.test' }, consents: CONSENTS }));
      expect403(await admin.post('/api/checkout/addons/quote', { eventId: studio.eventId, extras: ['own_song'] }));
      expect403(await client.patch(`/api/events/${event.id}`, { selectedExtras: ['own_song'] }));
      // Music upload.
      const boundary = '----flag';
      const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="rightsConfirmed"\r\n\r\ntrue\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="s.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`), MP3, Buffer.from(`\r\n--${boundary}--\r\n`)]);
      expect403(await client.req('POST', `/api/events/${event.id}/assets?kind=music`, body, { 'content-type': `multipart/form-data; boundary=${boundary}` }));
      // Rights endpoints.
      expect403(await client.get(`/api/events/${event.id}/music-rights`));
      expect403(await client.post(`/api/events/${event.id}/music-rights`, { url: 'https://example.com/s.mp3', confirmed: true }));
      // Editor custom song link and brief own_song.
      expect403(await client.put(`/api/events/${event.id}/invitation`, { config: { music: { externalUrl: 'https://example.com/s.mp3' } }, musicRightsConfirmed: true }));
      await prisma.brief.update({ where: { eventId: studio.eventId }, data: { sections: { push: 'own_song' } } });
      expect403(await admin.patch(`/api/admin/events/${studio.eventId}/brief`, { data: { own_song: { description: 'x' } } }));
      // Library tracks are unaffected.
      const track = await prisma.musicTrack.findFirstOrThrow({ where: { active: true } });
      expect((await client.put(`/api/events/${event.id}/invitation`, { config: { music: { trackId: track.id } } })).statusCode).toBe(200);
      expect((await client.get(`/api/events/${event.id}/addons`)).json().available.map((a: any) => a.code)).not.toContain('own_song');
    } finally {
      features.ownSong = true;
    }
    expect((await new Client(app).get('/api/public/catalogue')).json().extras.map((e: any) => e.code)).toContain('own_song');
  });
});

describe('Publish changes with an unpaid add-on → 402 ADDON_PAYMENT_REQUIRED', () => {
  it('lists details.missing [{code, qty}] (own song, languages over the cap); buying them unblocks publishing', async () => {
    const { client, event } = await hostWithEvent(app);
    await paySelfServe(client, event.id);
    expect((await client.post(`/api/events/${event.id}/invitation/publish`)).statusCode).toBe(200);
    // Simulate a draft that uses unpaid add-ons (e.g. after an add-on refund).
    const inv = await prisma.invitation.findFirstOrThrow({ where: { eventId: event.id } });
    await prisma.invitation.update({ where: { id: inv.id }, data: { config: { ...(inv.config as object), music: { externalUrl: 'https://example.com/ours.mp3' } }, draftChangedAt: new Date() } });
    await prisma.event.update({ where: { id: event.id }, data: { languages: ['en', 'fr', 'es', 'de'] } });

    const res = await client.post(`/api/events/${event.id}/invitation/publish`);
    expect(res.statusCode).toBe(402);
    expect(res.json().error).toMatchObject({ code: 'ADDON_PAYMENT_REQUIRED', details: { eventId: event.id, checkout: '/api/checkout/addons', addon: 'own_song' } });
    expect(res.json().error.details.missing).toEqual([{ code: 'own_song', qty: 1 }, { code: 'extra_language', qty: 2 }]);
    const addons = (await client.get(`/api/events/${event.id}/addons`)).json();
    expect(addons.missing).toEqual([{ code: 'own_song', qty: 1 }, { code: 'extra_language', qty: 2 }]);

    // Buy exactly what's missing ({code, qty} items) → publish works.
    const s = await client.post('/api/checkout/addons', { eventId: event.id, extras: [{ code: 'own_song' }, { code: 'extra_language', qty: 2 }], consents: CONSENTS }, { 'idempotency-key': randomUUID() });
    expect(s.statusCode).toBe(200);
    expect(s.json().subtotalCents).toBe(1500 + 2 * 2000);
    await mockCheckout(app, s.json().sessionId, 'complete', { redirect: false });
    expect((await client.get(`/api/events/${event.id}/addons`)).json()).toMatchObject({ missing: [], purchased: expect.arrayContaining([{ code: 'own_song', qty: 1 }, { code: 'extra_language', qty: 2 }]) });
    expect((await client.post(`/api/events/${event.id}/invitation/publish`)).statusCode).toBe(200);
  });
});

describe('add-ons checkout: spec errors and GET /api/events/:id/addons', () => {
  it('empty → 400, included in plan → 422, rush after delivery → 422, Couture can buy extra_language, idempotent retries', async () => {
    const { eventId, member } = await studioEvent('premium');
    const cohost = await member('cohost');
    expect((await cohost.post('/api/checkout/addons', { eventId, extras: [], consents: CONSENTS })).statusCode).toBe(400);
    const included = await cohost.post('/api/checkout/addons/quote', { eventId, extras: ['own_song'] });
    expect(included.statusCode).toBe(422);
    expect(included.json().error.code).toBe('INVALID_SELECTION');
    const seven = ['en', 'fr', 'es', 'de', 'it', 'pt', 'nl'];
    expect((await cohost.post('/api/checkout/addons/quote', { eventId, extras: [{ code: 'extra_language', qty: 2 }] })).statusCode).toBe(400); // 5 included: nothing needed → trimmed to empty
    const lang = await cohost.post('/api/checkout/addons/quote', { eventId, extras: [{ code: 'extra_language', qty: 2 }], languages: seven });
    expect(lang.json()).toMatchObject({ subtotalCents: 4000, lines: [{ code: 'extra_language', qty: 2, unitPriceCents: 2000 }] });
    const key = randomUUID();
    const a = await cohost.post('/api/checkout/addons', { eventId, extras: ['extra_language'], languages: seven, consents: CONSENTS }, { 'idempotency-key': key });
    const b = await cohost.post('/api/checkout/addons', { eventId, extras: ['extra_language'], languages: seven, consents: CONSENTS }, { 'idempotency-key': key });
    expect(b.json().orderId).toBe(a.json().orderId);
    const view = (await cohost.get(`/api/events/${eventId}/addons`)).json();
    expect(view).toMatchObject({ plan: 'premium', paid: true, missing: [] });
    expect(view.included).toEqual(expect.arrayContaining(['own_song', 'custom_link']));
    expect(view.available).toEqual([expect.objectContaining({ code: 'extra_language', priceCents: 2000, maxQty: 20 })]);

    const sig = await studioEvent('experience');
    await prisma.event.update({ where: { id: sig.eventId }, data: { productionStage: 'delivered' } });
    expect((await admin.post('/api/checkout/addons/quote', { eventId: sig.eventId, extras: ['rush_design'] })).statusCode).toBe(422);
  });
});

describe('gift list: display-only modes', () => {
  const setup = async () => {
    const { client, event } = await hostWithEvent(app, { sections: ['gift_list'] });
    const put = (gift: unknown) => client.put(`/api/events/${event.id}/invitation`, { content: { en: { sections: { gift_list: gift } } } });
    return { client, event, put };
  };

  it('cash: message optional (≤1000); one complete payout method (Interac, institution+transit+account, or IBAN) else 422 GIFT_PAYOUT_REQUIRED; payment fields rejected', async () => {
    const { put } = await setup();
    const interac = { interacEmail: 'gifts@example.test' };
    // The message is optional: no note + a complete payout method passes; no note + no payout → 422.
    expect((await put({ mode: 'cash', ...interac })).statusCode).toBe(200);
    expect((await put({ mode: 'cash', bank: { institutionNumber: '003', transitNumber: '12345', accountNumber: '1234567' } })).statusCode).toBe(200);
    const bare = await put({ mode: 'cash' });
    expect(bare.statusCode).toBe(422);
    expect(bare.json().error.code).toBe('GIFT_PAYOUT_REQUIRED');
    expect((await put({ mode: 'cash', note: 'x'.repeat(1001), ...interac })).statusCode).toBe(400); // max length kept
    // No complete payout method → 422 GIFT_PAYOUT_REQUIRED.
    for (const partial of [{}, { bank: { institutionNumber: '003', transitNumber: '12345' } }, { bank: { holder: 'A B', bank: 'RBC' } }, { bank: { bic: 'NWBKGB2L' } }]) {
      const res = await put({ mode: 'cash', note: 'Thanks', ...partial });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('GIFT_PAYOUT_REQUIRED');
      expect(res.json().error.fields).toHaveProperty(['content.en.sections.gift_list.interacEmail']);
    }
    // Any one complete method is enough.
    expect((await put({ mode: 'cash', note: 'Thanks', ...interac })).statusCode).toBe(200);
    expect((await put({ mode: 'cash', note: 'Thanks', bank: { institutionNumber: '003', transitNumber: '12345', accountNumber: '1234567' } })).statusCode).toBe(200);
    expect((await put({ mode: 'cash', note: 'Thanks', bank: { iban: 'GB82 WEST 1234 5698 7654 32' } })).statusCode).toBe(200);
    expect((await put({ mode: 'cash', note: 'Thanks', bank: { transitNumber: '1234' } })).statusCode).toBe(400); // same bank rules
    for (const extra of [{ amount: 5000 }, { paymentLink: 'https://pay.example.com' }, { currency: 'CAD' }, { stripePriceId: 'price_1' }]) {
      const res = await put({ mode: 'cash', note: 'Thanks', ...interac, ...extra });
      expect(res.statusCode).toBe(400);
    }
    expect((await put({ mode: 'cash', note: 'Thanks', bank: { cardNumber: '4242424242424242' } })).statusCode).toBe(400);
  });

  it('brief completion: cash with a payout method and no note is complete; without payout it is not', async () => {
    const { briefCompletion } = await import('../src/lib/brief.js');
    expect(briefCompletion(['gift_list'], { gift_list: { mode: 'cash', interacEmail: 'g@example.test' } } as any).missing).toEqual([]);
    expect(briefCompletion(['gift_list'], { gift_list: { mode: 'cash', note: 'Thanks' } } as any).missing).toEqual(['gift_list']);
  });

  it('registry: at least one https registry link, else 422 pointing at the registry list', async () => {
    const { put } = await setup();
    const none = await put({ mode: 'registry', note: 'Optional words' });
    expect(none.statusCode).toBe(422);
    expect(none.json().error).toMatchObject({ code: 'GIFT_REGISTRY_URL_REQUIRED', fields: { 'content.en.sections.gift_list.registries': expect.any(String) } });
    expect((await put({ mode: 'registry', registries: [] })).statusCode).toBe(422);
    expect((await put({ mode: 'registry', registries: [{ url: 'http://example.com/list' }] })).statusCode).toBe(400); // https only
    expect((await put({ mode: 'registry', registries: [{ name: 'Hudson\'s Bay', url: 'https://example.com/list' }] })).statusCode).toBe(200);
    expect((await put({ mode: 'registry', registryUrl: 'https://example.com/single' })).statusCode).toBe(200);
    // both = cash rules (message, payout) + registry link.
    const reg = { registries: [{ url: 'https://example.com/list' }] };
    const noLink = await put({ mode: 'both', note: 'Thanks', interacEmail: 'g@example.test' });
    expect(noLink.statusCode).toBe(422);
    expect(noLink.json().error.fields).toHaveProperty(['content.en.sections.gift_list.registries']);
    expect((await put({ mode: 'both', ...reg, interacEmail: 'g@example.test' })).statusCode).toBe(200); // note optional
    expect((await put({ mode: 'both', note: 'Thanks', ...reg })).json().error.code).toBe('GIFT_PAYOUT_REQUIRED');
    expect((await put({ mode: 'both', note: 'Thanks', interacEmail: 'g@example.test', ...reg })).statusCode).toBe(200);
  });

  it('the public page returns only the display fields', async () => {
    const { client, event, put } = await setup();
    expect((await put({ heading: 'Gifts', mode: 'both', note: 'Your presence is the gift.', interacEmail: 'Gifts@Example.test', registries: [{ name: 'Store', url: 'https://example.com/list' }], bank: { holder: 'A B', institutionNumber: '003', transitNumber: '12345', accountNumber: '1234567' } })).statusCode).toBe(200);
    await paySelfServe(client, event.id);
    expect((await client.post(`/api/events/${event.id}/invitation/publish`)).statusCode).toBe(200);
    // Legacy junk stored before the rules (never shown to guests).
    const inv = await prisma.invitation.findFirstOrThrow({ where: { eventId: event.id } });
    const v = await prisma.invitationVersion.findFirstOrThrow({ where: { invitationId: inv.id, version: inv.publishedVersion! } });
    const content = v.content as any;
    content.en.sections.gift_list.amount = 5000;
    content.en.sections.gift_list.bank.secret = 'x';
    await prisma.invitationVersion.update({ where: { id: v.id }, data: { content } });
    const gift = (await new Client(app).get(`/api/public/invitations/${inv.slug}`)).json().content.sections.gift_list;
    expect(gift).toEqual({
      heading: 'Gifts',
      mode: 'both',
      note: 'Your presence is the gift.',
      interacEmail: 'Gifts@Example.test', // stored as entered (content is validated, not rewritten)
      registries: [{ name: 'Store', url: 'https://example.com/list' }],
      bank: { holder: 'A B', institutionNumber: '003', transitNumber: '12345', accountNumber: '1234567' },
    });
  });
});

describe('QA round 3', () => {
  it('N-28: add-ons checkout with too few extra_language units for the languages → 422 with details.missing; nothing saved or charged', async () => {
    const five = ['en', 'fr', 'es', 'de', 'it'];
    const { client, event } = await hostWithEvent(app, { languages: five }); // diy cap 2 → 3 units auto-selected
    expect((await client.get(`/api/events/${event.id}`)).json().selectedExtras).toEqual(['extra_language', 'extra_language', 'extra_language']);
    await paySelfServe(client, event.id, [{ code: 'extra_language', qty: 3 }]);
    expect((await client.get(`/api/events/${event.id}`)).json()).toMatchObject({ paid: true, maxLanguages: 5 });
    const eight = [...five, 'pt', 'nl', 'pl'];
    const orders = () => prisma.order.count({ where: { eventId: event.id } });
    const before = await orders();
    for (const path of ['/api/checkout/addons/quote', '/api/checkout/addons']) {
      const res = await client.post(path, { eventId: event.id, extras: ['extra_language'], languages: eight, consents: CONSENTS });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toMatchObject({ code: 'INVALID_SELECTION', fields: { 'extras.extra_language': 'Required' }, details: { missing: [{ code: 'extra_language', qty: 2 }] } });
    }
    expect(await orders()).toBe(before);
    expect((await client.get(`/api/events/${event.id}`)).json().languages).toEqual(five);
    // 3 units cover the 8 languages; the list is applied only after payment.
    const s = await client.post('/api/checkout/addons', { eventId: event.id, extras: [{ code: 'extra_language', qty: 3 }], languages: eight, consents: CONSENTS });
    expect(s.statusCode).toBe(200);
    expect(s.json().subtotalCents).toBe(6000);
    expect((await client.get(`/api/events/${event.id}`)).json().languages).toEqual(five);
    await mockCheckout(app, s.json().sessionId, 'complete', { redirect: false });
    expect((await client.get(`/api/events/${event.id}`)).json()).toMatchObject({ languages: eight, maxLanguages: 8 });
  });

  it('pay-to-publish short of units uses the same 422 shape (fields + details.missing)', async () => {
    const { client, event } = await hostWithEvent(app, { languages: ['en', 'fr', 'es', 'de'] });
    const res = await client.post('/api/checkout/session', { plan: 'diy', eventId: event.id, extras: ['extra_language'], info: { email: 'x@example.test' }, consents: CONSENTS });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'INVALID_SELECTION', fields: { 'extras.extra_language': 'Required' }, details: { missing: [{ code: 'extra_language', qty: 1 }] } });
  });

  it('admin languages: plan cap + units (max 8), not a flat 3; Couture admin with 5; over the cap after payment → 402', async () => {
    const make = (plan: string, languages: string[], extra: Record<string, unknown> = {}) =>
      admin.post('/api/admin/events', { email: uniqueEmail('adm'), plan, hostNames: { partner1: 'A', partner2: 'B' }, themeKey: plan === 'premium' ? undefined : 'harbour', languages, sendAccessEmail: false, ...extra });
    const five = ['en', 'fr', 'es', 'de', 'it'];
    const couture = await make('premium', five);
    expect(couture.statusCode).toBe(201);
    expect(couture.json().languages).toEqual(five);
    const id = couture.json().id;
    const six = await admin.patch(`/api/admin/events/${id}`, { languages: [...five, 'nl'] });
    expect(six.statusCode).toBe(402);
    expect(six.json().error).toMatchObject({ code: 'ADDON_PAYMENT_REQUIRED', details: { missing: [{ code: 'extra_language', qty: 1 }] } });
    expect((await admin.patch(`/api/admin/events/${id}`, { languages: ['en', 'fr', 'es'] })).statusCode).toBe(200);
    expect((await admin.patch(`/api/admin/events/${id}`, { languages: ['en', 'klingon'] })).statusCode).toBe(422);
    expect((await make('premium', [...five, 'pt', 'nl', 'pl', 'ja'])).statusCode).toBe(422); // > 8
    // Signature: 4 languages records the needed unit; unpaid manual orders keep it in selectedExtras.
    const sig = await make('experience', ['en', 'fr', 'es', 'de'], { markPaid: false });
    expect(sig.statusCode).toBe(201);
    expect(sig.json().selectedExtras).toEqual(['extra_language']);
  });
});

describe('manual admin orders', () => {
  const sale = (c: Client, body: Record<string, unknown>) =>
    c.post('/api/admin/events', { email: uniqueEmail('manual'), plan: 'premium', hostNames: { partner1: 'A', partner2: 'B' }, sendAccessEmail: false, ...body });
  const five = ['en', 'fr', 'es', 'de', 'it'];

  it('creates a real paid manual order (admin, server price, extra_language line) and its units raise the language cap', async () => {
    const adminUser = await prisma.user.findFirstOrThrow({ where: { role: 'admin' }, orderBy: { createdAt: 'desc' } });
    const res = await sale(admin, { languages: [...five, 'pt'], extras: ['extra_language'] });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    const order = await prisma.order.findFirstOrThrow({ where: { eventId: id }, include: { items: true } });
    expect(order).toMatchObject({ status: 'paid', paymentProvider: 'manual', planCode: 'premium', kind: 'plan' });
    expect(order.createdByAdminId).toBeTruthy();
    expect(await prisma.user.findUnique({ where: { id: order.createdByAdminId! } })).toMatchObject({ role: 'admin' });
    expect(order.paidAt).toBeTruthy();
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'premium' } });
    expect(order.items.map((i) => [i.kind, i.code, i.qty])).toEqual([['plan', 'premium', 1], ['extra', 'extra_language', 1]]);
    expect(order.totalCents).toBe(plan.basePriceCents + 2000);
    // Audit entry by the admin.
    const audit = await prisma.activityLog.findFirst({ where: { eventId: id, action: 'order.manual_created' } });
    expect(audit).toMatchObject({ actorType: 'admin', data: expect.objectContaining({ orderId: order.id }) });
    expect(adminUser).toBeTruthy();
    // The unit counts as purchased: 6 languages fit (5 + 1), a 7th needs another unit.
    expect((await admin.get(`/api/events/${id}`)).json()).toMatchObject({ maxLanguages: 6, purchasedExtras: expect.arrayContaining(['extra_language']) });
    const six = await admin.patch(`/api/admin/events/${id}`, { languages: [...five, 'pt'] });
    expect(six.statusCode).toBe(200);
    expect(six.json().languages).toHaveLength(6);
    expect((await admin.patch(`/api/admin/events/${id}`, { languages: [...five, 'pt', 'nl'] })).statusCode).toBe(402);
    // Admin orders list shows the source.
    const list = (await admin.get(`/api/admin/orders?q=${order.number}`)).json().items;
    expect(list[0]).toMatchObject({ number: order.number, source: 'manual', createdByAdminId: order.createdByAdminId });
  });

  it('markPaid:false creates no order; non-admins cannot create manual orders', async () => {
    const unpaid = await sale(admin, { languages: ['en'], markPaid: false });
    expect(unpaid.statusCode).toBe(201);
    expect(await prisma.order.count({ where: { eventId: unpaid.json().id } })).toBe(0);
    const staff = await login(app, (await createUser({ role: 'staff' })).email);
    const host = await login(app, (await createUser({ role: 'host' })).email);
    const before = await prisma.order.count({ where: { paymentProvider: 'manual' } });
    expect((await sale(staff, { languages: ['en'] })).statusCode).toBe(403);
    expect((await sale(host, { languages: ['en'] })).statusCode).toBe(403);
    expect(await prisma.order.count({ where: { paymentProvider: 'manual' } })).toBe(before);
  });

  it('refunding a manual plan order follows the normal rules (event unpaid, invitation archived, units revoked)', async () => {
    const res = await sale(admin, { languages: [...five, 'pt'], extras: ['extra_language'] });
    const id = res.json().id;
    const order = await prisma.order.findFirstOrThrow({ where: { eventId: id, paymentProvider: 'manual' } });
    await refundOrder(order);
    const ev = await prisma.event.findUniqueOrThrow({ where: { id }, include: { invitations: true } });
    expect(ev.paidAt).toBeNull();
    expect(ev.invitations.every((i) => i.status === 'archived')).toBe(true);
    expect((await admin.get(`/api/events/${id}`)).json().maxLanguages).toBe(5);
  });
});

describe('admin create auto-adds extra_language units to the manual order', () => {
  it.each([
    ['premium', ['en', 'fr', 'es', 'de', 'it', 'pt']],
    ['experience', ['en', 'fr', 'es', 'de']],
  ])('%s with %j and no units → order has extra_language x1 at server price; event within its cap', async (plan, languages) => {
    const res = await admin.post('/api/admin/events', { email: uniqueEmail('auto'), plan, hostNames: { partner1: 'A', partner2: 'B' }, languages, sendAccessEmail: false });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    const order = await prisma.order.findFirstOrThrow({ where: { eventId: id, paymentProvider: 'manual' }, include: { items: true } });
    const p = await prisma.plan.findUniqueOrThrow({ where: { code: plan as any } });
    const xl = await prisma.extra.findUniqueOrThrow({ where: { code: 'extra_language' } });
    expect(order.items.find((i) => i.code === 'extra_language')).toMatchObject({ kind: 'extra', qty: 1, unitPriceCents: xl.priceCents });
    expect(order.totalCents).toBe(p.basePriceCents + xl.priceCents!);
    const ev = (await admin.get(`/api/events/${id}`)).json();
    expect(ev.languages).toEqual(languages);
    expect(ev.maxLanguages).toBe(languages.length);
  });
});

describe('POST /api/admin/orders/:orderId/refund (manual orders only)', () => {
  const sale = async (body: Record<string, unknown> = {}) => {
    const res = await admin.post('/api/admin/events', { email: uniqueEmail('refund'), plan: 'premium', hostNames: { partner1: 'A', partner2: 'B' }, languages: ['en'], sendAccessEmail: false, ...body });
    const order = await prisma.order.findFirstOrThrow({ where: { eventId: res.json().id, paymentProvider: 'manual' } });
    return { eventId: res.json().id as string, order };
  };

  it('plan order: refunded, event unpaid, invitation archived, units revoked, audit entry with admin + reason; second call 409', async () => {
    const { eventId, order } = await sale({ languages: ['en', 'fr', 'es', 'de', 'it', 'pt'] });
    expect((await admin.post(`/api/admin/orders/${order.id}/refund`, {})).statusCode).toBe(400); // reason required
    expect((await admin.post(`/api/admin/orders/${order.id}/refund`, { reason: 'x'.repeat(501) })).statusCode).toBe(400);
    const res = await admin.post(`/api/admin/orders/${order.id}/refund`, { reason: 'Customer cancelled by phone' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: order.id, status: 'refunded', source: 'manual', kind: 'plan' });
    const ev = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: { invitations: true } });
    expect(ev.paidAt).toBeNull();
    expect(ev.invitations.every((i) => i.status === 'archived')).toBe(true);
    expect((await admin.get(`/api/events/${eventId}`)).json().purchasedExtras ?? []).not.toContain('extra_language');
    const audit = await prisma.activityLog.findFirstOrThrow({ where: { eventId, action: 'order.manual_refunded' } });
    expect(audit.actorType).toBe('admin');
    expect(audit.actorId).toBeTruthy();
    expect(audit.data).toMatchObject({ orderId: order.id, reason: 'Customer cancelled by phone' });
    const again = await admin.post(`/api/admin/orders/${order.id}/refund`, { reason: 'again' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('CONFLICT');
  });

  it('add-ons order: only its add-ons are revoked; the invitation stays live', async () => {
    const { eventId } = await sale({ languages: ['en'] });
    await prisma.invitation.updateMany({ where: { eventId }, data: { status: 'published', publishedAt: new Date() } });
    const addon = await prisma.order.create({
      data: { number: `ORD-T-${randomUUID().slice(0, 8)}`, kind: 'addons', email: 'a@example.test', eventId, sections: [], extras: ['extra_language'], languages: [], buyerInfo: {}, subtotalCents: 2000, totalCents: 2000, status: 'paid', paidAt: new Date(), paymentProvider: 'manual', consentTermsAt: new Date(), consentPrivacyAt: new Date() },
    });
    expect((await admin.get(`/api/events/${eventId}`)).json().maxLanguages).toBe(6);
    const res = await admin.post(`/api/admin/orders/${addon.id}/refund`, { reason: 'Wrong add-on' });
    expect(res.statusCode).toBe(200);
    const ev = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: { invitations: true } });
    expect(ev.paidAt).not.toBeNull();
    expect(ev.invitations[0]!.status).toBe('published');
    expect((await admin.get(`/api/events/${eventId}`)).json().maxLanguages).toBe(5);
  });

  it('checkout (Stripe/mock) orders → 409; staff and hosts → 403; CSRF required', async () => {
    const { client, event } = await hostWithEvent(app, {});
    await paySelfServe(client, event.id);
    const checkoutOrder = await prisma.order.findFirstOrThrow({ where: { eventId: event.id, status: 'paid' } });
    const res = await admin.post(`/api/admin/orders/${checkoutOrder.id}/refund`, { reason: 'test' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: checkoutOrder.id } })).status).toBe('paid');
    const { order } = await sale();
    const staff = await login(app, (await createUser({ role: 'staff' })).email);
    expect((await staff.post(`/api/admin/orders/${order.id}/refund`, { reason: 'x' })).statusCode).toBe(403);
    expect((await client.post(`/api/admin/orders/${order.id}/refund`, { reason: 'x' })).statusCode).toBe(403);
    const noCsrf = await admin.req('POST', `/api/admin/orders/${order.id}/refund`, { reason: 'x' }, {}, { csrf: false });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().error.code).toBe('CSRF_FAILED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('paid');
  });
});

describe('N-31: admin manual orders trim extra_language to what the languages need; extras accept {code, qty}', () => {
  const make = (body: Record<string, unknown>) =>
    admin.post('/api/admin/events', { email: uniqueEmail('n31'), plan: 'experience', themeKey: 'harbour', hostNames: { partner1: 'A', partner2: 'B' }, sendAccessEmail: false, ...body });
  const units = async (eventId: string) => (await prisma.order.findFirstOrThrow({ where: { eventId, paymentProvider: 'manual' }, include: { items: true } }));

  it('Signature + 4 languages + 3 units typed → order has x1, charged CA$20', async () => {
    const res = await make({ languages: ['en', 'fr', 'es', 'de'], extras: ['extra_language', 'extra_language', 'extra_language'] });
    expect(res.statusCode).toBe(201);
    const order = await units(res.json().id);
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'experience' } });
    expect(order.items.filter((i) => i.code === 'extra_language')).toEqual([expect.objectContaining({ qty: 1, unitPriceCents: 2000 })]);
    expect(order.totalCents).toBe(plan.basePriceCents + 2000);
    expect((await admin.get(`/api/events/${res.json().id}`)).json().maxLanguages).toBe(4);
  });

  it('Signature + 1 language + 2 units typed → no extra_language line at all', async () => {
    const res = await make({ languages: ['en'], extras: ['extra_language', 'extra_language'] });
    expect(res.statusCode).toBe(201);
    const order = await units(res.json().id);
    expect(order.items.some((i) => i.code === 'extra_language')).toBe(false);
    expect(order.extras).not.toContain('extra_language');
  });

  it('refund of an unknown order → 404 "Order not found." (not doubled)', async () => {
    const res = await admin.post(`/api/admin/orders/${randomUUID()}/refund`, { reason: 'x' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: 'NOT_FOUND', message: 'Order not found.' });
  });

  it('extras accept {code, qty} objects (trimmed the same way) and mixed codes', async () => {
    const res = await make({ languages: ['en', 'fr', 'es', 'de', 'it'], extras: [{ code: 'extra_language', qty: 5 }, 'custom_link'] });
    expect(res.statusCode).toBe(201);
    const order = await units(res.json().id);
    expect(order.items.filter((i) => i.kind === 'extra').map((i) => [i.code, i.qty]).sort()).toEqual([['custom_link', 1], ['extra_language', 2]]);
    expect((await make({ languages: ['en'], extras: [{ code: 'extra_language', qty: 0 }] })).statusCode).toBe(400);
    expect((await make({ languages: ['en'], extras: [{ code: 'nope', qty: 1 }] })).statusCode).toBe(422);
  });
});

describe('N-32: quote / pay-to-publish checkout fall back to the event saved theme', () => {
  it('quote and checkout without themeKey use the invitation theme; explicit themeKey still wins and is validated', async () => {
    const { client, event } = await hostWithEvent(app, {});
    const inv = await prisma.invitation.findFirstOrThrow({ where: { eventId: event.id }, include: { theme: true } });
    expect(inv.theme).toBeTruthy();
    const q = await client.post('/api/checkout/quote', { plan: 'diy', eventId: event.id });
    expect(q.statusCode).toBe(200);
    expect(q.json().theme?.key ?? q.json().themeKey).toBe(inv.theme!.key);
    expect((await client.post('/api/checkout/quote', { plan: 'diy', eventId: event.id, themeKey: 'no-such-theme' })).statusCode).toBe(422);
    // Without eventId (and no theme) the old rule stands.
    const none = await client.post('/api/checkout/quote', { plan: 'diy' });
    expect(none.statusCode).toBe(422);
    expect(none.json().error.fields).toMatchObject({ themeKey: 'Required' });
    // Another user's event can't be quoted.
    const other = await hostWithEvent(app, {});
    expect((await other.client.post('/api/checkout/quote', { plan: 'diy', eventId: event.id })).statusCode).toBe(404); // non-members don't learn the event exists
    const s = await client.post('/api/checkout/session', { plan: 'diy', eventId: event.id, info: { email: 'x@example.test' }, consents: CONSENTS });
    expect(s.statusCode).toBe(200);
    expect(s.json().sessionId).toBeTruthy();
  });

  it('event with no saved theme and no themeKey → 422 "Please choose a design"', async () => {
    const { client, event } = await hostWithEvent(app, {});
    await prisma.invitation.updateMany({ where: { eventId: event.id }, data: { themeId: null } });
    for (const res of [
      await client.post('/api/checkout/quote', { plan: 'diy', eventId: event.id }),
      await client.post('/api/checkout/session', { plan: 'diy', eventId: event.id, info: { email: 'x@example.test' }, consents: CONSENTS }),
    ]) {
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toMatchObject({ code: 'INVALID_SELECTION', fields: { themeKey: 'Required' } });
    }
  });
});

describe('N-39: invitation GET returns previous links and customLinkLocked', () => {
  it('previousSlugs [{oldSlug, createdAt}] newest first; customLinkLocked after a rename; studio GET too; viewers get neither', async () => {
    const { client, event } = await hostWithEvent(app, {});
    const fresh = (await client.get(`/api/events/${event.id}/invitation`)).json();
    expect(fresh).toMatchObject({ previousSlugs: [], customLinkLocked: false });
    const first = fresh.slug;
    const n = randomUUID().slice(0, 6);
    for (const slug of [`n39-a-${n}`, `n39-b-${n}`]) expect((await admin.patch(`/api/events/${event.id}/invitation/slug`, { slug })).statusCode).toBe(200);
    const got = (await client.get(`/api/events/${event.id}/invitation`)).json();
    expect(got.slug).toBe(`n39-b-${n}`);
    expect(got.customLinkLocked).toBe(true);
    expect(got.previousSlugs.map((p: any) => p.oldSlug)).toEqual([`n39-a-${n}`, first]);
    expect(Number.isNaN(Date.parse(got.previousSlugs[0].createdAt))).toBe(false);
    const studio = (await admin.get(`/api/admin/invitations/${got.id}`)).json();
    expect(studio).toMatchObject({ customLinkLocked: true, previousSlugs: got.previousSlugs });
    // A viewer can read the invitation but not the link history.
    const viewer = await createUser({ role: 'host' });
    await prisma.eventMember.create({ data: { eventId: event.id, userId: viewer.id, role: 'viewer' } });
    const v = (await (await login(app, viewer.email)).get(`/api/events/${event.id}/invitation`)).json();
    expect(v.previousSlugs).toBeUndefined();
    expect(v.customLinkLocked).toBeUndefined();
  });

  it('customLinkLocked is true once custom_link is paid, even before any rename', async () => {
    const { client, event } = await hostWithEvent(app, {});
    await paySelfServe(client, event.id, ['custom_link']);
    expect((await client.get(`/api/events/${event.id}/invitation`)).json()).toMatchObject({ previousSlugs: [], customLinkLocked: true });
  });
});

describe('N-40: reply rate counts invited guests only', () => {
  it('8 invited, 4 replied, 3 general-link replies → 50%, waiting 4; campaign "not responded" matches', async () => {
    const { client, event } = await hostWithEvent(app, {});
    const invitees = await Promise.all(
      Array.from({ length: 8 }, (_, i) => prisma.invitee.create({ data: { eventId: event.id, firstName: `G${i}`, email: `g${i}-${randomUUID().slice(0, 6)}@example.test`, token: randomUUID().replace(/-/g, ''), status: 'sent' } })),
    );
    for (const [i, att] of (['yes', 'no', 'yes', 'yes'] as const).entries()) {
      await prisma.guest.create({ data: { eventId: event.id, inviteeId: invitees[i]!.id, fullName: `G${i}`, attendance: att } });
    }
    // A manual "pending" entry for an invitee is not a response.
    await prisma.guest.create({ data: { eventId: event.id, inviteeId: invitees[5]!.id, fullName: 'G5', attendance: 'pending', source: 'manual' } });
    for (let i = 0; i < 3; i++) await prisma.guest.create({ data: { eventId: event.id, fullName: `Walk-in ${i}`, attendance: i ? 'yes' : 'no' } });
    const s = (await client.get(`/api/events/${event.id}/stats`)).json();
    expect(s).toMatchObject({ invited: 8, replied: 4, waiting: 4, awaiting: 4, generalLinkReplies: 3, responseRate: 0.5, responses: 7 });
    expect(s.replied + s.waiting).toBe(s.invited);
    const { segmentInvitees } = await import('../src/services/campaigns.js');
    expect((await segmentInvitees(event.id, { notResponded: true }, 'email')).length).toBe(4);
  });

  it('no guest list → responseRate null, waiting 0 (general-link replies still reported)', async () => {
    const { client, event } = await hostWithEvent(app, {});
    await prisma.guest.create({ data: { eventId: event.id, fullName: 'Walk-in', attendance: 'yes' } });
    expect((await client.get(`/api/events/${event.id}/stats`)).json()).toMatchObject({ invited: 0, replied: 0, waiting: 0, generalLinkReplies: 1, responseRate: null });
  });
});

describe('checkout create responses list what is charged (same shape as the quote)', () => {
  it('plan checkout: extras/lines/subtotalCents/currency after server trimming match the quote', async () => {
    const { client, event } = await hostWithEvent(app, { languages: ['en', 'fr', 'es'] }); // diy cap 2 → needs 1 unit
    const body = { plan: 'diy', eventId: event.id, extras: [{ code: 'extra_language', qty: 3 }] };
    const q = (await client.post('/api/checkout/quote', body)).json();
    const s = (await client.post('/api/checkout/session', { ...body, info: { email: 'x@example.test' }, consents: CONSENTS })).json();
    expect(q.lines.find((l: any) => l.code === 'extra_language')).toMatchObject({ qty: 1, unitPriceCents: 2000, totalCents: 2000 });
    for (const k of ['extras', 'lines', 'subtotalCents', 'currency']) expect(s[k]).toEqual(q[k]);
    expect(s.subtotalCents).toBe(s.lines.reduce((t: number, l: any) => t + l.totalCents, 0));
  });

  it('add-ons checkout returns its lines too, also on an idempotent retry', async () => {
    const { client, event } = await hostWithEvent(app, {});
    await paySelfServe(client, event.id);
    const body = { eventId: event.id, extras: ['custom_link'], consents: CONSENTS };
    const a = (await client.post('/api/checkout/addons', body, { 'idempotency-key': 'k1' })).json();
    expect(a).toMatchObject({ extras: ['custom_link'], lines: [expect.objectContaining({ code: 'custom_link', qty: 1, unitPriceCents: 1900, totalCents: 1900 })], subtotalCents: 1900, currency: 'CAD' });
    const again = (await client.post('/api/checkout/addons', body, { 'idempotency-key': 'k1' })).json();
    expect(again.sessionId).toBe(a.sessionId);
    expect(again.lines).toEqual(a.lines);
  });
});
