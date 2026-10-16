import { z } from 'zod';
import { DEFAULT_RSVP_SETTINGS, isCustomSection } from './catalogue.js';

const s = (max = 2000) => z.string().trim().max(max);
const rows = <T extends z.ZodTypeAny>(row: T, max = 50) => z.object({ rows: z.array(row).max(max).default([]) }).partial();
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB colour');
const assetRef = z.string().uuid();
const digits = (n: string, label: string) => z.string().trim().regex(new RegExp(`^\\d{${n}}$`), label);

/** Money gifts: Interac e-Transfer email and Canadian bank details; IBAN/BIC optional for international guests. */
export const GiftBankSchema = z
  .object({
    holder: s(120),
    bank: s(120),
    institutionNumber: digits('3', 'Institution number is 3 digits'),
    transitNumber: digits('5', 'Transit number is 5 digits'),
    accountNumber: digits('7,12', 'Account number is 7–12 digits'),
    iban: z
      .string()
      .max(50)
      .transform((v) => v.replace(/\s+/g, '').toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/, 'Invalid IBAN').max(34)),
    bic: z.string().trim().toUpperCase().regex(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/, 'BIC is 8 or 11 characters'),
    reference: s(120),
  })
  .partial()
  .strict();
const httpsUrl = z.string().trim().max(500).url('Use a full https:// link').refine((u) => u.startsWith('https://'), 'Use an https:// link');

/**
 * Gifts are **display-only**: the invitation shows the couple's message, registry links and (optionally) how to
 * send money themselves (Interac email, bank details). We never collect, process or hold money, so unknown keys
 * (e.g. amount, paymentLink, card) are rejected.
 * - `note`: the couple's message (≤1000), optional in every mode.
 * - `cash`/`both` need one complete payout method the guest uses themselves: `interacEmail`, or bank
 *   institution + transit + account numbers, or `bank.iban` → else 422 GIFT_PAYOUT_REQUIRED.
 * - `registries`: registry links (https, ≤10). `registry`/`both` need at least one (or the single `registryUrl`) → 422.
 */
export const GIFT_MESSAGE_MAX = 1000;
export const GiftListSchema = z
  .object({
    mode: z.enum(['cash', 'registry', 'both']),
    note: s(GIFT_MESSAGE_MAX),
    registryUrl: httpsUrl.or(z.literal('')),
    registries: z.array(z.object({ name: s(120).optional(), url: httpsUrl }).strict()).max(10),
    interacEmail: z.string().trim().toLowerCase().email('Invalid email').max(255),
    bank: GiftBankSchema,
  })
  .partial()
  .strict();
export type GiftList = z.infer<typeof GiftListSchema>;

const giftRegistryUrls = (g: GiftList | undefined) => [...(g?.registries ?? []).map((r) => r.url), ...(g?.registryUrl ? [g.registryUrl] : [])];

/**
 * Mode rules for a saved invitation's gift block (drafting in the brief stays lenient).
 * `missingPayout` → 422 GIFT_PAYOUT_REQUIRED, `missingRegistry` → 422 (`gift_list.registries`).
 */
export function giftModeProblems(g: GiftList | undefined) {
  const mode = g?.mode;
  const cash = mode === 'cash' || mode === 'both';
  const b = g?.bank;
  const hasPayout = !!g?.interacEmail?.trim() || !!(b?.institutionNumber && b?.transitNumber && b?.accountNumber) || !!b?.iban;
  return {
    missingPayout: cash && !hasPayout,
    missingRegistry: (mode === 'registry' || mode === 'both') && giftRegistryUrls(g).length === 0,
  };
}

/** Public page: only the display fields of the gift block (never anything else that may be stored). */
export function giftForDisplay(raw: unknown) {
  const g = (raw ?? {}) as Record<string, any>;
  const pick = (o: Record<string, any> | undefined, keys: string[]) => (o && typeof o === 'object' ? Object.fromEntries(keys.filter((k) => o[k] != null && o[k] !== '').map((k) => [k, o[k]])) : undefined);
  const bank = pick(g.bank, ['holder', 'bank', 'institutionNumber', 'transitNumber', 'accountNumber', 'iban', 'bic', 'reference']);
  return {
    ...pick(g, ['heading', 'mode', 'note', 'interacEmail']),
    registries: [...(Array.isArray(g.registries) ? g.registries : []).filter((r: any) => typeof r?.url === 'string').map((r: any) => pick(r, ['name', 'url'])), ...(g.registryUrl ? [{ url: g.registryUrl }] : [])],
    ...(bank && Object.keys(bank).length ? { bank } : {}),
  };
}

/** Invitation slug rules (custom_link): 3–60 chars, lowercase letters, digits and dashes, no leading/trailing dash. */
/** Normalise a link name: lowercase, collapse runs of hyphens into one, strip leading/trailing hyphens. */
export const normalizeSlug = (v: string) => v.trim().toLowerCase().replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
export const SlugSchema = z
  .string()
  .max(200)
  .transform(normalizeSlug)
  .pipe(z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/, 'Use 3–60 lowercase letters, numbers and dashes'));

export const RsvpSettingsSchema = z
  .object({
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    requireEmail: z.boolean(),
    mealOptions: z.array(s(40).min(1)).max(10),
    maxCompanions: z.number().int().min(0).max(19),
    allowChildren: z.boolean(),
    allergyChecklist: z.boolean(),
    extraEvents: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).max(10),
    customQuestions: z
      .array(z.object({ id: z.string().regex(/^[a-z0-9_]{1,40}$/), label: s(200).min(1), type: z.enum(['text', 'yes_no']), required: z.boolean().optional() }))
      .max(10),
    mode: z.enum(['auto', 'open', 'closed']),
  })
  .partial();

/** Brief data schemas per section (all fields optional while drafting; completion rules decide "done"). */
export const BriefSectionSchemas: Record<string, z.ZodTypeAny> = {
  our_story: z.object({ text: s(5000), milestones: z.array(z.object({ year: s(10), title: s(120), text: s(1000), photo: assetRef.optional() })).max(20) }).partial(),
  timeline: rows(z.object({ time: s(10), title: s(120), description: s(500).optional() })),
  pre_wedding: z.object({ date: s(20), location: s(300), details: s(2000) }).partial(),
  menu: z.object({ main: s(500), courses: s(2000) }).partial(),
  dress_code: z.object({ text: s(2000), palette: z.array(colour).max(8) }).partial(),
  accommodation: rows(z.object({ name: s(120), address: s(300), url: s(500).optional(), note: s(300).optional() })),
  transport: rows(z.object({ type: s(60), time: s(10), from: s(200).optional(), to: s(200).optional(), note: s(300).optional() })),
  activities: rows(z.object({ name: s(120), date: s(40), details: s(1000).optional() })),
  gift_list: GiftListSchema,
  photos: z.object({ intro: s(500), rows: z.array(z.object({ assetId: assetRef, name: s(200).optional() })).max(30) }).partial(),
  countdown: z.object({ startAt: s(30) }).partial(),
  faq: rows(z.object({ question: s(300), answer: s(2000) })),
  // Add-on brief sections (see src/lib/addons.ts)
  own_song: z.object({ description: s(500), url: z.string().trim().url().max(500).or(z.literal('')), assetId: assetRef.nullable(), libraryTrackId: z.string().uuid().nullable(), rightsConfirmed: z.boolean() }).partial(),
  custom_monogram: z.object({ letters: s(6), glowColor: colour, note: s(500) }).partial(),
  photo_cover_film: z.object({ description: s(2000), photos: z.array(assetRef).max(10) }).partial(),
  custom_link: z.object({ slug: SlugSchema.or(z.literal('')), note: s(300) }).partial(),
  rsvp: RsvpSettingsSchema,
};
export const CustomBlockSchema = z.object({ content: s(5000) }).partial();

export function briefSectionSchema(key: string): z.ZodTypeAny | null {
  if (isCustomSection(key)) return CustomBlockSchema;
  return BriefSectionSchemas[key] ?? null;
}

const filled = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
type Rows = { rows?: Record<string, unknown>[] };
const rowsOk = (d: Rows | undefined, req: string[]) => !!d?.rows?.length && d.rows.every((r) => req.every((k) => filled(r[k])));

/** Completion rules per brief section. */
export function isSectionComplete(key: string, data: any): boolean {
  if (key === 'rsvp') return true;
  if (isCustomSection(key)) return filled(data?.content);
  switch (key) {
    case 'our_story':
      return typeof data?.text === 'string' && data.text.trim().length >= 20;
    case 'timeline':
      return rowsOk(data, ['time', 'title']);
    case 'transport':
      return rowsOk(data, ['type', 'time']);
    case 'activities':
      return rowsOk(data, ['name', 'date']);
    case 'accommodation':
      return rowsOk(data, ['name', 'address']);
    case 'faq':
      return rowsOk(data, ['question', 'answer']);
    case 'pre_wedding':
      return filled(data?.date) && filled(data?.location);
    case 'dress_code':
      return filled(data?.text);
    case 'menu':
      return filled(data?.main);
    case 'photos':
      return Array.isArray(data?.rows) && data.rows.length >= 1;
    case 'countdown':
      return filled(data?.startAt);
    case 'gift_list':
      if (data?.mode) {
        const p = giftModeProblems(data);
        return !p.missingPayout && !p.missingRegistry;
      }
      return filled(data?.registryUrl) || (Array.isArray(data?.registries) && data.registries.length > 0) || filled(data?.interacEmail) || filled(data?.bank?.accountNumber) || filled(data?.bank?.iban) || filled(data?.note);
    case 'own_song':
      return filled(data?.description) || filled(data?.url) || !!data?.assetId || !!data?.libraryTrackId;
    case 'custom_monogram':
      return filled(data?.letters);
    case 'custom_link':
      return filled(data?.slug);
    case 'photo_cover_film':
      return Array.isArray(data?.photos) && data.photos.length >= 1;
    default:
      return false;
  }
}

export function briefCompletion(sections: string[], data: Record<string, unknown>) {
  const missing = sections.filter((k) => !isSectionComplete(k, data[k]));
  return { done: sections.length - missing.length, total: sections.length, missing };
}

export function defaultBriefSections(blocks: string[], extras: string[], extraMap: Record<string, string>, hasRsvp: boolean) {
  const out = [...blocks];
  for (const e of extras) if (extraMap[e] && !out.includes(extraMap[e]!)) out.push(extraMap[e]!);
  if (hasRsvp) out.push('rsvp');
  return out;
}

export function mergedRsvpSettings(raw: unknown) {
  return { ...DEFAULT_RSVP_SETTINGS, ...((raw as object) ?? {}) } as typeof DEFAULT_RSVP_SETTINGS;
}
