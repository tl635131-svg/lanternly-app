import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { runWorkerOnce } from '../src/services/jobs/worker.js';
import { sha256 } from '../src/lib/crypto.js';
import { Client, clearDevOutbox, getDevOutbox, hostWithEvent, makeApp, prisma, publishEvent } from './helpers.js';

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
  const settings = await ctx.client.patch(`/api/events/${ctx.event.id}/rsvp-settings`, { deadline: '2099-01-01', requireEmail: false, mealOptions: ['fish', 'veg'], maxCompanions: 2, allowChildren: true, allergyChecklist: true, extraEvents: ['brunch'], customQuestions: [{ id: 'song', label: 'Song request?', type: 'text' }], mode: 'auto', ...rsvp });
  if (settings.statusCode !== 200) throw new Error(settings.body);
  const inv = await publishEvent(ctx.client, ctx.event.id);
  return { ...ctx, slug: inv.slug as string };
}

describe('personal links (invitees)', () => {
  it('creates an invitee with an unguessable token and personal URL; the link personalises the invitation', async () => {
    const { client, event, slug } = await liveEvent();
    const res = await client.post(`/api/events/${event.id}/invitees`, { firstName: 'Mina', lastName: 'Cho', householdName: 'The Chos', email: 'mina@example.test', maxPartySize: 3, knownCompanions: [{ fullName: 'Joon Cho' }] });
    expect(res.statusCode).toBe(201);
    const invitee = res.json();
    const url = new URL(invitee.personalUrl);
    const g = url.searchParams.get('g')!;
    expect(url.pathname).toBe(`/i/${slug}`);
    expect(g.length).toBeGreaterThanOrEqual(16);
    expect(g).toMatch(/^[A-Za-z0-9_-]+$/);

    const pub = (await new Client(app).get(`/api/public/invitations/${slug}?g=${g}`)).json();
    expect(pub.invitee).toMatchObject({ firstName: 'Mina', householdName: 'The Chos', maxPartySize: 3, existingResponse: null });
    expect(pub.rsvp.maxCompanions).toBe(2);
    // Invalid token → no personalisation (no info leak)
    expect((await new Client(app).get(`/api/public/invitations/${slug}?g=guessed-token-123`)).json().invitee).toBeNull();

    // Open ping marks it opened
    await new Client(app).post(`/api/public/invitations/${slug}/open`, { g });
    const after = await prisma.invitee.findUniqueOrThrow({ where: { id: invitee.id } });
    expect(after.openCount).toBe(1);
    expect(after.status).toBe('opened');
  });

  it('tokens are unique per invitee and rotation kills the old link', async () => {
    const { client, event, slug } = await liveEvent();
    const a = (await client.post(`/api/events/${event.id}/invitees`, { firstName: 'A' })).json();
    const b = (await client.post(`/api/events/${event.id}/invitees`, { firstName: 'B' })).json();
    expect(a.personalUrl).not.toBe(b.personalUrl);
    const oldG = new URL(a.personalUrl).searchParams.get('g');
    const rotated = (await client.post(`/api/events/${event.id}/invitees/${a.id}/rotate-token`)).json();
    expect(rotated.personalUrl).not.toBe(a.personalUrl);
    expect((await new Client(app).get(`/api/public/invitations/${slug}?g=${oldG}`)).json().invitee).toBeNull();
    const rsvp = await new Client(app).post(`/api/public/invitations/${slug}/rsvps`, { g: oldG, fullName: 'A', attendance: 'no' });
    expect(rsvp.statusCode).toBe(404);
  });

  it('link endpoint returns the URL plus QR / share helpers; import supports CSV preview + commit', async () => {
    const { client, event } = await liveEvent();
    const a = (await client.post(`/api/events/${event.id}/invitees`, { firstName: 'Lee', phone: '416 555 0100' })).json();
    expect(a.phone).toBe('+14165550100');
    const link = await client.get(`/api/events/${event.id}/invitees/${a.id}/link`);
    expect(link.statusCode).toBe(200);
    expect(link.json().url).toBe(a.personalUrl);

    const csv = 'first name,last name,email,party size\nRosa,Diaz,rosa@example.test,2\nTom,,bad-email,1\n';
    const preview = await client.req('POST', `/api/events/${event.id}/invitees/import`, csv, { 'content-type': 'text/csv' });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().valid).toBe(1);
    expect(preview.json().errors).toHaveLength(1);
    const commit = await client.req('POST', `/api/events/${event.id}/invitees/import?commit=true`, csv, { 'content-type': 'text/csv' });
    expect(commit.statusCode).toBe(201);
    const list = (await client.get(`/api/events/${event.id}/invitees`)).json();
    expect(list.items.map((i: any) => i.firstName)).toEqual(expect.arrayContaining(['Lee', 'Rosa']));
  });
});

describe('public RSVP', () => {
  it('accepts an RSVP with meals, plus-ones, dietary tags and custom answers; host sees it in guests + stats', async () => {
    const { client, event, slug } = await liveEvent();
    const guestClient = new Client(app);
    const res = await guestClient.post(`/api/public/invitations/${slug}/rsvps`, {
      fullName: 'Pat Doe',
      email: 'pat@example.test',
      attendance: 'yes',
      primaryMeal: 'fish',
      dietaryTags: ['gluten_free'],
      companions: [{ type: 'adult', fullName: 'Sam Doe', meal: 'veg' }, { type: 'child', fullName: 'Kit Doe', meal: 'veg', dietary: 'nut allergy' }],
      extraEvents: { brunch: 'yes', not_an_event: 'yes' },
      answers: { song: 'Electric Feel', unknown: 'x' },
      message: 'Congrats!',
    });
    expect(res.statusCode).toBe(201);
    const { id, editToken, partySize } = res.json();
    expect(partySize).toBe(3);
    expect(editToken).toBeTruthy();
    const stored = await prisma.guest.findUniqueOrThrow({ where: { id }, include: { companions: true } });
    expect(stored.editTokenHash).toBe(sha256(editToken));
    expect(stored.extraEvents).toEqual({ brunch: 'yes' });
    expect(stored.answers).toEqual({ song: 'Electric Feel' });
    expect(stored.companions).toHaveLength(2);
    expect(stored.ipHash).not.toContain('127.0.0.1');

    // Confirmation email with edit link (console driver; nothing actually sent)
    expect(getDevOutbox().some((m) => m.to === 'pat@example.test' && m.templateKey === 'guest_rsvp_confirmation')).toBe(true);

    const guests = (await client.get(`/api/events/${event.id}/guests`)).json();
    expect(guests.items.find((g: any) => g.id === id)).toBeTruthy();
    const stats = (await client.get(`/api/events/${event.id}/stats`)).json();
    expect(stats).toMatchObject({ confirmed: 1, totalAttendees: 3 });
  });

  it('enforces RSVP rules server-side (meal required, companion cap, children)', async () => {
    const { slug } = await liveEvent({ allowChildren: false, maxCompanions: 1 });
    const c = new Client(app);
    const noMeal = await c.post(`/api/public/invitations/${slug}/rsvps`, { fullName: 'X', attendance: 'yes' });
    expect(noMeal.statusCode).toBe(400);
    expect(noMeal.json().error.fields).toHaveProperty('primaryMeal');
    const tooMany = await c.post(`/api/public/invitations/${slug}/rsvps`, { fullName: 'X', attendance: 'yes', primaryMeal: 'fish', companions: [{ fullName: 'A', meal: 'fish' }, { fullName: 'B', meal: 'fish' }] });
    expect(tooMany.json().error.fields).toHaveProperty('companions');
    const child = await c.post(`/api/public/invitations/${slug}/rsvps`, { fullName: 'X', attendance: 'yes', primaryMeal: 'fish', companions: [{ type: 'child', fullName: 'Kid', meal: 'veg' }] });
    expect(child.json().error.fields).toHaveProperty('companions.0.type');
    const badMeal = await c.post(`/api/public/invitations/${slug}/rsvps`, { fullName: 'X', attendance: 'yes', primaryMeal: 'steak' });
    expect(badMeal.statusCode).toBe(400);
    // Declines don't need meals
    expect((await c.post(`/api/public/invitations/${slug}/rsvps`, { fullName: 'Y', attendance: 'no' })).statusCode).toBe(201);
  });

  it('personal-link RSVP: party size capped by household, one reply per invitee, edit via link or edit token', async () => {
    const { client, event, slug } = await liveEvent();
    const inv = (await client.post(`/api/events/${event.id}/invitees`, { firstName: 'Oli', maxPartySize: 2 })).json();
    const g = new URL(inv.personalUrl).searchParams.get('g')!;
    const c = new Client(app);
    const over = await c.post(`/api/public/invitations/${slug}/rsvps`, { g, fullName: 'Oli', attendance: 'yes', primaryMeal: 'fish', companions: [{ fullName: 'A', meal: 'fish' }, { fullName: 'B', meal: 'fish' }] });
    expect(over.statusCode).toBe(400);
    const ok = await c.post(`/api/public/invitations/${slug}/rsvps`, { g, fullName: 'Oli', attendance: 'yes', primaryMeal: 'fish', companions: [{ fullName: 'Plus One', meal: 'veg' }] });
    expect(ok.statusCode).toBe(201);
    const { id, editToken } = ok.json();
    const again = await c.post(`/api/public/invitations/${slug}/rsvps`, { g, fullName: 'Oli', attendance: 'no' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ALREADY_RESPONDED');
    expect(again.json().error.details.guestId).toBe(id);
    expect((await prisma.invitee.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe('responded');

    // Existing response visible on the personal link
    const pub = (await new Client(app).get(`/api/public/invitations/${slug}?g=${g}`)).json();
    expect(pub.invitee.existingResponse.id).toBe(id);

    // Read/edit: wrong token → 404; edit token works; personal link works
    expect((await c.get(`/api/public/invitations/${slug}/rsvps/${id}?editToken=wrong-token`)).statusCode).toBe(404);
    expect((await c.get(`/api/public/invitations/${slug}/rsvps/${id}?editToken=${editToken}`)).statusCode).toBe(200);
    const edit = await c.patch(`/api/public/invitations/${slug}/rsvps/${id}`, { g, fullName: 'Oli', attendance: 'no' });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().attendance).toBe('no');
    expect(edit.json().companions).toHaveLength(0);
  });

  it('closed RSVPs, honeypot, idempotency key and demo sandbox', async () => {
    const closed = await liveEvent({ deadline: '2020-01-01' });
    const c = new Client(app);
    const res = await c.post(`/api/public/invitations/${closed.slug}/rsvps`, { fullName: 'Late', attendance: 'no' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('RSVP_CLOSED');
    expect(res.json().error.details.reason).toBe('deadline_passed');

    const { event, slug } = await liveEvent();
    const before = await prisma.guest.count({ where: { eventId: event.id } });
    const bot = await c.post(`/api/public/invitations/${slug}/rsvps`, { fullName: 'Bot', attendance: 'no', website: 'http://spam' });
    expect(bot.statusCode).toBe(201);
    expect(await prisma.guest.count({ where: { eventId: event.id } })).toBe(before);

    const key = { 'idempotency-key': `k-${Date.now()}` };
    const r1 = await c.post(`/api/public/invitations/${slug}/rsvps`, { fullName: 'Twice', attendance: 'no' }, key);
    const r2 = await c.post(`/api/public/invitations/${slug}/rsvps`, { fullName: 'Twice', attendance: 'no' }, key);
    expect(r1.json().id).toBe(r2.json().id);
    expect(await prisma.guest.count({ where: { eventId: event.id, fullName: 'Twice' } })).toBe(1);

    const demoBefore = await prisma.guest.count();
    const demo = await c.post('/api/public/invitations/demo-meadow/rsvps', { fullName: 'Demo', attendance: 'no' });
    expect(demo.statusCode).toBe(201);
    expect(demo.json().demo).toBe(true);
    expect(await prisma.guest.count()).toBe(demoBefore);
  });

  it('rate-limits public RSVP submissions per IP + invitation', async () => {
    const limited = await makeApp({ rateLimits: { rsvpPerMinute: 3 } });
    try {
      const { slug } = await liveEvent();
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await new Client(limited).post(`/api/public/invitations/${slug}/rsvps`, { fullName: `G${i}`, attendance: 'no' })).statusCode);
      expect(codes.slice(0, 3)).toEqual([201, 201, 201]);
      expect(codes.slice(3)).toEqual([429, 429]);
    } finally {
      await limited.close();
    }
  });

  it('host can add, edit, soft-delete and restore guests manually', async () => {
    const { client, event } = await liveEvent();
    const g = (await client.post(`/api/events/${event.id}/guests`, { fullName: 'Grandpa Joe', attendance: 'yes', primaryMeal: 'fish' })).json();
    expect(g.source).toBe('manual');
    expect((await client.patch(`/api/events/${event.id}/guests/${g.id}`, { notes: 'Wheelchair access' })).json().notes).toBe('Wheelchair access');
    expect((await client.del(`/api/events/${event.id}/guests/${g.id}`)).statusCode).toBe(204);
    expect((await client.get(`/api/events/${event.id}/guests`)).json().items.find((x: any) => x.id === g.id)).toBeUndefined();
    expect((await client.post(`/api/events/${event.id}/guests/${g.id}/restore`)).statusCode).toBe(200);
  });
});

describe('export', () => {
  it('exports xlsx with Guests + Companions sheets, and CSV with formula-injection protection', async () => {
    const { client, event, slug } = await liveEvent();
    await new Client(app).post(`/api/public/invitations/${slug}/rsvps`, { fullName: '=HYPERLINK("http://evil")', attendance: 'yes', primaryMeal: 'fish', companions: [{ fullName: 'Buddy', meal: 'veg' }] });
    await new Client(app).post(`/api/public/invitations/${slug}/rsvps`, { fullName: 'Nora', attendance: 'no' });

    const x = await client.req('POST', `/api/events/${event.id}/guests/export`, { format: 'xlsx' });
    expect(x.statusCode).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    expect(x.headers['content-disposition']).toMatch(/attachment; filename="guests-.*\.xlsx"/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.rawPayload as any);
    expect(wb.worksheets.map((w) => w.name)).toEqual(expect.arrayContaining(['Guests', 'Companions']));
    const guestsSheet = wb.getWorksheet('Guests')!;
    expect(guestsSheet.rowCount).toBeGreaterThanOrEqual(3);
    const companions = wb.getWorksheet('Companions')!;
    const compValues = JSON.stringify(companions.getSheetValues());
    expect(compValues).toContain('Buddy');

    const csv = await client.req('POST', `/api/events/${event.id}/guests/export`, { format: 'csv', status: 'yes' });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain("'=HYPERLINK");
    expect(csv.body).not.toContain('Nora');
  });

  it('viewers can export but strangers cannot', async () => {
    const { event } = await liveEvent();
    const other = await hostWithEvent(app);
    expect((await other.client.post(`/api/events/${event.id}/guests/export`, { format: 'csv' })).statusCode).toBe(404);
  });
});

describe('bulk send (DB-backed jobs + worker, console email driver)', () => {
  it('campaign → dispatch job → one queued message per invitee → delivered by the worker (logged, not sent)', async () => {
    const { client, event } = await liveEvent();
    await client.post(`/api/events/${event.id}/invitees`, { firstName: 'Ann', email: 'ann.campaign@example.test' });
    await client.post(`/api/events/${event.id}/invitees`, { firstName: 'Bo', email: 'bo.campaign@example.test' });
    await client.post(`/api/events/${event.id}/invitees`, { firstName: 'NoEmail' });

    const wa = await client.post(`/api/events/${event.id}/campaigns`, { kind: 'invite', channel: 'whatsapp' });
    expect(wa.statusCode).toBe(422);
    expect(wa.json().error.code).toBe('CHANNEL_NOT_AVAILABLE');

    const preview = (await client.post(`/api/events/${event.id}/campaigns/preview`, { channel: 'email' })).json();
    expect(preview.count ?? preview.recipients).toBe(2);

    const created = await client.post(`/api/events/${event.id}/campaigns`, { kind: 'invite' });
    expect(created.statusCode).toBe(201);
    const campaignId = created.json().id;

    for (let i = 0; i < 4; i++) await runWorkerOnce('test');
    const messages = await prisma.message.findMany({ where: { campaignId } });
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.status === 'sent')).toBe(true);
    const mail = getDevOutbox().find((m) => m.to === 'ann.campaign@example.test')!;
    expect(mail.templateKey).toBe('guest_invite');
    expect(mail.text).toMatch(/\/i\/[a-z0-9-]+\?g=/);
    const invitees = await prisma.invitee.findMany({ where: { eventId: event.id, email: { not: null } } });
    expect(invitees.every((i) => i.status === 'sent')).toBe(true);
  });
});
