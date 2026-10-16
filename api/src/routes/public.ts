import { disabledAddonCodes } from '../lib/features.js';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { BLOCK_SECTIONS, DEFAULT_RSVP_SETTINGS, DIETARY_TAGS, EXTRA_BRIEF_SECTIONS, LANGUAGES, SECTION_LABELS } from '../lib/catalogue.js';
import { notFound } from '../lib/errors.js';
import { PaginationQuery, pageArgs, pageResult } from '../lib/pagination.js';
import { themeDto } from '../lib/serializers.js';
import { LIBRARY_FILE_RE, LIBRARY_MUSIC_PREFIX, publicTrackUrl } from '../lib/music.js';
import { storage } from '../services/storage/index.js';
import { themeProductWhere } from '../lib/themes.js';
import { enqueueMessage } from '../services/messaging/index.js';
import { rl, type ZApp } from './types.js';

const STEPS: Record<string, string[]> = {
  diy: ['theme', 'extras', 'languages', 'info', 'summary'],
  experience: ['theme', 'sections', 'extras', 'languages', 'info', 'summary'],
  premium: ['vision', 'languages', 'info', 'summary'],
  std: ['theme', 'extras', 'info', 'summary'],
  birthday: ['theme', 'extras', 'info', 'summary'],
  bridesmaid: ['extras', 'info', 'summary'],
};

export default async function publicRoutes(app: ZApp) {
  app.get('/api/public/catalogue', { schema: { tags: ['public'], summary: 'Plans, extras, themes, sections and languages' } }, async () => {
    const [plans, extras, themes] = await Promise.all([
      prisma.plan.findMany({ where: { active: true }, orderBy: { sort: 'asc' }, include: { planExtras: true } }),
      prisma.extra.findMany({ where: { active: true }, orderBy: { sort: 'asc' } }),
      prisma.theme.findMany({ where: { status: { in: ['active', 'coming_soon'] } }, orderBy: { sort: 'asc' } }),
    ]);
    // Add-ons switched off by a feature flag (FEATURE_OWN_SONG=false → own_song) are omitted everywhere.
    const off = new Set(disabledAddonCodes());
    return {
      currency: config.CURRENCY,
      taxNote: 'Prices exclude sales tax, which is calculated at checkout.',
      plans: plans.map((p) => ({
        code: p.code,
        product: p.product,
        serviceMode: p.serviceMode,
        name: p.nameI18n,
        description: p.descriptionI18n,
        features: p.features,
        basePriceCents: p.basePriceCents,
        currency: p.currency,
        includedBlocks: p.includedBlocks,
        extraBlockPriceCents: p.extraBlockPriceCents,
        maxLanguages: p.maxLanguages,
        revisionRounds: p.revisionRounds,
        unlimitedRevisions: p.revisionRounds >= 99,
        deliveryDays: p.deliveryDays,
        includesAllExtras: p.includesAllExtras,
        hasRsvp: p.hasRsvp,
        usesSections: p.usesSections,
        steps: STEPS[p.code] ?? ['info', 'summary'],
      })),
      extras: extras.filter((e) => !off.has(e.code)).map((e) => ({ code: e.code, name: e.nameI18n, description: e.descriptionI18n, priceCents: e.priceCents, currency: e.currency, available: e.priceCents != null })),
      planExtras: Object.fromEntries(plans.map((p) => [p.code, p.planExtras.map((pe) => pe.extraCode).filter((c) => !off.has(c))])),
      themes: themes.map(themeDto),
      sections: BLOCK_SECTIONS.map((key) => ({ key, label: SECTION_LABELS[key] })),
      extraBriefSections: Object.fromEntries(Object.entries(EXTRA_BRIEF_SECTIONS).filter(([c]) => !off.has(c))),
      languages: LANGUAGES,
      dietaryTags: DIETARY_TAGS,
      defaultRsvpSettings: DEFAULT_RSVP_SETTINGS,
    };
  });

  app.get('/api/public/themes', { schema: { tags: ['public'], querystring: z.object({ product: z.enum(['wedding_invite', 'save_the_date', 'birthday', 'bridesmaid']).optional() }) } }, async (req) => {
    const themes = await prisma.theme.findMany({ where: { status: { in: ['active', 'coming_soon'] }, ...(req.query.product ? themeProductWhere(req.query.product) : {}) }, orderBy: { sort: 'asc' } });
    return { items: themes.map(themeDto) };
  });

  app.get('/api/public/themes/:key', { schema: { tags: ['public'], params: z.object({ key: z.string().max(80) }) } }, async (req) => {
    const theme = await prisma.theme.findUnique({ where: { key: req.params.key } });
    if (!theme || theme.status === 'retired') throw notFound('Theme');
    return themeDto(theme);
  });

  app.get('/api/public/music', { schema: { tags: ['public'], summary: 'Royalty-free music library' } }, async () => {
    const tracks = await prisma.musicTrack.findMany({ where: { active: true }, orderBy: { title: 'asc' } });
    return { items: tracks.map((t) => ({ id: t.id, title: t.title, artist: t.artist, license: t.license, url: publicTrackUrl(t.url), durationS: t.durationS, moodTags: t.moodTags })) };
  });

  app.get(
    '/api/public/music/files/:file',
    { schema: { tags: ['public'], summary: 'Stream a library track (MP3, supports Range requests)', params: z.object({ file: z.string().regex(LIBRARY_FILE_RE) }) } },
    async (req, reply) => {
      const key = LIBRARY_MUSIC_PREFIX + req.params.file;
      if (!(await storage.exists(key))) throw notFound('Track');
      const buf = await storage.read(key);
      const total = buf.length;
      reply.header('accept-ranges', 'bytes').header('cache-control', 'public, max-age=86400').type('audio/mpeg');
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
      if (range && (range[1] || range[2])) {
        let start = range[1] ? Number(range[1]) : total - Number(range[2]);
        let end = range[1] && range[2] ? Number(range[2]) : total - 1;
        start = Math.max(0, start);
        end = Math.min(end, total - 1);
        if (start > end || start >= total) return reply.code(416).header('content-range', `bytes */${total}`).send();
        return reply.code(206).header('content-range', `bytes ${start}-${end}/${total}`).send(buf.subarray(start, end + 1));
      }
      return reply.send(buf);
    },
  );

  app.get(
    '/api/public/reviews',
    { schema: { tags: ['public'], summary: 'Published testimonials. Sample (placeholder) copy has isSample: true; label it as such. May be empty.', querystring: PaginationQuery } },
    async (req) => {
      const { cursor, limit } = req.query;
      const where = { published: true };
      const [rows, count, sampleCount] = await Promise.all([
        prisma.review.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(cursor, limit) }),
        prisma.review.count({ where }),
        prisma.review.count({ where: { ...where, isSample: true } }),
      ]);
      const page = pageResult(rows, limit);
      // No star ratings, "verified" badges or masked names: just the words, who said them, and whether it's sample copy.
      return {
        items: page.items.map((r) => ({ id: r.id, displayName: r.displayName, location: r.location, text: r.text, isSample: r.isSample, createdAt: r.createdAt })),
        nextCursor: page.nextCursor,
        count,
        onlySamples: count > 0 && sampleCount === count,
      };
    },
  );

  app.post(
    '/api/public/contact',
    {
      config: rl(app, 5, '1 minute'),
      schema: {
        tags: ['public'],
        body: z.object({
          name: z.string().trim().min(1).max(100),
          email: z.string().trim().toLowerCase().email().max(255),
          topic: z.enum(['general', 'partner', 'order', 'press']).default('general'),
          message: z.string().trim().min(5).max(5000),
          consent: z.literal(true),
          website: z.string().max(200).optional(),
        }),
      },
    },
    async (req, reply) => {
      const b = req.body;
      if (b.website) return reply.code(202).send({ ok: true }); // honeypot
      const row = await prisma.contactMessage.create({ data: { name: b.name, email: b.email, topic: b.topic, message: b.message } });
      await enqueueMessage({ to: config.STUDIO_INBOX, template: 'contact_studio', data: b, idempotencyKey: `contact:${row.id}` });
      return reply.code(202).send({ ok: true });
    },
  );
}
