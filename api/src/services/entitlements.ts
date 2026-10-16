import type { Event, Invitation, Plan } from '@prisma/client';
import { prisma } from '../db.js';
import { addonByCode, CUSTOM_LINK_ADDON, EXTRA_LANGUAGE_ADDON, extraLanguageCount, OWN_SONG_ADDON } from '../lib/addons.js';
import { AppError } from '../lib/errors.js';

/**
 * What an event may use: its plan (self-serve drafts count as `diy`), the add-ons bought on paid orders
 * (plan + add-on-only orders) and, before a self-serve event is paid, the add-ons the host has selected.
 */
export interface Entitlements {
  plan: Plan | null;
  paid: boolean;
  /** Add-on codes on paid orders (repeatable add-ons appear once per unit). */
  purchased: string[];
  /** Self-serve picks before paying (charged at pay-to-publish). */
  selected: string[];
  /** Plan language limit + one per extra_language (purchased, or selected while unpaid). */
  languageLimit: number;
  /** True when the add-on is bought, included in the plan, or selected on an unpaid self-serve draft. */
  has(code: string): boolean;
}

export async function paidExtras(eventId: string) {
  const orders = await prisma.order.findMany({ where: { eventId, status: 'paid' }, select: { extras: true } });
  return orders.flatMap((o) => o.extras);
}

export async function entitlements(event: Pick<Event, 'id' | 'planCode' | 'serviceMode' | 'paidAt' | 'selectedExtras'>): Promise<Entitlements> {
  const planCode = event.planCode ?? (event.serviceMode === 'self_serve' ? 'diy' : null);
  const plan = planCode ? await prisma.plan.findUnique({ where: { code: planCode } }) : null;
  const paid = !!event.paidAt;
  const purchased = await paidExtras(event.id);
  const selected = paid ? [] : (event.selectedExtras ?? []);
  const effective = [...purchased, ...selected];
  return {
    plan,
    paid,
    purchased,
    selected,
    languageLimit: (plan?.maxLanguages ?? 1) + extraLanguageCount(effective),
    has: (code) => effective.includes(code) || (!!plan?.includesAllExtras && code !== EXTRA_LANGUAGE_ADDON && !!addonByCode(code)),
  };
}

/** Add an add-on to an unpaid self-serve draft's selection (the pay dialog then charges it). */
export async function selectExtra(eventId: string, current: string[], code: string) {
  if (current.includes(code)) return current;
  const next = [...current, code];
  await prisma.event.update({ where: { id: eventId }, data: { selectedExtras: next } });
  return next;
}

export interface AddonNeed {
  code: string;
  qty: number;
}

/**
 * Add-ons the event's invitation draft actually uses: a custom song (own_song), a renamed link (custom_link)
 * and languages over the plan limit (extra_language × n).
 */
export async function addonsInUse(
  event: Pick<Event, 'id' | 'languages'>,
  plan: Pick<Plan, 'maxLanguages'> | null,
  inv?: Pick<Invitation, 'id' | 'config'> | null,
): Promise<AddonNeed[]> {
  const out: AddonNeed[] = [];
  const music = ((inv?.config as any)?.music ?? {}) as { assetId?: string | null; externalUrl?: string | null };
  if (music.assetId || music.externalUrl) out.push({ code: OWN_SONG_ADDON, qty: 1 });
  if (inv && (await prisma.invitationSlugRedirect.count({ where: { invitationId: inv.id } }))) out.push({ code: CUSTOM_LINK_ADDON, qty: 1 });
  const over = event.languages.length - (plan?.maxLanguages ?? 1);
  if (over > 0) out.push({ code: EXTRA_LANGUAGE_ADDON, qty: over });
  return out;
}

/** What the draft uses but isn't covered (bought, included in the plan, or selected before paying). */
export async function missingAddons(
  event: Pick<Event, 'id' | 'planCode' | 'serviceMode' | 'paidAt' | 'selectedExtras' | 'languages'>,
  inv?: Pick<Invitation, 'id' | 'config'> | null,
): Promise<AddonNeed[]> {
  const ent = await entitlements(event);
  const missing: AddonNeed[] = [];
  for (const n of await addonsInUse(event, ent.plan, inv)) {
    if (n.code === EXTRA_LANGUAGE_ADDON) {
      const short = n.qty - extraLanguageCount([...ent.purchased, ...ent.selected]);
      if (short > 0) missing.push({ code: n.code, qty: short });
    } else if (!ent.has(n.code)) missing.push(n);
  }
  return missing;
}

/** 402 ADDON_PAYMENT_REQUIRED: the client opens the add-ons checkout (POST /api/checkout/addons) for `details.missing`. */
export function addonPaymentRequired(eventId: string, missing: AddonNeed[], message?: string) {
  const first = missing[0]!;
  return new AppError(
    402,
    'ADDON_PAYMENT_REQUIRED',
    message ?? `Your invitation uses add-ons that aren't paid yet (${missing.map((m) => (m.qty > 1 ? `${m.qty}× ${m.code}` : m.code)).join(', ')}). Add them with the add-ons checkout.`,
    undefined,
    { addon: first.code, eventId, checkout: '/api/checkout/addons', missing },
  );
}
