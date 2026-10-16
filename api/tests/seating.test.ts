import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Client, hostWithEvent, makeApp, publishEvent } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

async function eventWithParties() {
  const ctx = await hostWithEvent(app);
  await ctx.client.patch(`/api/events/${ctx.event.id}/rsvp-settings`, { deadline: '2099-01-01', requireEmail: false, mealOptions: [], maxCompanions: 4, allowChildren: true, allergyChecklist: false, extraEvents: [], customQuestions: [], mode: 'auto' });
  const inv = await publishEvent(ctx.client, ctx.event.id);
  const g = new Client(app);
  await g.post(`/api/public/invitations/${inv.slug}/rsvps`, { fullName: 'Party of three', attendance: 'yes', companions: [{ fullName: 'C1' }, { type: 'child', fullName: 'Kid', dietary: 'nut allergy' }] });
  await g.post(`/api/public/invitations/${inv.slug}/rsvps`, { fullName: 'Solo', attendance: 'yes' });
  await g.post(`/api/public/invitations/${inv.slug}/rsvps`, { fullName: 'Decliner', attendance: 'no' });
  return ctx;
}

describe('2D seating', () => {
  it('starts empty with confirmed parties only (declines excluded)', async () => {
    const { client, event } = await eventWithParties();
    const s = (await client.get(`/api/events/${event.id}/seating`)).json();
    expect(s.version).toBe(0);
    expect(s.tables).toEqual([]);
    expect(s.parties.map((p: any) => p.name).sort()).toEqual(['Party of three', 'Solo']);
    expect(s.stats).toMatchObject({ confirmedPeople: 4, seated: 0, unseated: 4 });
  });

  it('saves tables with positions + assignments, computes usage, and enforces optimistic versioning', async () => {
    const { client, event } = await eventWithParties();
    const s0 = (await client.get(`/api/events/${event.id}/seating`)).json();
    const party = s0.parties.find((p: any) => p.name === 'Party of three');
    const t1 = randomUUID();
    const t2 = randomUUID();
    const body = {
      version: 0,
      layout: [{ id: 'floor', kind: 'dance_floor', x: 300, y: 200, w: 200, h: 120 }],
      tables: [
        { id: t1, label: 'Table 1', shape: 'round', seats: 2, x: 100, y: 100, rotation: 0 },
        { id: t2, label: 'Head', shape: 'head', seats: 6, x: 400, y: 50, rotation: 15 },
      ],
      assignments: party.members.map((m: any) => ({ tableId: t1, ...(m.kind === 'guest' ? { guestId: m.id } : { companionId: m.id }) })),
    };
    const saved = await client.put(`/api/events/${event.id}/seating`, body);
    expect(saved.statusCode).toBe(200);
    const s1 = saved.json();
    expect(s1.version).toBe(1);
    const table1 = s1.tables.find((t: any) => t.id === t1);
    expect(table1).toMatchObject({ used: 3, overBy: 1, kidsCount: 1, dietaryCount: 1, x: 100, y: 100 });
    expect(s1.layout).toHaveLength(1);
    expect(s1.stats).toMatchObject({ seated: 3, unseated: 1, tables: 2, seats: 8 });

    // Stale version → 409
    const stale = await client.put(`/api/events/${event.id}/seating`, body);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('VERSION_CONFLICT');
  });

  it('rejects invalid assignments (unknown table, declined guest, double booking)', async () => {
    const { client, event } = await eventWithParties();
    const s0 = (await client.get(`/api/events/${event.id}/seating`)).json();
    const solo = s0.parties.find((p: any) => p.name === 'Solo');
    const t = randomUUID();
    const tables = [{ id: t, label: 'T', shape: 'rect', seats: 8 }];
    const twice = await client.put(`/api/events/${event.id}/seating`, { version: 0, tables, assignments: [{ tableId: t, guestId: solo.guestId }, { tableId: t, guestId: solo.guestId }] });
    expect(twice.statusCode).toBe(400);
    const unknownTable = await client.put(`/api/events/${event.id}/seating`, { version: 0, tables, assignments: [{ tableId: randomUUID(), guestId: solo.guestId }] });
    expect(unknownTable.statusCode).toBe(400);
    const stranger = await client.put(`/api/events/${event.id}/seating`, { version: 0, tables, assignments: [{ tableId: t, guestId: randomUUID() }] });
    expect(stranger.statusCode).toBe(400);
    const both = await client.put(`/api/events/${event.id}/seating`, { version: 0, tables, assignments: [{ tableId: t }] });
    expect(both.statusCode).toBe(400);
  });

  it('auto-arranges unseated parties, keeping parties together, and can apply the result', async () => {
    const { client, event } = await eventWithParties();
    await client.put(`/api/events/${event.id}/seating`, { version: 0, tables: [{ id: randomUUID(), label: 'A', shape: 'round', seats: 3 }, { id: randomUUID(), label: 'B', shape: 'round', seats: 2 }], assignments: [] });
    const proposal = (await client.post(`/api/events/${event.id}/seating/auto-arrange`, { apply: false })).json();
    expect(proposal.applied).toBe(false);
    expect(proposal.assignments).toHaveLength(4);
    expect(proposal.unseated).toEqual([]);
    const applied = (await client.post(`/api/events/${event.id}/seating/auto-arrange`, { apply: true })).json();
    expect(applied.applied).toBe(true);
    expect(applied.seating.stats.unseated).toBe(0);
    const tableA = applied.seating.tables.find((t: any) => t.label === 'A');
    expect(tableA.used).toBe(3); // the party of three sits together
  });

  it('declining an RSVP removes that guest from seating', async () => {
    const ctx = await hostWithEvent(app);
    await ctx.client.patch(`/api/events/${ctx.event.id}/rsvp-settings`, { deadline: '2099-01-01', requireEmail: false, mealOptions: [], maxCompanions: 2, allowChildren: true, allergyChecklist: false, extraEvents: [], customQuestions: [], mode: 'auto' });
    const inv = await publishEvent(ctx.client, ctx.event.id);
    const r = (await new Client(app).post(`/api/public/invitations/${inv.slug}/rsvps`, { fullName: 'Flaky', attendance: 'yes' })).json();
    const t = randomUUID();
    await ctx.client.put(`/api/events/${ctx.event.id}/seating`, { version: 0, tables: [{ id: t, label: 'T', shape: 'round', seats: 4 }], assignments: [{ tableId: t, guestId: r.id }] });
    await new Client(app).patch(`/api/public/invitations/${inv.slug}/rsvps/${r.id}`, { editToken: r.editToken, fullName: 'Flaky', attendance: 'no' });
    const s = (await ctx.client.get(`/api/events/${ctx.event.id}/seating`)).json();
    expect(s.assignments).toHaveLength(0);
  });
});
