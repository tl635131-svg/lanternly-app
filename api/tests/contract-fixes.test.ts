import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import { eventShareText, formatLongDate, personalShareText, shareLocale } from '../src/lib/share-text.js';
import { Client, hostWithEvent, makeApp, prisma, publishEvent } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

describe('custom questions: required', () => {
  it('requires an answer on a "yes" RSVP only, and reports answers.<id>', async () => {
    const { client, event } = await hostWithEvent(app);
    const s = await client.patch(`/api/events/${event.id}/rsvp-settings`, {
      deadline: '2099-01-01', requireEmail: false, mealOptions: [], customQuestions: [{ id: 'shuttle', label: 'Shuttle?', type: 'yes_no', required: true }, { id: 'song', label: 'Song?', type: 'text' }],
    });
    expect(s.statusCode).toBe(200);
    expect(s.json().customQuestions[0].required).toBe(true);
    const { slug } = await publishEvent(client, event.id);
    const c = new Client(app);
    const missing = await c.post(`/api/public/invitations/${slug}/rsvps`, { fullName: 'Q One', attendance: 'yes' });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.fields).toHaveProperty('answers.shuttle');
    expect(missing.json().error.fields).not.toHaveProperty('answers.song');
    // false is a valid answer to a yes/no question
    const ok = await c.post(`/api/public/invitations/${slug}/rsvps`, { fullName: 'Q Two', attendance: 'yes', answers: { shuttle: false } });
    expect(ok.statusCode, ok.body).toBe(201);
    expect((await c.post(`/api/public/invitations/${slug}/rsvps`, { fullName: 'Q Three', attendance: 'no' })).statusCode).toBe(201);
  });
});

describe('share texts (en, fr)', () => {
  it('formats natural French with plural/singular agreement and 1er', () => {
    const base = { title: 'Maya & Theo', hostNames: { partner1: 'Maya', partner2: 'Theo' }, eventDate: new Date('2027-06-19T00:00:00Z'), deadline: '2027-05-01', url: 'https://x.test/i/m' };
    expect(eventShareText('fr', base)).toBe('Maya & Theo ont le plaisir de vous inviter à leur célébration le samedi 19 juin 2027. Découvrez l’invitation et merci de répondre d’ici le 1er mai 2027 : https://x.test/i/m');
    expect(eventShareText('fr', { ...base, title: 'Sam', hostNames: { honoree: 'Sam' }, deadline: null })).toBe('Sam a le plaisir de vous inviter à sa célébration le samedi 19 juin 2027. Découvrez l’invitation : https://x.test/i/m');
    expect(personalShareText('fr', { ...base, firstName: 'Ben' })).toBe('Bonjour Ben, Maya & Theo ont le plaisir de vous inviter à leur célébration. Voici votre invitation personnelle : https://x.test/i/m');
    expect(eventShareText('en', base)).toContain('on Saturday, June 19, 2027');
    expect(formatLongDate('2027-05-02', 'fr', false)).toBe('2 mai 2027');
    expect(shareLocale('fr-CA')).toBe('fr');
    expect(shareLocale('es')).toBeNull();
  });

  it('share-kit returns real French for fr and omits untranslated languages', async () => {
    const { client, event } = await hostWithEvent(app, { languages: ['fr', 'en', 'es'], extras: ['extra_language'] });
    const kit = (await client.get(`/api/events/${event.id}/share-kit`)).json();
    expect(Object.keys(kit.texts).sort()).toEqual(['en', 'fr']);
    expect(kit.texts.fr).toMatch(/^Ada & Grace ont le plaisir de vous inviter à leur célébration le samedi 14 août 2027\./);
    expect(kit.texts.fr).not.toMatch(/would love|invitation:/);
    expect(kit.texts.en).toMatch(/would love/);
    expect(kit.untranslatedLanguages).toEqual(['es']);
    expect(kit.supportedTextLanguages).toEqual(['en', 'fr']);
    expect(kit.textLanguage).toBe('fr');
    expect(kit.email.subject).toBe('Invitation : Ada & Grace');
    expect(decodeURIComponent(kit.whatsapp)).toContain('ont le plaisir');
  });

  it('personal link text follows the household language, then the event language', async () => {
    const { client, event } = await hostWithEvent(app, { languages: ['en', 'fr'] });
    const fr = (await client.post(`/api/events/${event.id}/invitees`, { firstName: 'Léa', language: 'fr', email: 'lea@example.test' })).json();
    const en = (await client.post(`/api/events/${event.id}/invitees`, { firstName: 'Ben' })).json();
    const frLink = (await client.get(`/api/events/${event.id}/invitees/${fr.id}/link`)).json();
    expect(frLink.language).toBe('fr');
    expect(frLink.text).toMatch(/^Bonjour Léa, Ada & Grace ont le plaisir de vous inviter/);
    expect(decodeURIComponent(frLink.mailto)).toContain('subject=Invitation : Ada & Grace');
    const enLink = (await client.get(`/api/events/${event.id}/invitees/${en.id}/link`)).json();
    expect(enLink.language).toBe('en');
    expect(enLink.text).toMatch(/^Dear Ben,/);
  });
});

describe('music library placeholders', () => {
  it('every seeded track has a playable URL (audio/mpeg, Range support)', async () => {
    const c = new Client(app);
    const { items } = (await c.get('/api/public/music')).json();
    expect(items.length).toBeGreaterThanOrEqual(8);
    for (const t of items.filter((x: any) => x.artist === 'Studio Library')) {
      expect(t.url).toMatch(/^https?:\/\/.+\/api\/public\/music\/files\/[a-z0-9-]+\.mp3$/);
      const path = new URL(t.url).pathname;
      const res = await app.inject({ method: 'GET', url: path });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/^audio\/mpeg/);
      expect(res.rawPayload.length).toBeGreaterThan(10_000);
      // MP3: ID3 tag or MPEG frame sync
      const b = res.rawPayload;
      expect(b.subarray(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)).toBe(true);
    }
    const first = new URL(items[0].url).pathname;
    const part = await app.inject({ method: 'GET', url: first, headers: { range: 'bytes=0-99' } });
    expect(part.statusCode).toBe(206);
    expect(part.rawPayload.length).toBe(100);
    expect(part.headers['content-range']).toMatch(/^bytes 0-99\/\d+$/);
    expect((await app.inject({ method: 'GET', url: '/api/public/music/files/nope.mp3' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/public/music/files/..%2F..%2Fsecret.mp3' })).statusCode).toBe(400);
  });

  it('the published invitation exposes an absolute track URL', async () => {
    const { client, event } = await hostWithEvent(app);
    const track = await prisma.musicTrack.findFirstOrThrow({ where: { title: 'Lantern Glow' } });
    const inv = (await client.get(`/api/events/${event.id}/invitation`)).json();
    const put = await client.put(`/api/events/${event.id}/invitation`, { config: { ...inv.config, music: { trackId: track.id, volume: 0.5, autoplayOnOpen: true } } });
    expect(put.statusCode).toBe(200);
    const { slug } = await publishEvent(client, event.id);
    const pub = (await new Client(app).get(`/api/public/invitations/${slug}`)).json();
    const music = pub.music ?? pub.invitation?.music ?? pub.config?.music;
    expect(JSON.stringify(pub)).toContain('/api/public/music/files/lantern-glow.mp3');
    expect(music).toBeTruthy();
  });
});

describe('contract', () => {
  it('api-contract.md generated blocks and openapi.json match the code', () => {
    expect(() => execFileSync('npx', ['tsx', 'scripts/gen-contract.ts', '--check'], { stdio: 'pipe', env: process.env })).not.toThrow();
  }, 60_000);
});
