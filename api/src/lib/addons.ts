/**
 * Add-on catalogue: the single place to change the add-on set.
 *
 * Source: design/sample-copy.md and design-review.md O1 (Product Designer).
 * All prices are CAD PLACEHOLDERS until pricing is confirmed.
 *
 * To swap the set: edit ADDONS (and RETIRED_ADDON_CODES for anything you remove), then run
 * `npm run db:seed`. The seed upserts these rows, rebuilds the plan ↔ add-on links and deletes retired
 * codes. Behaviour hooks (extra language, rush) look add-ons up by `effect`, not by code.
 */
import type { PlanCode } from '@prisma/client';

export type AddonEffect =
  | 'brief_section' // adds a brief section the host fills in (see `briefSection`)
  | 'extra_language' // +1 language over the plan's limit
  | 'rush' // priority production (sets event.express)
  | 'custom_link' // host may choose the invitation slug (self-serve editor; studio: brief section)
  | 'none'; // recorded on the order only

export interface AddonDef {
  code: string;
  name: string;
  description: string;
  /** CAD cents. Placeholder. */
  priceCents: number;
  effect: AddonEffect;
  /** Brief section key added when bought (effect = brief_section). */
  briefSection?: string;
  /** Plans that can buy it. */
  plans: PlanCode[];
  /** Can be bought more than once (each unit counts). Default: once per event. */
  repeatable?: boolean;
  sort: number;
}

export const ADDON_PRICES_ARE_PLACEHOLDERS = true;

export const ADDONS: AddonDef[] = [
  {
    code: 'own_song',
    name: 'Your own song',
    description: 'Pick a track from our royalty-free library or upload one you hold the rights to. It plays after a guest taps to open.',
    priceCents: 1500,
    effect: 'brief_section',
    briefSection: 'own_song',
    plans: ['diy', 'std', 'experience', 'premium', 'birthday', 'bridesmaid'],
    sort: 1,
  },
  {
    code: 'custom_monogram',
    name: 'Custom monogram',
    description: 'Your initials drawn as a monogram that lights up the opening and the footer.',
    priceCents: 2500,
    effect: 'brief_section',
    briefSection: 'custom_monogram',
    plans: ['std', 'experience', 'premium', 'birthday', 'bridesmaid'],
    sort: 2,
  },
  {
    code: 'extra_language',
    name: 'Extra language',
    description: 'One more language on top of what your plan includes, so every guest can read it in theirs.',
    priceCents: 2000,
    effect: 'extra_language',
    plans: ['diy', 'std', 'experience', 'premium', 'birthday', 'bridesmaid'],
    repeatable: true,
    sort: 3,
  },
  {
    code: 'photo_cover_film',
    name: 'Photo cover film',
    description: 'Send us up to 10 photos and we turn them into a short moving cover guests see before opening.',
    priceCents: 4500,
    effect: 'brief_section',
    briefSection: 'photo_cover_film',
    plans: ['std', 'experience', 'premium', 'birthday'],
    sort: 4,
  },
  {
    code: 'rush_design',
    name: 'Rush design',
    description: 'We move your invitation to the front of the studio queue: first draft in 2–3 business days.',
    priceCents: 6900,
    effect: 'rush',
    plans: ['std', 'experience', 'premium', 'birthday', 'bridesmaid'],
    sort: 6,
  },
  {
    code: 'custom_link',
    name: 'Custom link name',
    description: 'Choose the address of your invitation, like /i/maya-and-theo. Old links keep working if you change it.',
    priceCents: 1900,
    effect: 'custom_link',
    briefSection: 'custom_link',
    plans: ['diy', 'std', 'experience', 'premium', 'birthday', 'bridesmaid'],
    sort: 7,
  },
];

/** Codes from the earlier, reference-derived set. The seed deletes them; checkout rejects them. */
export const RETIRED_ADDON_CODES = ['custom_music', 'wax_seal', 'custom_color', 'illustration', 'animated_video', 'express', 'custom_domain', 'reminder_pack'] as const;

export const addonByCode = (code: string) => ADDONS.find((a) => a.code === code);
const codesWith = (effect: AddonEffect) => ADDONS.filter((a) => a.effect === effect).map((a) => a.code);

/** Brief sections added automatically when the matching add-on is bought: { addonCode: briefSectionKey }. */
export const EXTRA_BRIEF_SECTIONS: Record<string, string> = Object.fromEntries(ADDONS.filter((a) => a.briefSection).map((a) => [a.code, a.briefSection!]));
export const isRushAddon = (code: string) => codesWith('rush').includes(code);
export const extraLanguageCount = (codes: string[]) => codes.filter((c) => codesWith('extra_language').includes(c)).length;
export const isRepeatableAddon = (code: string) => !!addonByCode(code)?.repeatable;
export const CUSTOM_LINK_ADDON = 'custom_link';
export const OWN_SONG_ADDON = 'own_song';
export const EXTRA_LANGUAGE_ADDON = 'extra_language';
