/** Static catalogue definitions shared by checkout, brief and the theme engine. */

export const BLOCK_SECTIONS = [
  'our_story',
  'timeline',
  'pre_wedding',
  'menu',
  'dress_code',
  'accommodation',
  'transport',
  'activities',
  'gift_list',
  'photos',
  'countdown',
  'faq',
] as const;
export type BlockSection = (typeof BLOCK_SECTIONS)[number];

/** Brief sections that are added automatically when the matching add-on is bought (derived from ADDONS). */
export { EXTRA_BRIEF_SECTIONS } from './addons.js';

/** Sections every invitation renders regardless of blocks (core content). */
export const CORE_SECTIONS = ['hero', 'invitation_text', 'venue', 'rsvp'] as const;

export const SECTION_LABELS: Record<string, string> = {
  hero: 'Cover & names',
  invitation_text: 'Invitation wording',
  venue: 'Venue & map',
  rsvp: 'RSVP',
  our_story: 'Our story',
  timeline: 'Schedule',
  pre_wedding: 'Pre-wedding event',
  menu: 'Menu',
  dress_code: 'Dress code',
  accommodation: 'Where to stay',
  transport: 'Getting there',
  activities: 'Things to do',
  gift_list: 'Gifts',
  photos: 'Photos',
  countdown: 'Countdown',
  faq: 'FAQ',
  own_song: 'Your song',
  custom_monogram: 'Monogram letters',
  custom_link: 'Your link name',
  photo_cover_film: 'Photos for your cover film',
};

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'it', label: 'Italiano' },
  { code: 'de', label: 'Deutsch' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' },
  { code: 'ro', label: 'Română' },
  { code: 'el', label: 'Ελληνικά' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'ar', label: 'العربية', rtl: true },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'si', label: 'සිංහල' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'zh', label: '中文' },
] as const;

export const DIETARY_TAGS = ['gluten_free', 'lactose_free', 'vegetarian', 'vegan', 'nut', 'fruit', 'other'] as const;

export const DEFAULT_RSVP_SETTINGS = {
  deadline: null as string | null,
  requireEmail: true,
  mealOptions: ['meat', 'fish', 'vegetarian'],
  maxCompanions: 4,
  allowChildren: true,
  allergyChecklist: true,
  extraEvents: [] as string[],
  customQuestions: [] as { id: string; label: string; type: 'text' | 'yes_no'; required?: boolean }[],
  /** auto = open until deadline; open/closed = host override */
  mode: 'auto' as 'auto' | 'open' | 'closed',
};
export type RsvpSettings = typeof DEFAULT_RSVP_SETTINGS;

export function isCustomSection(key: string) {
  return key.startsWith('custom:');
}
