/**
 * Seed: catalogue (CAD placeholder prices), the six Lanternly gallery themes, original add-ons, royalty-free music
 * placeholders, clearly-flagged sample testimonials, studio users, a fully filled studio demo event, a self-serve
 * demo event and a theme demo invitation.
 * Idempotent and migration-safe: catalogue rows are upserted, retired add-ons/themes are moved off and deleted,
 * seeded demo rows are refreshed in place, and demo data is only created if missing. It never wipes data.
 * All names, venues and texts are fictional and written for this project.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient, type PlanCode, type ProductType, type ServiceMode } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBRARY_MUSIC_PREFIX, libraryTrackPath } from '../src/lib/music.js';
import { storage } from '../src/services/storage/index.js';
import { ADDONS, RETIRED_ADDON_CODES } from '../src/lib/addons.js';
import { ALL_PRODUCTS, LEGACY_DEFAULT_FONTS, legacyPaletteKey, RETIRED_THEME_KEYS, THEMES, themeDefaultConfig } from '../src/lib/themes.js';

const prisma = new PrismaClient();
const token = () => randomBytes(16).toString('base64url');
const pw = (p: string) => hash(p, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
const en = (s: string) => ({ en: s });

// CAD prices are PLACEHOLDERS, to be confirmed by Nipun.
const PLANS: { code: PlanCode; product: ProductType; serviceMode: ServiceMode; name: string; description: string; features: string[]; base: number; includedBlocks: number | null; extraBlock: number; maxLanguages: number; revisions: number; delivery: number | null; allExtras: boolean; hasRsvp: boolean; usesSections: boolean; sort: number }[] = [
  { code: 'diy', product: 'wedding_invite', serviceMode: 'self_serve', name: 'Self-serve', description: 'Design it yourself with our editor and publish when you are ready.', features: ['All designs', 'Unlimited sections', 'RSVP & guest dashboard', 'Personal guest links & QR', 'Up to 2 languages'], base: 9900, includedBlocks: null, extraBlock: 0, maxLanguages: 2, revisions: 0, delivery: null, allExtras: false, hasRsvp: true, usesSections: false, sort: 1 },
  { code: 'std', product: 'save_the_date', serviceMode: 'studio', name: 'Save the date', description: 'An animated save-the-date card made by our studio.', features: ['Names & date', 'Animated reveal', 'Shareable link', 'Ready in 3 days'], base: 7900, includedBlocks: null, extraBlock: 0, maxLanguages: 1, revisions: 1, delivery: 3, allExtras: false, hasRsvp: false, usesSections: false, sort: 2 },
  { code: 'experience', product: 'wedding_invite', serviceMode: 'studio', name: 'Signature', description: 'Our studio designs your full invitation website with RSVP.', features: ['5 information sections included', 'RSVP dashboard & Excel export', 'Seating planner', '2 design revision rounds', 'Up to 3 languages', 'Ready in about 7 business days'], base: 24900, includedBlocks: 5, extraBlock: 800, maxLanguages: 3, revisions: 2, delivery: 7, allExtras: false, hasRsvp: true, usesSections: true, sort: 3 },
  { code: 'premium', product: 'wedding_invite', serviceMode: 'studio', name: 'Couture', description: 'Designed from scratch around your ideas, with every add-on included.', features: ['Unlimited sections', 'All extras included', 'Unlimited revision rounds', 'Up to 5 languages', 'Priority 48–72h'], base: 89900, includedBlocks: null, extraBlock: 0, maxLanguages: 5, revisions: 99, delivery: 3, allExtras: true, hasRsvp: true, usesSections: true, sort: 4 },
  { code: 'birthday', product: 'birthday', serviceMode: 'studio', name: 'Birthday glow card', description: 'A one-page invitation with your own message.', features: ['Personal message', 'Shareable link', 'Ready in 3 days'], base: 6900, includedBlocks: null, extraBlock: 0, maxLanguages: 1, revisions: 1, delivery: 3, allExtras: false, hasRsvp: false, usesSections: false, sort: 5 },
  { code: 'bridesmaid', product: 'bridesmaid', serviceMode: 'studio', name: 'Bridal party proposal', description: 'Ask your favourite people to stand by your side.', features: ['Personal message', 'Shareable link'], base: 7900, includedBlocks: null, extraBlock: 0, maxLanguages: 1, revisions: 1, delivery: 3, allExtras: false, hasRsvp: false, usesSections: false, sort: 6 },
];

// Add-ons and themes live in src/lib/addons.ts and src/lib/themes.ts (single source, easy to swap).

const TRACKS = [
  { title: 'First Light Waltz', artist: 'Studio Library', mood: ['romantic', 'piano'], file: 'first-light-waltz.mp3' },
  { title: 'Harbour Morning', artist: 'Studio Library', mood: ['acoustic', 'light'], file: 'harbour-morning.mp3' },
  { title: 'Garden Strings', artist: 'Studio Library', mood: ['strings', 'classic'], file: 'garden-strings.mp3' },
  { title: 'Slow Dance in June', artist: 'Studio Library', mood: ['romantic', 'guitar'], file: 'slow-dance-in-june.mp3' },
  { title: 'Lantern Glow', artist: 'Studio Library', mood: ['warm', 'cinematic'], file: 'lantern-glow.mp3' },
  { title: 'Paper Boats', artist: 'Studio Library', mood: ['playful', 'ukulele'], file: 'paper-boats.mp3' },
  { title: 'Evening Promenade', artist: 'Studio Library', mood: ['jazz', 'elegant'], file: 'evening-promenade.mp3' },
  { title: 'Northern Vows', artist: 'Studio Library', mood: ['ambient', 'calm'], file: 'northern-vows.mp3' },
];

const PLACEHOLDER_SECONDS = 8;
const PLACEHOLDER_LICENSE = 'Placeholder: original synthesized tone made for this project (no third-party rights). Replace with a licensed track before launch.';

async function seedCatalogue() {
  for (const p of PLANS) {
    const data = { product: p.product, serviceMode: p.serviceMode, nameI18n: en(p.name), descriptionI18n: en(p.description), features: p.features.map(en), basePriceCents: p.base, currency: 'CAD', includedBlocks: p.includedBlocks, extraBlockPriceCents: p.extraBlock, maxLanguages: p.maxLanguages, revisionRounds: p.revisions, deliveryDays: p.delivery, includesAllExtras: p.allExtras, hasRsvp: p.hasRsvp, usesSections: p.usesSections, active: true, sort: p.sort };
    await prisma.plan.upsert({ where: { code: p.code }, create: { code: p.code, ...data }, update: data });
  }
  for (const a of ADDONS) {
    const data = { nameI18n: en(a.name), descriptionI18n: en(a.description), priceCents: a.priceCents, currency: 'CAD', active: true, sort: a.sort };
    await prisma.extra.upsert({ where: { code: a.code }, create: { code: a.code, ...data }, update: data });
  }
  await prisma.planExtra.deleteMany({});
  await prisma.planExtra.createMany({ data: ADDONS.flatMap((a) => a.plans.map((planCode) => ({ planCode, extraCode: a.code }))) });
  // Retired add-ons: links are gone (above); orders keep their own line items, so the rows can go.
  await prisma.extra.deleteMany({ where: { code: { in: [...RETIRED_ADDON_CODES] } } });

  for (const [i, t] of THEMES.entries()) {
    const data = {
      products: ALL_PRODUCTS,
      nameI18n: en(t.name),
      descriptionI18n: en(t.description),
      moodTags: t.mood,
      demoSlug: t.demoSlug ?? null,
      isNew: t.isNew ?? false,
      isPopular: t.isPopular ?? false,
      status: 'active' as const,
      defaultConfig: themeDefaultConfig(t) as object,
      sort: i + 1,
    };
    await prisma.theme.upsert({ where: { key: t.key }, create: { key: t.key, ...data }, update: data });
  }
  // Retired themes: move every reference to the replacement design, then delete the old row.
  for (const [oldKey, newKey] of Object.entries(RETIRED_THEME_KEYS)) {
    const old = await prisma.theme.findUnique({ where: { key: oldKey } });
    if (!old) continue;
    const replacement = await prisma.theme.findUniqueOrThrow({ where: { key: newKey } });
    await prisma.$transaction([
      prisma.invitation.updateMany({ where: { themeId: old.id }, data: { themeId: replacement.id } }),
      prisma.invitationVersion.updateMany({ where: { themeId: old.id }, data: { themeId: replacement.id } }),
      prisma.order.updateMany({ where: { themeId: old.id }, data: { themeId: replacement.id } }),
      prisma.checkoutDraft.updateMany({ where: { themeKey: oldKey }, data: { themeKey: newKey } }),
      prisma.theme.delete({ where: { id: old.id } }),
    ]);
    console.log(`  retired theme ${oldKey} → ${newKey}`);
  }
  // Placeholder audio: original synthesized 8-second chords from assets/music (see scripts/gen-placeholder-music.sh),
  // copied into the storage driver and served at /api/public/music/files/:file.
  // api/assets/music, whether this runs from prisma/seed.ts (tsx) or the compiled dist/prisma/seed.js.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const musicDir = [path.resolve(here, '../assets/music'), path.resolve(here, '../../assets/music')].find((d) => existsSync(d)) ?? path.resolve(here, '../assets/music');
  for (const tr of TRACKS) {
    const existing = await prisma.musicTrack.findFirst({ where: { title: tr.title } });
    const body = await readFile(path.join(musicDir, tr.file));
    await storage.put(LIBRARY_MUSIC_PREFIX + tr.file, body, 'audio/mpeg');
    const placeholderUrl = libraryTrackPath(tr.file);
    // Don't overwrite a real track an admin has since set (an external URL or another file).
    const keepUrl = existing?.url && existing.url !== placeholderUrl;
    const data = keepUrl
      ? { artist: tr.artist, moodTags: tr.mood }
      : { title: tr.title, artist: tr.artist, license: PLACEHOLDER_LICENSE, url: placeholderUrl, durationS: PLACEHOLDER_SECONDS, moodTags: tr.mood, active: true };
    if (existing) await prisma.musicTrack.update({ where: { id: existing.id }, data });
    else await prisma.musicTrack.create({ data: { title: tr.title, artist: tr.artist, license: PLACEHOLDER_LICENSE, url: placeholderUrl, durationS: PLACEHOLDER_SECONDS, moodTags: tr.mood, active: true } });
  }
}

async function seedUsers() {
  const adminPw = process.env.SEED_ADMIN_PASSWORD;
  const demoPw = process.env.SEED_DEMO_PASSWORD;
  if (!adminPw || !demoPw) throw new Error('Set SEED_ADMIN_PASSWORD and SEED_DEMO_PASSWORD (dev only) before seeding.');
  const up = async (email: string, name: string, role: 'admin' | 'staff' | 'host', password: string | null) =>
    prisma.user.upsert({ where: { email }, create: { email, name, role, passwordHash: password ? await pw(password) : null, emailVerifiedAt: new Date() }, update: { role, name } });
  const admin = await up('admin@example.com', 'Studio Admin', 'admin', adminPw);
  const designer = await up('designer@example.com', 'Studio Designer', 'staff', adminPw);
  const host = await up('host@example.com', 'Maya Lindqvist', 'host', demoPw);
  const partner = await up('partner@example.com', 'Theo Okafor', 'host', demoPw);
  const diy = await up('diy@example.com', 'Priya Raman', 'host', demoPw);
  return { admin, designer, host, partner, diy };
}

const DEMO_SLUG = 'maya-and-theo';

// Demo copy, written in our own voice. Shared by creation and the in-place refresh of older seeded rows.
const THEME_DEMO_SLUG = 'demo-meadow';
const DEMO_TAGLINE = { en: 'You’re invited', fr: 'Vous êtes invités' };
const DEMO_COVER = { type: 'glow', initials: 'M&T', glowColor: '#FF9C7A' };
const DEMO_DRESS_PALETTE = ['#0F3B3E', '#FF9C7A', '#E8F4F1'];
const DEMO_REVISION = {
  request: 'Could the opening glow be a little softer, and can we move the FAQ above the gifts?',
  staffNote: 'Done: softer coral glow, and the FAQ now sits above the gifts.',
  comment: 'Toned the glow down to a softer coral. Have a look!',
};
const DEMO_ORDER_ITEMS_EXTRAS = [
  { kind: 'extra', code: 'own_song', label: 'Your own song', qty: 1, unitPriceCents: 1500 },
  { kind: 'extra', code: 'custom_monogram', label: 'Custom monogram', qty: 1, unitPriceCents: 2500 },
];

/**
 * Databases seeded before the Lanternly originality pass hold demo rows with reference-derived copy and
 * designs. Patch only those seeded rows (matched by slug / order number / exact old text) so a re-seed
 * cleans them without touching anything a person created.
 */
async function refreshSeededDemos() {
  const old = await prisma.invitation.findUnique({ where: { slug: 'demo-garden-watercolour' } });
  if (old && !(await prisma.invitation.findUnique({ where: { slug: THEME_DEMO_SLUG } }))) {
    await prisma.invitation.update({ where: { id: old.id }, data: { slug: THEME_DEMO_SLUG } });
    await prisma.event.update({ where: { id: old.eventId }, data: { adminNote: 'Public demo for the Meadow design. RSVPs are sandboxed.' } });
  }
  const themeFor = async (key: string) => prisma.theme.findUniqueOrThrow({ where: { key } });
  const demos: [string, string][] = [[DEMO_SLUG, 'harbour'], ['priya-and-sam', 'citrus'], [THEME_DEMO_SLUG, 'meadow']];
  for (const [slug, key] of demos) {
    const inv = await prisma.invitation.findUnique({ where: { slug } });
    if (!inv) continue;
    const theme = await themeFor(key);
    const base = theme.defaultConfig as Record<string, unknown>;
    const cfg = { ...(inv.config as Record<string, unknown>), palette: base.palette, fonts: base.fonts, opening: base.opening, cover: slug === DEMO_SLUG ? DEMO_COVER : base.cover };
    const content = structuredClone(inv.content as Record<string, any>);
    if (content.en?.hero?.tagline === 'Together with their families') content.en.hero.tagline = DEMO_TAGLINE.en;
    if (content.fr?.hero?.tagline === 'Avec leurs familles') content.fr.hero.tagline = DEMO_TAGLINE.fr;
    if (content.en?.sections?.invitation_text?.heading === 'You are invited') content.en.sections.invitation_text.heading = 'Join us by the lake';
    if (content.fr?.sections?.invitation_text?.heading === 'Vous êtes invités') content.fr.sections.invitation_text.heading = 'Rejoignez-nous au bord du lac';
    const dress = content.en?.sections?.dress_code;
    if (dress && JSON.stringify(dress.palette) === JSON.stringify(['#2F5D62', '#C9A66B', '#E8E1D5'])) dress.palette = DEMO_DRESS_PALETTE;
    await prisma.invitation.update({ where: { id: inv.id }, data: { themeId: theme.id, config: cfg as any, content } });
    await prisma.invitationVersion.updateMany({ where: { invitationId: inv.id }, data: { themeId: theme.id, config: cfg as any, content } });
    if (slug === DEMO_SLUG) {
      const brief = await prisma.brief.findUnique({ where: { eventId: inv.eventId } });
      const data = (brief?.data ?? {}) as Record<string, any>;
      if (brief && (JSON.stringify(data.dress_code?.palette) === JSON.stringify(['#2F5D62', '#C9A66B', '#E8E1D5']) || (data.custom_monogram && !data.custom_monogram.glowColor))) {
        const next = { ...data, dress_code: { ...data.dress_code, palette: DEMO_DRESS_PALETTE }, custom_monogram: { letters: 'M&T', ...data.custom_monogram, glowColor: '#FF9C7A' } };
        await prisma.brief.update({ where: { eventId: inv.eventId }, data: { data: next } });
      }
      await prisma.revision.updateMany({ where: { eventId: inv.eventId, request: { contains: 'envelope' } }, data: { request: DEMO_REVISION.request, staffNote: DEMO_REVISION.staffNote } });
      const revIds = (await prisma.revision.findMany({ where: { eventId: inv.eventId }, select: { id: true } })).map((r) => r.id);
      await prisma.revisionComment.updateMany({ where: { revisionId: { in: revIds }, body: { contains: 'envelope' } }, data: { body: DEMO_REVISION.comment } });
    }
  }
  // The seeded demo order: same prices, original add-on codes and labels.
  const order = await prisma.order.findUnique({ where: { number: 'ORD-2026-00001' } });
  if (order && order.extras.includes('wax_seal')) {
    await prisma.order.update({ where: { id: order.id }, data: { extras: ['own_song', 'custom_monogram'] } });
    await prisma.orderItem.updateMany({ where: { orderId: order.id, code: 'custom_music' }, data: { code: 'own_song', label: 'Your own song' } });
    await prisma.orderItem.updateMany({ where: { orderId: order.id, code: 'wax_seal' }, data: { code: 'custom_monogram', label: 'Custom monogram' } });
  }
}

/** Invitations still on a retired theme's untouched default palette/fonts get the replacement theme's look. */
async function restyleUncustomisedInvitations() {
  const themes = await prisma.theme.findMany();
  const byKey = new Map(themes.map((t) => [t.key, t]));
  const byId = new Map(themes.map((t) => [t.id, t]));
  const legacyFonts = (f: unknown) => !!f && typeof f === 'object' && Object.keys(f).length === 2 && (f as any).display === LEGACY_DEFAULT_FONTS.display && (f as any).body === LEGACY_DEFAULT_FONTS.body;
  const restyle = (config: unknown, themeId: string | null) => {
    const cfg = { ...((config ?? {}) as Record<string, any>) };
    const legacy = legacyPaletteKey(cfg.palette);
    const theme = legacy ? byKey.get(RETIRED_THEME_KEYS[legacy]!) : themeId ? byId.get(themeId) : undefined;
    if (!theme) return null;
    const base = theme.defaultConfig as Record<string, any>;
    let changed = false;
    if (legacy) {
      cfg.palette = base.palette;
      changed = true;
    }
    if (!cfg.fonts || legacyFonts(cfg.fonts)) {
      cfg.fonts = base.fonts;
      changed = true;
    }
    return changed ? cfg : null;
  };
  let n = 0;
  for (const inv of await prisma.invitation.findMany({ select: { id: true, config: true, themeId: true } })) {
    const cfg = restyle(inv.config, inv.themeId);
    if (cfg) {
      await prisma.invitation.update({ where: { id: inv.id }, data: { config: cfg } });
      n++;
    }
  }
  for (const v of await prisma.invitationVersion.findMany({ select: { id: true, config: true, themeId: true } })) {
    const cfg = restyle(v.config, v.themeId);
    if (cfg) await prisma.invitationVersion.update({ where: { id: v.id }, data: { config: cfg } });
  }
  if (n) console.log(`  restyled ${n} invitation(s) still on a retired default palette or fonts`);
}

async function seedStudioDemo(users: Awaited<ReturnType<typeof seedUsers>>) {
  if (await prisma.invitation.findUnique({ where: { slug: DEMO_SLUG } })) return;
  const theme = await prisma.theme.findUniqueOrThrow({ where: { key: 'harbour' } });
  const track = await prisma.musicTrack.findFirstOrThrow({ where: { title: 'Harbour Morning' } });
  const eventDate = new Date('2027-06-19T00:00:00Z');
  const archiveAfter = new Date('2027-08-19T00:00:00Z');
  const rsvpSettings = { deadline: '2027-05-01', requireEmail: true, mealOptions: ['beef', 'salmon', 'vegetarian'], maxCompanions: 3, allowChildren: true, allergyChecklist: true, extraEvents: ['welcome_drinks', 'farewell_brunch'], customQuestions: [{ id: 'song', label: 'Which song gets you on the dance floor?', type: 'text' }, { id: 'shuttle', label: 'Will you take the shuttle?', type: 'yes_no' }], mode: 'auto' };
  const sections = ['our_story', 'timeline', 'dress_code', 'accommodation', 'transport', 'gift_list', 'faq', 'countdown', 'custom_monogram', 'own_song', 'rsvp'];
  const briefData = {
    our_story: { text: 'We met on a rainy ferry crossing to Toronto Island, both late for the same friend’s picnic. Seven summers, two apartments and one very opinionated cat later, we are getting married by the lake.', milestones: [{ year: '2019', title: 'The ferry', text: 'Shared an umbrella and a bag of cherries.' }, { year: '2025', title: 'The question', text: 'Asked at sunrise on the bluffs.' }] },
    timeline: { rows: [{ time: '15:30', title: 'Ceremony', description: 'On the lawn by the water' }, { time: '16:30', title: 'Cocktails', description: 'Oysters and lemonade on the terrace' }, { time: '18:30', title: 'Dinner', description: 'Family-style in the barn' }, { time: '21:00', title: 'Dancing', description: 'Until the fireflies go home' }] },
    dress_code: { text: 'Garden formal. Light colours welcome; comfortable shoes recommended for the lawn.', palette: DEMO_DRESS_PALETTE },
    accommodation: { rows: [{ name: 'Harbourview Inn', address: '12 Front St, Picton, ON', url: 'https://example.com/harbourview', note: 'Mention "Maya & Theo" for the group rate' }, { name: 'Maple Cottage Rentals', address: 'County Rd 7, Prince Edward County, ON', note: 'Sleeps 6 — great for groups' }] },
    transport: { rows: [{ type: 'Shuttle', time: '14:45', from: 'Harbourview Inn', to: 'Willowmere Estate', note: 'Return trips at 23:00 and 00:30' }] },
    gift_list: { mode: 'both', registryUrl: 'https://example.com/registry/maya-theo', interacEmail: 'gifts@example.com', note: 'Your presence is the gift. If you wish, a contribution to our honeymoon fund is warmly appreciated.' },
    faq: { rows: [{ question: 'Can I bring a plus-one?', answer: 'Your invitation shows how many seats we have saved for you.' }, { question: 'Are children welcome?', answer: 'Yes! There will be a kids’ corner with games.' }, { question: 'Is there parking?', answer: 'Free parking is available on site.' }] },
    countdown: { startAt: '2027-06-19T15:30' },
    custom_monogram: { letters: 'M&T', glowColor: '#FF9C7A' },
    own_song: { description: 'Something light and acoustic', libraryTrackId: track.id },
    rsvp: rsvpSettings,
  };

  const event = await prisma.event.create({
    data: {
      product: 'wedding_invite', planCode: 'experience', serviceMode: 'studio', title: 'Maya & Theo', hostNames: { partner1: 'Maya', partner2: 'Theo' }, eventDate, timezone: 'America/Toronto',
      venueName: 'Willowmere Estate', venueAddress: '400 Lakeshore Rd, Prince Edward County, ON', primaryLanguage: 'en', languages: ['en', 'fr'], productionStage: 'review', maxRevisionRounds: 2,
      invitesSentManual: 0, rsvpSettings, paidAt: new Date('2026-09-02T15:00:00Z'), archiveAfter, assignedStaffId: users.designer.id, remindersEnabled: true, reminderDaysBefore: 14,
      members: { create: [{ userId: users.host.id, role: 'owner' }, { userId: users.partner.id, role: 'cohost', invitedById: users.host.id }] },
      brief: { create: { sections, customBlockNames: {}, data: briefData, status: 'submitted', submittedAt: new Date('2026-09-10T18:00:00Z'), locked: true } },
    },
  });
  await prisma.order.create({
    data: {
      number: 'ORD-2026-00001', userId: users.host.id, eventId: event.id, email: users.host.email, planCode: 'experience', themeId: theme.id, sections: sections.filter((s) => !['custom_monogram', 'own_song', 'rsvp'].includes(s)), extras: ['own_song', 'custom_monogram'], languages: ['en', 'fr'],
      buyerInfo: { partner1: 'Maya', partner2: 'Theo', eventDate: '2027-06-19', venue: 'Willowmere Estate', email: users.host.email }, subtotalCents: 24900 + 2 * 800 + 1500 + 2500, taxCents: 3965, totalCents: 30500 + 3965, currency: 'CAD', status: 'paid', paymentProvider: 'mock', checkoutSessionId: 'mock_cs_seed_demo', paidAt: new Date('2026-09-02T15:00:00Z'),
      consentTermsAt: new Date('2026-09-02T14:58:00Z'), consentPrivacyAt: new Date('2026-09-02T14:58:00Z'),
      items: { create: [{ kind: 'plan', code: 'experience', label: 'Signature', qty: 1, unitPriceCents: 24900 }, { kind: 'extra_block', code: 'extra_block', label: 'Additional information block', qty: 2, unitPriceCents: 800 }, DEMO_ORDER_ITEMS_EXTRAS[0]!, DEMO_ORDER_ITEMS_EXTRAS[1]!] },
    },
  });
  const venue = { heading: 'Where & when', items: [{ label: 'Ceremony & reception', name: 'Willowmere Estate', address: '400 Lakeshore Rd, Prince Edward County, ON', startsAt: '15:30', mapQuery: 'Willowmere Estate, Prince Edward County, ON' }] };
  const contentEn = {
    hero: { tagline: DEMO_TAGLINE.en, title: 'Maya & Theo', subtitle: 'are getting married', dateText: 'Saturday, June 19, 2027' },
    sections: {
      invitation_text: { heading: 'Join us by the lake', body: 'Join us for an afternoon by the lake, a long dinner and a night of dancing.' },
      our_story: { heading: 'Our story', ...briefData.our_story },
      timeline: { heading: 'The day', ...briefData.timeline },
      venue,
      dress_code: { heading: 'What to wear', ...briefData.dress_code },
      accommodation: { heading: 'Where to stay', ...briefData.accommodation },
      transport: { heading: 'Getting there', ...briefData.transport },
      gift_list: { heading: 'Gifts', ...briefData.gift_list },
      faq: { heading: 'Good to know', ...briefData.faq },
      countdown: { heading: 'Counting down', ...briefData.countdown },
      rsvp: { heading: 'Kindly reply', intro: 'Please let us know by May 1st.', thankYouYes: 'Wonderful — we can’t wait to celebrate with you!', thankYouNo: 'We’ll miss you, and we’ll raise a glass in your honour.' },
    },
    footer: { signature: 'With love, Maya & Theo' },
  };
  const contentFr = {
    hero: { tagline: DEMO_TAGLINE.fr, title: 'Maya & Theo', subtitle: 'se marient', dateText: 'Samedi 19 juin 2027' },
    sections: { invitation_text: { heading: 'Rejoignez-nous au bord du lac', body: 'Rejoignez-nous pour un après-midi au bord du lac, un long dîner et une soirée dansante.' }, venue, rsvp: { heading: 'Merci de répondre', intro: 'Avant le 1er mai, s’il vous plaît.' } },
  };
  const config = { ...(theme.defaultConfig as object), cover: DEMO_COVER, music: { trackId: track.id, assetId: null, volume: 0.5, autoplayOnOpen: true }, sectionOrder: ['hero', 'invitation_text', 'countdown', 'our_story', 'timeline', 'venue', 'dress_code', 'accommodation', 'transport', 'gift_list', 'faq', 'rsvp'], hiddenSections: [] };
  const inv = await prisma.invitation.create({ data: { eventId: event.id, kind: 'wedding_invite', themeId: theme.id, slug: DEMO_SLUG, status: 'published', locale: 'en', content: { en: contentEn, fr: contentFr }, config, previewToken: 'demo-preview-token-maya-theo', publishedAt: new Date('2026-10-01T16:00:00Z'), version: 1, publishedVersion: 1 } });
  await prisma.invitationVersion.create({ data: { invitationId: inv.id, version: 1, themeId: theme.id, content: inv.content as any, config: inv.config as any, publishedById: users.designer.id } });
  await prisma.revision.create({ data: { eventId: event.id, roundNumber: 1, request: DEMO_REVISION.request, status: 'completed', staffNote: DEMO_REVISION.staffNote, createdById: users.host.id, resolvedAt: new Date('2026-10-05T14:00:00Z'), comments: { create: [{ authorId: users.designer.id, body: DEMO_REVISION.comment }] } } });

  // Invitees (households with personal links)
  const households = [
    { firstName: 'Eleanor', lastName: 'Vance', householdName: 'The Vance family', email: 'eleanor.vance@example.com', maxPartySize: 4, groupLabel: 'family' },
    { firstName: 'Jonah', lastName: 'Reyes', email: 'jonah.reyes@example.com', maxPartySize: 2, groupLabel: 'friends' },
    { firstName: 'Aiko', lastName: 'Tanaka', email: 'aiko.tanaka@example.com', maxPartySize: 2, groupLabel: 'friends' },
    { firstName: 'Samuel', lastName: 'Adeyemi', householdName: 'The Adeyemis', email: 'samuel.adeyemi@example.com', phoneE164: '+14165550142', maxPartySize: 3, groupLabel: 'family' },
    { firstName: 'Clara', lastName: 'Moreau', email: 'clara.moreau@example.com', language: 'fr', maxPartySize: 2, groupLabel: 'work' },
    { firstName: 'Ravi', lastName: 'Shah', email: 'ravi.shah@example.com', maxPartySize: 1, groupLabel: 'work' },
    { firstName: 'Lucía', lastName: 'Ortega', email: 'lucia.ortega@example.com', maxPartySize: 2, groupLabel: 'friends' },
    { firstName: 'Ben', lastName: 'Whitlock', phoneE164: '+16135550199', maxPartySize: 2, groupLabel: 'friends' },
  ];
  const invitees = [] as { id: string; firstName: string; lastName: string | null }[];
  for (const [i, h] of households.entries()) {
    invitees.push(await prisma.invitee.create({ data: { eventId: event.id, ...h, token: i === 0 ? 'demoVanceFamily0001' : token(), status: 'sent', sentAt: new Date('2026-10-02T15:00:00Z') } }));
  }

  // Responses
  type C = { type: 'adult' | 'child'; fullName: string; meal: string; dietary?: string };
  const responses: { inv?: number; fullName: string; email?: string; attendance: 'yes' | 'no' | 'pending'; meal?: string; dietary?: string; tags?: string[]; companions?: C[]; message?: string; source?: string; extra?: Record<string, string>; answers?: Record<string, unknown> }[] = [
    { inv: 0, fullName: 'Eleanor Vance', email: 'eleanor.vance@example.com', attendance: 'yes', meal: 'salmon', companions: [{ type: 'adult', fullName: 'Marcus Vance', meal: 'beef' }, { type: 'child', fullName: 'Ivy Vance', meal: 'vegetarian', dietary: 'Lactose intolerant' }], message: 'So happy for you both!', extra: { welcome_drinks: 'yes', farewell_brunch: 'yes' }, answers: { song: 'September', shuttle: true } },
    { inv: 1, fullName: 'Jonah Reyes', email: 'jonah.reyes@example.com', attendance: 'yes', meal: 'beef', companions: [{ type: 'adult', fullName: 'Talia Reyes', meal: 'vegetarian', dietary: 'Vegan' }], extra: { welcome_drinks: 'yes', farewell_brunch: 'no' }, answers: { song: 'Dancing Queen', shuttle: false } },
    { inv: 2, fullName: 'Aiko Tanaka', email: 'aiko.tanaka@example.com', attendance: 'no', message: 'I’ll be abroad — sending all my love!' },
    { inv: 3, fullName: 'Samuel Adeyemi', email: 'samuel.adeyemi@example.com', attendance: 'yes', meal: 'beef', dietary: 'Peanut allergy', tags: ['nut'], companions: [{ type: 'adult', fullName: 'Grace Adeyemi', meal: 'salmon' }, { type: 'child', fullName: 'Tobi Adeyemi', meal: 'vegetarian' }] },
    { inv: 4, fullName: 'Clara Moreau', email: 'clara.moreau@example.com', attendance: 'yes', meal: 'vegetarian', tags: ['gluten_free'], companions: [{ type: 'adult', fullName: 'Julien Petit', meal: 'salmon' }] },
    { fullName: 'Nora Lindqvist', email: 'nora.l@example.com', attendance: 'yes', meal: 'salmon', message: 'Proud big sister here.' },
    { fullName: 'Owen Price', email: 'owen.price@example.com', attendance: 'no' },
    { fullName: 'Grandma Ruth', attendance: 'yes', meal: 'salmon', source: 'manual', companions: [{ type: 'adult', fullName: 'Grandpa Leo', meal: 'beef' }] },
    { fullName: 'Hannah Kim', email: 'hannah.kim@example.com', attendance: 'pending', source: 'manual' },
  ];
  const guestIds: { guestId: string; companionIds: string[]; partySize: number }[] = [];
  for (const [i, r] of responses.entries()) {
    const companions = r.attendance === 'yes' ? (r.companions ?? []) : [];
    const g = await prisma.guest.create({
      data: {
        eventId: event.id, inviteeId: r.inv !== undefined ? invitees[r.inv]!.id : null, fullName: r.fullName, email: r.email ?? null, attendance: r.attendance, partySize: 1 + companions.length,
        primaryMeal: r.attendance === 'yes' ? (r.meal ?? null) : null, primaryDietary: r.dietary ?? null, dietaryTags: r.tags ?? [], extraEvents: r.extra ?? {}, answers: (r.answers ?? {}) as any, message: r.message ?? null,
        source: r.source ?? 'rsvp_form', language: 'en', submittedAt: new Date(Date.UTC(2026, 9, 3 + i, 14, 0)),
        companions: { create: companions.map((c, idx) => ({ type: c.type, fullName: c.fullName, meal: c.meal, dietary: c.dietary ?? null, sort: idx })) },
      },
      include: { companions: true },
    });
    if (r.inv !== undefined) await prisma.invitee.update({ where: { id: invitees[r.inv]!.id }, data: { status: 'responded', respondedAt: g.submittedAt, openCount: 2, lastOpenedAt: g.submittedAt } });
    if (r.attendance === 'yes') guestIds.push({ guestId: g.id, companionIds: g.companions.map((c) => c.id), partySize: g.partySize });
    await prisma.activityLog.create({ data: { eventId: event.id, actorType: r.source === 'manual' ? 'host' : 'guest', action: r.source === 'manual' ? 'guest.added' : 'rsvp.created', data: { guestId: g.id, name: g.fullName, attendance: g.attendance, partySize: g.partySize }, createdAt: g.submittedAt } });
  }

  // Seating
  const tables = [
    { id: randomUUID(), label: 'Head table', shape: 'head' as const, seats: 6, x: 400, y: 80 },
    { id: randomUUID(), label: 'Table 1 · Lakeside', shape: 'round' as const, seats: 8, x: 200, y: 300 },
    { id: randomUUID(), label: 'Table 2 · Orchard', shape: 'round' as const, seats: 8, x: 600, y: 300 },
    { id: randomUUID(), label: 'Table 3 · Meadow', shape: 'rect' as const, seats: 10, x: 400, y: 480 },
  ];
  await prisma.seatingPlan.create({ data: { eventId: event.id, version: 1, layout: [{ id: 'floor-1', kind: 'dance_floor', x: 360, y: 200, w: 180, h: 120, rotation: 0 }, { id: 'bar-1', kind: 'bar', x: 760, y: 120, w: 100, h: 40, rotation: 0 }, { id: 'entrance-1', kind: 'entrance', x: 40, y: 560, w: 80, h: 20, rotation: 0 }] } });
  for (const [i, t] of tables.entries()) await prisma.seatingTable.create({ data: { ...t, eventId: event.id, sort: i } });
  const plan: [number, number][] = [[0, 1], [1, 1], [2, 2], [3, 3]]; // guestIds index → table index (first 4 parties seated)
  for (const [gi, ti] of plan) {
    const party = guestIds[gi];
    if (!party) continue;
    await prisma.seatAssignment.create({ data: { tableId: tables[ti]!.id, guestId: party.guestId } });
    for (const cid of party.companionIds) await prisma.seatAssignment.create({ data: { tableId: tables[ti]!.id, companionId: cid } });
  }
  console.log(`  studio demo event ${event.id} (slug ${DEMO_SLUG})`);
}

async function seedSelfServeDemo(users: Awaited<ReturnType<typeof seedUsers>>) {
  if (await prisma.invitation.findUnique({ where: { slug: 'priya-and-sam' } })) return;
  const theme = await prisma.theme.findUniqueOrThrow({ where: { key: 'citrus' } });
  const event = await prisma.event.create({
    data: {
      product: 'wedding_invite', planCode: null, serviceMode: 'self_serve', title: 'Priya & Sam', hostNames: { partner1: 'Priya', partner2: 'Sam' }, eventDate: new Date('2027-09-11T00:00:00Z'), archiveAfter: new Date('2027-11-11T00:00:00Z'),
      venueName: 'The Glasshouse', venueAddress: '88 Mill St, Ottawa, ON', languages: ['en'], primaryLanguage: 'en', maxRevisionRounds: 0,
      rsvpSettings: { deadline: '2027-08-01', requireEmail: false, mealOptions: ['chicken', 'paneer', 'vegan'], maxCompanions: 2, allowChildren: true, allergyChecklist: true, extraEvents: ['mehndi'], customQuestions: [], mode: 'auto' },
      members: { create: [{ userId: users.diy.id, role: 'owner' }] },
    },
  });
  await prisma.invitation.create({
    data: {
      eventId: event.id, kind: 'wedding_invite', themeId: theme.id, slug: 'priya-and-sam', status: 'draft', locale: 'en', previewToken: token(),
      content: { en: { hero: { title: 'Priya & Sam', dateText: 'September 11, 2027' }, sections: { invitation_text: { heading: 'Save our day', body: 'We would love you to celebrate with us in Ottawa.' }, venue: { items: [{ name: 'The Glasshouse', address: '88 Mill St, Ottawa, ON', startsAt: '17:00' }] }, faq: { rows: [] }, rsvp: { heading: 'RSVP' } } } },
      config: { ...(theme.defaultConfig as object), sectionOrder: ['hero', 'invitation_text', 'venue', 'faq', 'rsvp'], hiddenSections: [] },
    },
  });
  console.log(`  self-serve demo event ${event.id} (draft, unpaid)`);
}

/** Published invitations must have a live snapshot (guests see invitation_versions(publishedVersion)). */
async function ensurePublishedSnapshots() {
  const rows = await prisma.invitation.findMany({ where: { status: { in: ['published', 'archived'] } }, include: { versions: { select: { version: true } } } });
  for (const inv of rows) {
    if (inv.publishedVersion != null && inv.versions.some((v) => v.version === inv.publishedVersion)) continue;
    const version = inv.version + 1;
    await prisma.$transaction([
      prisma.invitationVersion.create({ data: { invitationId: inv.id, version, themeId: inv.themeId, content: inv.content as any, config: inv.config as any } }),
      prisma.invitation.update({ where: { id: inv.id }, data: { version, publishedVersion: version, draftChangedAt: null } }),
    ]);
  }
}

async function seedThemeDemo(users: Awaited<ReturnType<typeof seedUsers>>) {
  const slug = THEME_DEMO_SLUG;
  if (await prisma.invitation.findUnique({ where: { slug } })) return;
  const theme = await prisma.theme.findUniqueOrThrow({ where: { key: 'meadow' } });
  const event = await prisma.event.create({
    data: { product: 'wedding_invite', planCode: 'experience', serviceMode: 'studio', title: 'Iris & Felix', hostNames: { partner1: 'Iris', partner2: 'Felix' }, eventDate: new Date('2027-05-22T00:00:00Z'), archiveAfter: new Date('2099-01-01T00:00:00Z'), venueName: 'Rosehill Conservatory', languages: ['en'], productionStage: 'delivered', adminNote: 'Public demo for the Meadow design. RSVPs are sandboxed.', members: { create: [{ userId: users.admin.id, role: 'owner' }] } },
  });
  await prisma.invitation.create({
    data: {
      eventId: event.id, kind: 'wedding_invite', themeId: theme.id, slug, status: 'published', locale: 'en', publishedAt: new Date(), version: 1,
      content: { en: { hero: { tagline: 'Please join us', title: 'Iris & Felix', dateText: 'May 22, 2027' }, sections: { invitation_text: { heading: 'A spring wedding', body: 'Among the glasshouse roses, with everyone we love.' }, timeline: { heading: 'Programme', rows: [{ time: '14:00', title: 'Ceremony' }, { time: '15:30', title: 'Garden tea' }, { time: '18:00', title: 'Dinner & dancing' }] }, venue: { items: [{ name: 'Rosehill Conservatory', address: '1 Garden Way, Toronto, ON', startsAt: '14:00' }] }, rsvp: { heading: 'Will you join us?' } } } },
      config: { ...(theme.defaultConfig as object), sectionOrder: ['hero', 'invitation_text', 'timeline', 'venue', 'rsvp'], hiddenSections: [] },
    },
  });
}

// Testimonials: SAMPLE copy from design/sample-copy.md. Not real customers; flagged isSample so the UI labels them
// "Sample review". Never verified, never rated. Set SEED_SAMPLE_REVIEWS=false to seed none.
const SAMPLE_REVIEWS = [
  { displayName: 'Aanya & Jordan', location: 'Ottawa', text: 'Our grandparents opened it on their phones without any help, and the replies started arriving that same evening.' },
  { displayName: 'Priya', location: 'Mississauga', text: 'Getting a dinner count for the caterer took me two minutes instead of a week of texting people.' },
  { displayName: 'Lucas & Mei', location: 'Halifax', text: 'Each family got its own link, so we always knew who had seen it and who still needed a nudge.' },
];
// Fabricated "verified" reviews from earlier seeds. Removed wherever they exist.
const LEGACY_FAKE_REVIEW_NAMES = ['Hannah & Omar', 'Chloé & Marc', 'Dev & Anika'];

async function seedReviews() {
  await prisma.review.deleteMany({ where: { displayName: { in: LEGACY_FAKE_REVIEW_NAMES }, orderId: null } });
  if (process.env.SEED_SAMPLE_REVIEWS === 'false') {
    await prisma.review.deleteMany({ where: { isSample: true } });
    return;
  }
  for (const [i, r] of SAMPLE_REVIEWS.entries()) {
    const existing = await prisma.review.findFirst({ where: { isSample: true, displayName: r.displayName } });
    const data = { ...r, isSample: true, published: true };
    if (existing) await prisma.review.update({ where: { id: existing.id }, data });
    else await prisma.review.create({ data: { ...data, createdAt: new Date(Date.UTC(2026, 8, 1 + i)) } });
  }
}

export async function seed() {
  console.log('Seeding catalogue…');
  await seedCatalogue();
  console.log('Seeding users…');
  const users = await seedUsers();
  console.log('Seeding demo data…');
  // Refresh first so an older seeded demo is renamed instead of duplicated.
  await refreshSeededDemos();
  await seedStudioDemo(users);
  await seedSelfServeDemo(users);
  await seedThemeDemo(users);
  await refreshSeededDemos();
  await restyleUncustomisedInvitations();
  await ensurePublishedSnapshots();
  await seedReviews();
  console.log('Seed complete.');
}

export const disconnectSeed = () => prisma.$disconnect();

// Run when executed directly (`npm run db:seed`, `prisma db seed`, `node dist/prisma/seed.js`), not when imported.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seed()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
