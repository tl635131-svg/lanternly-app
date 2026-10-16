import type { Plan } from '@prisma/client';
import { prisma } from '../db.js';
import { BLOCK_SECTIONS, LANGUAGES } from '../lib/catalogue.js';
import { AppError, conflict, unprocessable, validation } from '../lib/errors.js';
import { assertAddonsEnabled } from '../lib/features.js';
import { slugify } from '../lib/slug.js';
import { EXTRA_LANGUAGE_ADDON, extraLanguageCount, isRepeatableAddon, isRushAddon } from '../lib/addons.js';
import { themeFitsProduct } from '../lib/themes.js';

export interface QuoteInput {
  plan: string;
  themeKey?: string | null;
  sections?: string[];
  extras?: string[];
  languages?: string[];
  /** Admin manual sales may be priced before a design is chosen. */
  requireTheme?: boolean;
}
export interface QuoteLine {
  kind: 'plan' | 'extra' | 'extra_block';
  code: string;
  label: string;
  qty: number;
  unitPriceCents: number;
  totalCents: number;
  included?: boolean;
}

const LANGUAGE_CODES = new Set<string>(LANGUAGES.map((l) => l.code));
const name = (i18n: unknown, lang = 'en') => ((i18n as Record<string, string>)?.[lang] ?? Object.values((i18n as object) ?? {})[0] ?? '') as string;

/** Normalise "custom:Kids corner" → "custom:kids-corner" and validate block keys. */
export function normalizeSections(sections: string[]) {
  const out: string[] = [];
  const customNames: Record<string, string> = {};
  for (const raw of sections) {
    const s = raw.trim();
    if (s.startsWith('custom:')) {
      const label = s.slice(7).trim();
      if (!label || label.length > 60) throw unprocessable('INVALID_SELECTION', 'Custom block names must be 1–60 characters.', { sections: s });
      const key = `custom:${slugify(label) || 'block'}`;
      if (!out.includes(key)) {
        out.push(key);
        customNames[key] = label;
      }
    } else if ((BLOCK_SECTIONS as readonly string[]).includes(s)) {
      if (!out.includes(s)) out.push(s);
    } else {
      throw unprocessable('INVALID_SELECTION', `Unknown section "${s}".`, { sections: s });
    }
  }
  if (out.length > 30) throw unprocessable('INVALID_SELECTION', 'Too many sections (30 max).');
  return { sections: out, customNames };
}

/**
 * Add-on codes from a request: repeatable add-ons (extra_language) keep one entry per unit;
 * others are de-duplicated. Order of first appearance is kept.
 */
export function normalizeExtras(codes: string[]) {
  const out: string[] = [];
  for (const c of codes) if (isRepeatableAddon(c) || !out.includes(c)) out.push(c);
  return out;
}

/** Keep at most `max` extra_language units (excess units are trimmed quietly; other codes untouched). */
export function trimExtraLanguages(codes: string[], max: number) {
  let kept = 0;
  return codes.filter((c) => c !== EXTRA_LANGUAGE_ADDON || kept++ < Math.max(0, max));
}

/** Couture ("all add-ons included") covers every add-on except extra_language, which is always charged per unit. */
export const includedInPlan = (plan: Pick<Plan, 'includesAllExtras'>, code: string) => plan.includesAllExtras && code !== EXTRA_LANGUAGE_ADDON;

/** One quote line per add-on code, with qty for repeatable ones. */
function extraLines(extras: string[], allowed: Map<string, { nameI18n: unknown; priceCents: number | null }>, plan: Pick<Plan, 'includesAllExtras'>): QuoteLine[] {
  const lines: QuoteLine[] = [];
  for (const e of [...new Set(extras)]) {
    const extra = allowed.get(e)!;
    const qty = extras.filter((x) => x === e).length;
    const included = includedInPlan(plan, e);
    const unit = included ? 0 : extra.priceCents!;
    lines.push({ kind: 'extra', code: e, label: name(extra.nameI18n), qty, unitPriceCents: unit, totalCents: unit * qty, ...(included ? { included: true } : {}) });
  }
  return lines;
}

/**
 * Add-on-only purchase for an already paid event (e.g. own song or a custom link after publishing).
 * Spec errors: empty → 400; not offered on the plan / retired / included in the plan / rush after delivery → 422
 * INVALID_SELECTION; a non-repeatable add-on already bought → 409 CONFLICT; switched off by a flag → 403.
 */
export async function computeAddonQuote(input: { planCode: Plan['code']; extras: string[]; owned: string[]; delivered?: boolean; languages: string[] }) {
  const plan = await prisma.plan.findUnique({ where: { code: input.planCode }, include: { planExtras: { include: { extra: true } } } });
  if (!plan) throw unprocessable('INVALID_SELECTION', 'This plan is not available.', { plan: 'Unknown plan' });
  const allowed = new Map(plan.planExtras.filter((pe) => pe.extra.active && pe.extra.priceCents != null).map((pe) => [pe.extraCode, pe.extra]));
  // extra_language: only the units the languages still need (languages − plan cap − units already paid); excess is trimmed.
  const needed = new Set(input.languages).size - plan.maxLanguages - extraLanguageCount(input.owned);
  const extras = trimExtraLanguages(normalizeExtras(input.extras), needed);
  // Too few units for the languages (sent list, or the event's own) → 422 like pay-to-publish; nothing is saved or charged.
  const short = needed - extraLanguageCount(extras);
  if (short > 0) {
    throw new AppError(422, 'INVALID_SELECTION', `Your languages need ${needed} extra language unit(s); add ${short} more.`, { 'extras.extra_language': 'Required' }, { missing: [{ code: EXTRA_LANGUAGE_ADDON, qty: short }] });
  }
  if (!extras.length) throw validation('Choose at least one add-on.', { extras: 'Required' });
  assertAddonsEnabled(extras);
  for (const e of extras) {
    if (!allowed.has(e)) throw unprocessable('INVALID_SELECTION', `Extra "${e}" is not available for this plan.`, { extras: e });
    if (includedInPlan(plan, e)) throw unprocessable('INVALID_SELECTION', `"${e}" is already included in your plan.`, { extras: e });
    if (isRushAddon(e) && input.delivered) throw unprocessable('INVALID_SELECTION', 'Your invitation has already been delivered, so rush design no longer applies.', { extras: e });
    if (!isRepeatableAddon(e) && input.owned.includes(e)) throw conflict('CONFLICT', `You already have "${e}".`, { extras: e });
  }
  const lines = extraLines(extras, allowed, plan);
  return { plan, extras, lines, subtotalCents: lines.reduce((sum, l) => sum + l.totalCents, 0), currency: plan.currency, express: extras.some(isRushAddon) };
}

/** Server-side price computation — the only source of truth for what is charged. */
export async function computeQuote(input: QuoteInput) {
  const plan = await prisma.plan.findUnique({ where: { code: input.plan as Plan['code'] }, include: { planExtras: { include: { extra: true } } } });
  if (!plan || !plan.active) throw unprocessable('INVALID_SELECTION', 'This plan is not available.', { plan: 'Unknown plan' });

  let theme = null;
  if (input.themeKey) {
    theme = await prisma.theme.findUnique({ where: { key: input.themeKey } });
    if (!theme || theme.status === 'retired') throw unprocessable('INVALID_SELECTION', 'This design is not available.', { themeKey: 'Unknown design' });
    if (!themeFitsProduct(theme, plan.product)) throw unprocessable('INVALID_SELECTION', 'This design is not available for the selected plan.', { themeKey: 'Wrong product' });
  } else if (input.requireTheme !== false && !['premium', 'bridesmaid'].includes(plan.code)) {
    throw unprocessable('INVALID_SELECTION', 'Please choose a design.', { themeKey: 'Required' });
  }

  const { sections, customNames } = plan.usesSections ? normalizeSections(input.sections ?? []) : { sections: [], customNames: {} };
  if (!plan.usesSections && (input.sections?.length ?? 0) > 0) throw unprocessable('INVALID_SELECTION', 'This plan does not include information blocks.', { sections: 'Not applicable' });

  const allowed = new Map(plan.planExtras.filter((pe) => pe.extra.active && pe.extra.priceCents != null).map((pe) => [pe.extraCode, pe.extra]));
  let extras = normalizeExtras(input.extras ?? []);
  for (const e of extras) if (!allowed.has(e)) throw unprocessable('INVALID_SELECTION', `Extra "${e}" is not available for this plan.`, { extras: e });
  assertAddonsEnabled(extras);

  const languages = [...new Set((input.languages?.length ? input.languages : ['en']).map((l) => l.trim()))];
  // Each "extra language" add-on raises the plan's language limit by one. Units beyond what the languages need are trimmed.
  extras = trimExtraLanguages(extras, languages.length - plan.maxLanguages);
  const maxLanguages = plan.maxLanguages + extraLanguageCount(extras);
  if (languages.length > maxLanguages) {
    throw unprocessable('INVALID_SELECTION', `This plan includes up to ${plan.maxLanguages} language(s)${maxLanguages > plan.maxLanguages ? ` (${maxLanguages} with the extra language add-on)` : ''}.`, { languages: 'Too many' });
  }
  for (const l of languages) if (!LANGUAGE_CODES.has(l) && !/^x-[a-z0-9-]{1,20}$/.test(l)) throw unprocessable('INVALID_SELECTION', `Unsupported language "${l}".`, { languages: l });

  const lines: QuoteLine[] = [{ kind: 'plan', code: plan.code, label: name(plan.nameI18n), qty: 1, unitPriceCents: plan.basePriceCents, totalCents: plan.basePriceCents }];
  if (plan.includedBlocks != null && !plan.includesAllExtras) {
    const extraBlocks = Math.max(0, sections.length - plan.includedBlocks);
    if (extraBlocks > 0) lines.push({ kind: 'extra_block', code: 'extra_block', label: 'Additional information block', qty: extraBlocks, unitPriceCents: plan.extraBlockPriceCents, totalCents: extraBlocks * plan.extraBlockPriceCents });
  }
  lines.push(...extraLines(extras, allowed, plan));
  const subtotalCents = lines.reduce((sum, l) => sum + l.totalCents, 0);
  return {
    plan,
    theme,
    sections,
    customNames,
    extras,
    languages,
    express: extras.some(isRushAddon) || plan.code === 'premium',
    lines,
    subtotalCents,
    currency: plan.currency,
  };
}

export function publicQuote(q: Awaited<ReturnType<typeof computeQuote>>) {
  return {
    plan: q.plan.code,
    themeKey: q.theme?.key ?? null,
    sections: q.sections,
    extras: q.extras,
    languages: q.languages,
    lines: q.lines,
    subtotalCents: q.subtotalCents,
    currency: q.currency,
    taxNote: 'Sales tax is calculated at checkout based on your billing address.',
  };
}
