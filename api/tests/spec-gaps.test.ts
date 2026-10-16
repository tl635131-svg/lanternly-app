import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { refundOrder } from '../src/services/orders.js';
import { InvitationConfigSchema } from '../src/lib/theme-engine.js';
import { Client, clearDevOutbox, createUser, hostWithEvent, login, makeApp, mockCheckout, prisma, publishEvent, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
let admin: Client;
beforeAll(async () => {
  app = await makeApp();
  admin = await login(app, (await createUser({ role: 'admin' })).email);
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => clearDevOutbox());

const CONSENTS = { terms: true, privacy: true };

/** Multipart body with optional text fields sent before the file. */
function multipart(file: { name: string; type: string; data: Buffer }, fields: Record<string, string> = {}) {
  const boundary = `----spec${randomUUID().slice(0, 8)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(2048, 1)]);

/** Pay for a self-serve event through the mock checkout (pay to publish). */
async function paySelfServe(client: Client, eventId: string, extras?: string[]) {
  const s = await client.post('/api/checkout/session', { plan: 'diy', eventId, ...(extras ? { extras } : {}), info: { email: 'ignored@example.test' }, consents: CONSENTS });
  if (s.statusCode !== 200) throw new Error(s.body);
  const done = await mockCheckout(app, s.json().sessionId, 'complete', { redirect: false });
  if (done.statusCode !== 200) throw new Error(done.body);
  return s.json();
}

describe('admin themes: products[] only', () => {
  it('creates and patches with products[]; a single "product" is rejected; DTOs carry products[] only', async () => {
    const key = `spec-${randomUUID().slice(0, 6)}`;
    const old = await admin.post('/api/admin/themes', { key, name: { en: 'Spec' }, product: 'birthday' });
    expect(old.statusCode).toBe(400);
    expect(old.json().error.fields).toHaveProperty('product');
    const created = await admin.post('/api/admin/themes', { key, name: { en: 'Spec' }, products: ['birthday', 'bridesmaid'], status: 'coming_soon' });
    expect(created.statusCode).toBe(201);
    expect(created.json().products).toEqual(['birthday', 'bridesmaid']);
    expect(created.json()).not.toHaveProperty('product');
    expect((await admin.post('/api/admin/themes', { key: `${key}-x`, name: { en: 'X' }, products: [] })).statusCode).toBe(400);
    const patched = await admin.patch(`/api/admin/themes/${created.json().id}`, { products: ['wedding_invite'] });
    expect(patched.json().products).toEqual(['wedding_invite']);
    expect((await admin.patch(`/api/admin/themes/${created.json().id}`, { product: null })).statusCode).toBe(400);
    const wedding = (await new Client(app).get('/api/public/themes?product=wedding_invite')).json().items.map((t: any) => t.key);
    const birthday = (await new Client(app).get('/api/public/themes?product=birthday')).json().items.map((t: any) => t.key);
    expect(wedding).toContain(key);
    expect(birthday).not.toContain(key);
    await admin.del(`/api/admin/themes/${created.json().id}`);
  });
});

describe('admin reviews: no rating, isSample supported', () => {
  it('rejects rating with a clear error and stores isSample', async () => {
    const bad = await admin.post('/api/admin/reviews', { displayName: 'R', text: 'Lovely', rating: 5 });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toMatch(/no rating/i);
    const ok = await admin.post('/api/admin/reviews', { displayName: 'Sam', text: 'Lovely', isSample: true });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().isSample).toBe(true);
    expect(ok.json()).not.toHaveProperty('rating');
    const patched = await admin.patch(`/api/admin/reviews/${ok.json().id}`, { isSample: false, displayName: 'Sam K.' });
    expect(patched.json()).toMatchObject({ isSample: false, displayName: 'Sam K.' });
    expect((await admin.patch(`/api/admin/reviews/${ok.json().id}`, { rating: 3 })).statusCode).toBe(400);
    await prisma.review.delete({ where: { id: ok.json().id } });
  });
});

describe('cover types', () => {
  it('only glow, photo and none are accepted', () => {
    for (const type of ['glow', 'photo', 'none']) expect(InvitationConfigSchema.safeParse({ cover: { type } }).success).toBe(true);
    for (const type of ['illustration', 'video', 'envelope']) expect(InvitationConfigSchema.safeParse({ cover: { type } }).success).toBe(false);
  });
});

describe('self-serve add-ons and language limits', () => {
  it('an unpaid draft over the diy cap auto-selects extra_language × n; 422 only for an unsupported code or > 8 languages', async () => {
    const u = await createUser();
    const c = await login(app, u.email);
    const three = { hostNames: { partner1: 'A', partner2: 'B' }, languages: ['en', 'fr', 'es'] };
    expect((await c.post('/api/events', { ...three, extras: ['reminder_pack'] })).statusCode).toBe(422);
    expect((await c.post('/api/events', { ...three, extras: ['custom_monogram'] })).statusCode).toBe(422); // not a diy add-on
    expect((await c.post('/api/events', { ...three, languages: ['en', 'klingon'] })).statusCode).toBe(422);
    expect((await c.post('/api/events', { ...three, languages: ['en', 'fr', 'es', 'de', 'it', 'pt', 'nl', 'pl', 'ja'] })).statusCode).toBe(422);
    const auto = await c.post('/api/events', three);
    expect(auto.statusCode).toBe(201);
    expect(auto.json().selectedExtras).toEqual(['extra_language']);
    const ok = await c.post('/api/events', { ...three, extras: ['extra_language', 'own_song'] });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().selectedExtras).toEqual(['extra_language', 'own_song']); // already enough units: nothing added
    const id = ok.json().id;
    const four = await c.patch(`/api/events/${id}`, { languages: ['en', 'fr', 'es', 'de'] });
    expect(four.statusCode).toBe(200);
    expect(four.json().selectedExtras).toEqual(['extra_language', 'own_song', 'extra_language']);
    const ev = (await c.get(`/api/events/${id}`)).json();
    expect(ev).toMatchObject({ maxLanguages: 4, purchasedExtras: [] });
    // Unselecting the extra languages while 4 languages are set re-adds the units needed.
    const unselect = await c.patch(`/api/events/${id}`, { selectedExtras: [] });
    expect(unselect.statusCode).toBe(200);
    expect(unselect.json().selectedExtras).toEqual(['extra_language', 'extra_language']);
    expect((await c.patch(`/api/events/${id}`, { languages: ['en', 'xx-bad'] })).statusCode).toBe(422);
    // Shrinking the languages removes units no longer needed; extra units sent with extras are trimmed too.
    expect((await c.patch(`/api/events/${id}`, { languages: ['en', 'fr', 'es'] })).json().selectedExtras).toEqual(['extra_language']);
    expect((await c.patch(`/api/events/${id}`, { languages: ['en'] })).json().selectedExtras).toEqual([]);
    expect((await c.post('/api/events', { ...three, extras: [{ code: 'extra_language', qty: 4 }] })).json().selectedExtras).toEqual(['extra_language']);
    // Plan checkout quietly trims excess units (quote shows the trimmed qty).
    const q = await c.post('/api/checkout/quote', { plan: 'experience', themeKey: 'evening', languages: ['en', 'fr', 'es', 'de'], extras: [{ code: 'extra_language', qty: 5 }] });
    expect(q.json().lines.find((l: any) => l.code === 'extra_language')).toMatchObject({ qty: 1, totalCents: 2000 });
    const none = await c.post('/api/checkout/quote', { plan: 'experience', themeKey: 'evening', languages: ['en'], extras: ['extra_language'] });
    expect(none.json().lines.find((l: any) => l.code === 'extra_language')).toBeUndefined();
  });

  it('pay to publish charges the selected add-ons by default; used add-ons are required; selection then becomes purchased', async () => {
    const { client, event } = await hostWithEvent(app, { languages: ['en', 'fr', 'es'], extras: ['extra_language'] });
    // Using a custom song before paying adds own_song to the selection.
    const link = 'https://example.com/our-song.mp3';
    expect((await client.put(`/api/events/${event.id}/invitation`, { config: { music: { externalUrl: link } } })).json().error.code).toBe('RIGHTS_CONFIRMATION_REQUIRED');
    expect((await client.put(`/api/events/${event.id}/invitation`, { config: { music: { externalUrl: link } }, musicRightsConfirmed: true })).statusCode).toBe(200);
    expect((await client.get(`/api/events/${event.id}`)).json().selectedExtras).toEqual(['extra_language', 'own_song']);
    // Explicitly dropping a used add-on is refused.
    const missing = await client.post('/api/checkout/session', { plan: 'diy', eventId: event.id, extras: ['extra_language'], info: { email: 'x@example.test' }, consents: CONSENTS });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error.fields).toHaveProperty(['extras.own_song']);
    const s = await paySelfServe(client, event.id);
    expect(s.subtotalCents).toBe(9900 + 2000 + 1500);
    const order = await prisma.order.findFirstOrThrow({ where: { checkoutSessionId: s.sessionId }, include: { items: true } });
    expect(order.items.map((i) => i.code).sort()).toEqual(['diy', 'extra_language', 'own_song']);
    const ev = (await client.get(`/api/events/${event.id}`)).json();
    expect(ev).toMatchObject({ paid: true, selectedExtras: [], maxLanguages: 3 });
    expect(ev.purchasedExtras.sort()).toEqual(['extra_language', 'own_song']);
    expect((await client.patch(`/api/events/${event.id}`, { selectedExtras: ['custom_link'] })).statusCode).toBe(409);
  });
});

describe('draft vs live (published invitations)', () => {
  it('edits go to the draft; the live page changes only on publish; discard and rollback work on the draft', async () => {
    const { client, event } = await hostWithEvent(app);
    const inv0 = (await client.get(`/api/events/${event.id}/invitation`)).json();
    expect(inv0).toMatchObject({ publishedVersion: null, hasUnpublishedChanges: true });
    const content = (title: string) => ({ en: { hero: { title }, sections: {} } });
    await client.put(`/api/events/${event.id}/invitation`, { content: content('Version one') });
    await prisma.event.update({ where: { id: event.id }, data: { paidAt: new Date() } });
    const pub = await client.post(`/api/events/${event.id}/invitation/publish`);
    expect(pub.json()).toMatchObject({ status: 'published', publishedVersion: 1, hasUnpublishedChanges: false });
    const slug = pub.json().slug;
    const live = async () => (await new Client(app).get(`/api/public/invitations/${slug}`)).json();
    expect((await live()).content.hero.title).toBe('Version one');

    const saved = await client.put(`/api/events/${event.id}/invitation`, { content: content('Draft two'), config: { cover: { type: 'none' } } });
    expect(saved.json()).toMatchObject({ publishedVersion: 1, hasUnpublishedChanges: true });
    expect(saved.json().draftChangedAt).toBeTruthy();
    expect((await live()).content.hero.title).toBe('Version one');
    expect((await live()).config.cover?.type).not.toBe('none');
    const preview = (await new Client(app).get(`/api/public/invitations/${slug}?preview=${saved.json().previewUrl.split('preview=')[1]}`)).json();
    expect(preview.content.hero.title).toBe('Draft two');

    // Event details and RSVP settings apply immediately.
    await client.patch(`/api/events/${event.id}`, { venueName: 'New Hall' });
    expect((await live()).event.venueName).toBe('New Hall');

    // Discard → draft back to the live version.
    const discarded = await client.post(`/api/events/${event.id}/invitation/discard-draft`);
    expect(discarded.json()).toMatchObject({ hasUnpublishedChanges: false });
    expect(discarded.json().content.en.hero.title).toBe('Version one');

    // Publish changes → version 2 live (no payment needed again).
    await client.put(`/api/events/${event.id}/invitation`, { content: content('Version two') });
    await prisma.event.update({ where: { id: event.id }, data: { paidAt: null } });
    const pub2 = await client.post(`/api/events/${event.id}/invitation/publish`);
    expect(pub2.statusCode).toBe(200);
    expect(pub2.json()).toMatchObject({ publishedVersion: 2, version: 2 });
    expect((await live()).content.hero.title).toBe('Version two');

    // Rollback copies v1 into the draft only.
    const rb = await client.post(`/api/events/${event.id}/invitation/rollback`, { version: 1 });
    expect(rb.json()).toMatchObject({ publishedVersion: 2, hasUnpublishedChanges: true });
    expect(rb.json().content.en.hero.title).toBe('Version one');
    expect((await live()).content.hero.title).toBe('Version two');

    // Nothing to discard to before a first publish.
    const fresh = await hostWithEvent(app);
    expect((await fresh.client.post(`/api/events/${fresh.event.id}/invitation/discard-draft`)).statusCode).toBe(409);
  });
});

describe('gift list: Canadian money fields', () => {
  it('validates institution (3), transit (5), account (7–12) and Interac email; IBAN/BIC optional', async () => {
    const { client, event } = await hostWithEvent(app, { sections: ['gift_list'] });
    const put = (gift: unknown) => client.put(`/api/events/${event.id}/invitation`, { content: { en: { sections: { gift_list: gift } } } });
    const ok = await put({ mode: 'cash', interacEmail: 'Gifts@Example.test', bank: { holder: 'A B', bank: 'RBC', institutionNumber: '003', transitNumber: '12345', accountNumber: '1234567' }, note: 'Thank you' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().content.en.sections.gift_list.bank.transitNumber).toBe('12345');
    expect((await put({ bank: { institutionNumber: '03' } })).json().error.fields).toBeTruthy();
    for (const bank of [{ institutionNumber: '03' }, { transitNumber: '1234' }, { accountNumber: '123456' }, { accountNumber: '1234567890123' }, { bic: 'ABC' }]) {
      expect((await put({ bank })).statusCode).toBe(400);
    }
    expect((await put({ interacEmail: 'not-an-email' })).statusCode).toBe(400);
    expect((await put({ bank: { iban: 'GB82 WEST 1234 5698 7654 32', bic: 'NWBKGB2L' } })).statusCode).toBe(200);
  });
});

describe('own song: rights confirmation', () => {
  it('music uploads need the tick; each tick is stored with who/when/ip hash/user agent', async () => {
    const { client, event, user } = await hostWithEvent(app);
    const up = (fields: Record<string, string> = {}) => {
      const m = multipart({ name: 'song.mp3', type: 'audio/mpeg', data: MP3 }, fields);
      return client.req('POST', `/api/events/${event.id}/assets?kind=music`, m.body, { ...m.headers, 'user-agent': 'spec-test' });
    };
    const no = await up();
    expect(no.statusCode).toBe(400);
    expect(no.json().error.code).toBe('RIGHTS_CONFIRMATION_REQUIRED');
    const yes = await up({ rightsConfirmed: 'true' });
    expect(yes.statusCode).toBe(201);
    const row = await prisma.musicRightsConfirmation.findFirstOrThrow({ where: { eventId: event.id, assetId: yes.json().id } });
    expect(row).toMatchObject({ userId: user.id, userAgent: 'spec-test' });
    expect(row.statement).toMatch(/rights to use this music/);
    expect(row.ipHash).toBeTruthy();
    // Using the uploaded song is fine (confirmed at upload); a new link needs a tick.
    expect((await client.put(`/api/events/${event.id}/invitation`, { config: { music: { assetId: yes.json().id } } })).statusCode).toBe(200);
    const link = 'https://example.com/first-dance.mp3';
    expect((await client.post(`/api/events/${event.id}/music-rights`, { url: link, confirmed: false })).json().error.code).toBe('RIGHTS_CONFIRMATION_REQUIRED');
    const tick = await client.post(`/api/events/${event.id}/music-rights`, { url: link, confirmed: true });
    expect(tick.statusCode).toBe(201);
    expect(tick.json()).toMatchObject({ userId: user.id });
    expect((await client.put(`/api/events/${event.id}/invitation`, { config: { music: { externalUrl: link } } })).statusCode).toBe(200);
    const list = (await client.get(`/api/events/${event.id}/music-rights`)).json().items;
    expect(list.length).toBe(2);
    // Library tracks need no confirmation.
    const track = await prisma.musicTrack.findFirstOrThrow({ where: { active: true } });
    expect((await client.put(`/api/events/${event.id}/invitation`, { config: { music: { trackId: track.id, assetId: null, externalUrl: null } } })).statusCode).toBe(200);
  });

  it('studio brief own_song with a link or upload needs rightsConfirmed', async () => {
    const email = uniqueEmail('song');
    const s = (await new Client(app).post('/api/checkout/session', { plan: 'experience', themeKey: 'harbour', extras: ['own_song'], info: { partner1: 'A', partner2: 'B', eventDate: '2027-06-01', email }, consents: CONSENTS })).json();
    const done = (await mockCheckout(app, s.sessionId, 'complete', { redirect: false })).json();
    const url = `/api/admin/events/${done.eventId}/brief`;
    const no = await admin.patch(url, { data: { own_song: { url: 'https://example.com/song.mp3' } } });
    expect(no.statusCode).toBe(400);
    expect(no.json().error.code).toBe('RIGHTS_CONFIRMATION_REQUIRED');
    expect((await admin.patch(url, { data: { own_song: { url: 'https://example.com/song.mp3', rightsConfirmed: true } } })).statusCode).toBe(200);
    expect(await prisma.musicRightsConfirmation.count({ where: { eventId: done.eventId, url: 'https://example.com/song.mp3' } })).toBe(1);
    expect((await admin.patch(url, { data: { own_song: { description: 'Library is fine', libraryTrackId: null } } })).statusCode).toBe(200);
  });
});

describe('custom_link add-on, slug redirects and add-on-only checkout', () => {
  it('auto slugs look like names + 4 chars; renames need custom_link; old slugs keep working (RSVPs forwarded)', async () => {
    const { client, event } = await hostWithEvent(app, { hostNames: { partner1: 'Maya', partner2: 'Theo' } });
    const inv = (await client.get(`/api/events/${event.id}/invitation`)).json();
    expect(inv.slug).toMatch(/^maya-theo-[a-z0-9]{4}$/);
    const mine = `maya-theo-${randomUUID().slice(0, 6)}`;

    // Before paying: choosing a link adds custom_link to the selection.
    expect((await client.patch(`/api/events/${event.id}/invitation/slug`, { slug: 'admin' })).statusCode).toBe(400);
    expect((await client.patch(`/api/events/${event.id}/invitation/slug`, { slug: 'Bad Slug!' })).statusCode).toBe(400);
    expect((await client.patch(`/api/events/${event.id}/invitation/slug`, { slug: 'maya-and-theo' })).statusCode).toBe(409); // seeded demo
    const renamed = await client.patch(`/api/events/${event.id}/invitation/slug`, { slug: mine });
    expect(renamed.statusCode).toBe(200);
    expect((await client.get(`/api/events/${event.id}`)).json().selectedExtras).toContain('custom_link');
    // Paying without it is refused, with it works.
    expect((await client.post('/api/checkout/session', { plan: 'diy', eventId: event.id, extras: [], info: { email: 'x@example.test' }, consents: CONSENTS })).statusCode).toBe(422);
    await paySelfServe(client, event.id);
    await client.post(`/api/events/${event.id}/invitation/publish`);

    // The original auto slug still resolves and accepts RSVPs.
    const viaOld = (await new Client(app).get(`/api/public/invitations/${inv.slug}`)).json();
    expect(viaOld.invitation).toMatchObject({ slug: mine, redirectedFrom: inv.slug });
    const rsvp = await new Client(app).post(`/api/public/invitations/${inv.slug}/rsvps`, { fullName: 'Old Link Guest', attendance: 'no' });
    expect(rsvp.statusCode).toBe(201);
    expect(await prisma.guest.count({ where: { eventId: event.id, fullName: 'Old Link Guest' } })).toBe(1);
    // Unlimited renames; old slugs can't be taken by anyone else.
    const again = `${mine}-2`;
    expect((await client.patch(`/api/events/${event.id}/invitation/slug`, { slug: again })).statusCode).toBe(200);
    expect((await new Client(app).get(`/api/public/invitations/${mine}`)).json().invitation.slug).toBe(again);
    const other = await hostWithEvent(app);
    await prisma.event.update({ where: { id: other.event.id }, data: { selectedExtras: ['custom_link'] } });
    expect((await other.client.patch(`/api/events/${other.event.id}/invitation/slug`, { slug: inv.slug })).statusCode).toBe(409);
    // Back to a previous slug of the same invitation is allowed.
    expect((await client.patch(`/api/events/${event.id}/invitation/slug`, { slug: mine })).statusCode).toBe(200);
  });

  it('after paying: features need the add-on (402) → add-on-only checkout → refund revokes only that order', async () => {
    const { client, event } = await hostWithEvent(app);
    const unpaid = await client.post('/api/checkout/addons', { eventId: event.id, extras: ['custom_link'], consents: CONSENTS });
    expect(unpaid.statusCode).toBe(409);
    expect(unpaid.json().error.code).toBe('PLAN_NOT_PAID');
    await paySelfServe(client, event.id, []);
    await client.post(`/api/events/${event.id}/invitation/publish`);
    const slug = `late-link-${randomUUID().slice(0, 6)}`;
    const blocked = await client.patch(`/api/events/${event.id}/invitation/slug`, { slug });
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json().error).toMatchObject({ code: 'ADDON_PAYMENT_REQUIRED', details: { addon: 'custom_link', eventId: event.id, checkout: '/api/checkout/addons', missing: [{ code: 'custom_link', qty: 1 }] } });
    const langs = await client.patch(`/api/events/${event.id}`, { languages: ['en', 'fr', 'es'] });
    expect(langs.statusCode).toBe(402);
    expect(langs.json().error).toMatchObject({ code: 'ADDON_PAYMENT_REQUIRED', details: { missing: [{ code: 'extra_language', qty: 1 }] } });

    // Without a target language list the extra language isn't needed yet, so it is trimmed away.
    expect((await client.post('/api/checkout/addons/quote', { eventId: event.id, extras: ['custom_link', 'extra_language'] })).json()).toMatchObject({ extras: ['custom_link'], subtotalCents: 1900 });
    const three = ['en', 'fr', 'es'];
    const q = await client.post('/api/checkout/addons/quote', { eventId: event.id, extras: ['custom_link', { code: 'extra_language', qty: 3 }], languages: three });
    expect(q.json()).toMatchObject({ subtotalCents: 1900 + 2000, currency: 'CAD' }); // 3 units trimmed to the 1 needed
    expect(q.json().lines.find((l: any) => l.code === 'extra_language').qty).toBe(1);
    expect((await client.post('/api/checkout/addons/quote', { eventId: event.id, extras: ['rush_design'] })).statusCode).toBe(422); // not a diy add-on
    const s = await client.post('/api/checkout/addons', { eventId: event.id, extras: ['custom_link', 'extra_language'], languages: three, consents: CONSENTS });
    expect(s.statusCode).toBe(200);
    expect(s.json().url).toContain('/api/dev/mock-checkout/');
    expect((await mockCheckout(app, s.json().sessionId, 'complete', { redirect: false })).json().status).toBe('paid');
    const order = await prisma.order.findFirstOrThrow({ where: { checkoutSessionId: s.json().sessionId } });
    expect(order).toMatchObject({ kind: 'addons', planCode: null, eventId: event.id });
    expect((await client.patch(`/api/events/${event.id}/invitation/slug`, { slug })).statusCode).toBe(200);
    // Paying applied the target list; going back to 2 languages never removes the paid unit.
    expect((await client.get(`/api/events/${event.id}`)).json().languages).toEqual(three);
    expect((await client.patch(`/api/events/${event.id}`, { languages: ['en', 'fr'] })).statusCode).toBe(200);
    expect((await client.get(`/api/events/${event.id}`)).json()).toMatchObject({ purchasedExtras: expect.arrayContaining(['extra_language']), maxLanguages: 3 });
    expect((await client.patch(`/api/events/${event.id}`, { languages: three })).statusCode).toBe(200);
    const owned = await client.post('/api/checkout/addons/quote', { eventId: event.id, extras: ['custom_link'] });
    expect(owned.statusCode).toBe(409); // already owned
    expect(owned.json().error.code).toBe('CONFLICT');
    expect((await client.post('/api/checkout/addons/quote', { eventId: event.id, extras: ['extra_language'], languages: [...three, 'de'] })).statusCode).toBe(200); // repeatable
    // Trimmed to 0 with nothing else left → 400 (empty extras).
    expect((await client.post('/api/checkout/addons/quote', { eventId: event.id, extras: ['extra_language'] })).statusCode).toBe(400);

    await refundOrder(order);
    const ev = (await client.get(`/api/events/${event.id}`)).json();
    expect(ev.paid).toBe(true);
    expect(ev.purchasedExtras).toEqual([]);
    expect((await client.get(`/api/events/${event.id}/invitation`)).json().status).toBe('published');
    expect((await client.patch(`/api/events/${event.id}/invitation/slug`, { slug: `${slug}-b` })).statusCode).toBe(402);
    // The renamed link is still in use, so "Publish changes" now needs custom_link again.
    const repub = await client.post(`/api/events/${event.id}/invitation/publish`);
    expect(repub.statusCode).toBe(402);
    expect(repub.json().error.details.missing).toContainEqual({ code: 'custom_link', qty: 1 });
  });
});

describe('studio admins can always set a slug (custom_link is a brief section for studio couples)', () => {
  it('admin rename keeps the alias', async () => {
    const { event } = await hostWithEvent(app);
    const inv = await prisma.invitation.findFirstOrThrow({ where: { eventId: event.id } });
    const slug = `studio-${randomUUID().slice(0, 6)}`;
    expect((await admin.patch(`/api/events/${event.id}/invitation/slug`, { slug })).statusCode).toBe(200);
    // The admin invitation PUT no longer takes slug either.
    expect((await admin.put(`/api/admin/invitations/${inv.id}`, { slug: `${slug}-x` })).json().error.fields.slug).toMatch(/PATCH \/api\/events\/:id\/invitation\/slug/);
    expect(await prisma.invitationSlugRedirect.count({ where: { invitationId: inv.id, oldSlug: inv.slug } })).toBe(1);
    void publishEvent;
  });
});
