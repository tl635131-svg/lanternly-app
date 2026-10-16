import { z } from 'zod';
import { BriefSectionSchemas, CustomBlockSchema } from './brief.js';
import { CORE_SECTIONS, EXTRA_BRIEF_SECTIONS, isCustomSection } from './catalogue.js';

/**
 * Theme engine: an invitation = theme (designer skin, keyed) + config (visual knobs) + content (per-language JSON).
 * The front end renders every invitation from these three inputs — no per-couple code.
 */
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const s = (max = 2000) => z.string().trim().max(max);

export const InvitationConfigSchema = z
  .object({
    palette: z.object({ background: colour, surface: colour, primary: colour, onPrimary: colour, accent: colour, glow: colour, text: colour, muted: colour }).partial().strict(),
    fonts: z.object({ display: s(60), body: s(60), script: s(60) }).partial(),
    cover: z
      .object({
        type: z.enum(['glow', 'photo', 'none']),
        initials: s(6),
        glowColor: colour,
        posterAssetId: z.string().uuid().nullable(),
        mediaAssetId: z.string().uuid().nullable(),
      })
      .partial()
      .strict(), // rejects retired keys such as envelopeColor / sealColor
    opening: z.object({ animation: z.string().regex(/^[a-z0-9_-]{1,40}$/), durationMs: z.number().int().min(0).max(10000) }).partial(),
    music: z
      .object({
        trackId: z.string().uuid().nullable(),
        assetId: z.string().uuid().nullable(),
        /** Own-song link (needs a music rights confirmation). */
        externalUrl: z.string().trim().url().max(500).regex(/^https:\/\//, 'Use an https:// link').nullable(),
        volume: z.number().min(0).max(1),
        autoplayOnOpen: z.boolean(),
      })
      .partial(),
    sectionOrder: z.array(z.string().max(80)).max(40),
    hiddenSections: z.array(z.string().max(80)).max(40),
  })
  .partial()
  .strict();
export type InvitationConfig = z.infer<typeof InvitationConfigSchema>;

const heading = { heading: s(200).optional() };
const VenueItem = z.object({
  label: s(80).optional(),
  name: s(200),
  address: s(400).optional(),
  startsAt: s(40).optional(),
  endsAt: s(40).optional(),
  mapQuery: s(400).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  note: s(1000).optional(),
});

export const ContentSectionSchemas: Record<string, z.ZodTypeAny> = {
  invitation_text: z.object({ ...heading, body: s(5000).optional() }),
  venue: z.object({ ...heading, items: z.array(VenueItem).max(10).default([]) }),
  rsvp: z.object({ ...heading, intro: s(1000).optional(), thankYouYes: s(1000).optional(), thankYouNo: s(1000).optional() }),
};
for (const [key, schema] of Object.entries(BriefSectionSchemas)) {
  if (key === 'rsvp' || Object.values(EXTRA_BRIEF_SECTIONS).includes(key)) continue;
  ContentSectionSchemas[key] = (schema as z.ZodObject<any>).extend(heading);
}
export const CustomContentSchema = CustomBlockSchema.extend({ title: s(120).optional() });

export const HeroSchema = z.object({ tagline: s(200), title: s(200), subtitle: s(300), dateText: s(120), backgroundAssetId: z.string().uuid().nullable() }).partial();

export const LocaleContentSchema = z
  .object({
    hero: HeroSchema.optional(),
    sections: z
      .record(z.string().max(80), z.unknown())
      .default({})
      .superRefine((sections, ctx) => {
        for (const [key, value] of Object.entries(sections)) {
          const schema = isCustomSection(key) ? CustomContentSchema : ContentSectionSchemas[key];
          if (!schema) {
            ctx.addIssue({ code: 'custom', path: [key], message: `Unknown section "${key}"` });
            continue;
          }
          const r = schema.safeParse(value);
          if (!r.success) for (const issue of r.error.issues) ctx.addIssue({ ...issue, path: [key, ...issue.path] } as any);
        }
      }),
    footer: z.object({ signature: s(200) }).partial().optional(),
  })
  .strict();

export const InvitationContentSchema = z
  .record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$|^x-[a-z0-9-]{1,20}$/, 'Language code like "en" or "fr-CA"'), LocaleContentSchema)
  .refine((v) => JSON.stringify(v).length <= 300_000, 'Content is too large (300 KB max)');
export type InvitationContent = z.infer<typeof InvitationContentSchema>;

export const CONTENT_SECTION_KEYS = Object.keys(ContentSectionSchemas);

type EventLike = {
  title: string;
  hostNames: any;
  eventDate: Date | null;
  venueName: string | null;
  venueAddress: string | null;
  primaryLanguage: string;
  product: string;
};

function formatDate(d: Date | null, locale: string) {
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Starter content for a new invitation (self-serve or studio), in the primary language. */
export function starterContent(event: EventLike, blocks: string[]): InvitationContent {
  const lang = event.primaryLanguage;
  const sections: Record<string, unknown> = {
    invitation_text: { heading: 'You are invited', body: '' },
    venue: { heading: 'Where & when', items: event.venueName ? [{ label: 'Celebration', name: event.venueName, address: event.venueAddress ?? undefined, mapQuery: [event.venueName, event.venueAddress].filter(Boolean).join(', ') }] : [] },
  };
  for (const b of blocks) if (ContentSectionSchemas[b] && !sections[b]) sections[b] = {};
  if (event.product !== 'save_the_date') sections.rsvp = { heading: 'Kindly reply' };
  return {
    [lang]: {
      hero: { title: event.title, dateText: formatDate(event.eventDate, lang) },
      sections,
    },
  } as InvitationContent;
}

export function starterConfig(themeDefault: unknown, blocks: string[], product: string): InvitationConfig {
  const base = (themeDefault as InvitationConfig) ?? {};
  const order = ['hero', 'invitation_text', ...blocks.filter((b) => !Object.values(EXTRA_BRIEF_SECTIONS).includes(b) && b !== 'rsvp'), 'venue'];
  if (product !== 'save_the_date') order.push('rsvp');
  return { ...base, sectionOrder: order, hiddenSections: [] };
}

/** Map a completed brief into invitation content/config (studio "generate draft" helper). */
export function contentFromBrief(event: EventLike, brief: { sections: string[]; data: any; customBlockNames: any }, current: { content: any; config: any }) {
  const lang = event.primaryLanguage;
  const content = structuredClone(current.content ?? {}) as Record<string, any>;
  const config = structuredClone(current.config ?? {}) as InvitationConfig;
  const locale = (content[lang] ??= { sections: {} });
  locale.sections ??= {};
  locale.hero = { ...(locale.hero ?? {}), title: locale.hero?.title ?? event.title, dateText: locale.hero?.dateText ?? formatDate(event.eventDate, lang) };
  const data = brief.data ?? {};
  for (const key of brief.sections) {
    const d = data[key];
    if (!d) continue;
    if (isCustomSection(key)) {
      locale.sections[key] = { title: brief.customBlockNames?.[key] ?? key.slice(7), content: d.content ?? '' };
    } else if (ContentSectionSchemas[key] && key !== 'rsvp') {
      locale.sections[key] = { ...(locale.sections[key] ?? {}), ...d };
    }
  }
  if (data.custom_monogram?.letters) {
    config.cover = { ...(config.cover ?? {}), type: config.cover?.type ?? 'glow', initials: data.custom_monogram.letters, ...(data.custom_monogram.glowColor ? { glowColor: data.custom_monogram.glowColor } : {}) };
  }
  if (data.photo_cover_film?.photos?.length) {
    // The studio renders the film from these photos; until then the first photo is the cover poster.
    config.cover = { ...(config.cover ?? {}), posterAssetId: config.cover?.posterAssetId ?? data.photo_cover_film.photos[0] };
  }
  if (data.own_song?.libraryTrackId || data.own_song?.assetId) {
    config.music = { ...(config.music ?? {}), trackId: data.own_song.libraryTrackId ?? null, assetId: data.own_song.assetId ?? null, volume: config.music?.volume ?? 0.6, autoplayOnOpen: true };
  }
  const blocks = brief.sections.filter((k) => k !== 'rsvp' && !Object.values(EXTRA_BRIEF_SECTIONS).includes(k));
  const order = ['hero', 'invitation_text', ...blocks, 'venue'];
  if (event.product !== 'save_the_date') order.push('rsvp');
  config.sectionOrder = order;
  return { content: content as InvitationContent, config };
}

/** Collect every uuid referenced anywhere in content/config (asset ids for signed URL resolution). */
export function collectUuids(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) out.add(value);
  } else if (Array.isArray(value)) value.forEach((v) => collectUuids(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectUuids(v, out));
  return out;
}

export { CORE_SECTIONS };
