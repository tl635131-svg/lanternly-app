/**
 * Seeded invitation designs: the six gallery themes from design-review.md O5 / mockups/home--desktop.png.
 * `background` + `accent` are exactly Product Designer's values. The other fields are derived to match the
 * mockup cards and invite.css (`--inv-*`): primary = button fill, onPrimary = button text, glow = date /
 * highlight colour (--inv-glow), surface = raised cards (--inv-raised), text / muted = body copy.
 * All text pairs meet WCAG AA (4.5:1). Citrus uses #C2410C so white button text is 5.2:1 (Product Designer, Oct 16).
 *
 * Each theme lists the products it fits in `products[]`; the seeded six fit every product (wedding, save the date,
 * birthday, bridal party). Retired keys from the earlier reference-derived set map onto a replacement so
 * existing invitations/orders keep a design.
 */
import type { ProductType } from '@prisma/client';

export interface ThemePalette {
  background: string;
  surface: string;
  primary: string;
  onPrimary: string;
  accent: string;
  glow: string;
  text: string;
  muted: string;
}
export interface ThemeDef {
  key: string;
  name: string;
  description: string;
  mood: string[];
  palette: ThemePalette;
  fonts: { display: string; body: string };
  isPopular?: boolean;
  isNew?: boolean;
  demoSlug?: string;
}

export const THEMES: ThemeDef[] = [
  {
    key: 'evening',
    name: 'Evening',
    description: 'Deep indigo with a warm amber glow, like lanterns coming on at dusk.',
    mood: ['night', 'warm', 'glow'],
    palette: { background: '#12143A', surface: '#1C1F4E', primary: '#F4A93A', onPrimary: '#161838', accent: '#F4A93A', glow: '#FFD08A', text: '#EEEDF9', muted: '#BDB9DE' },
    fonts: { display: 'Manrope', body: 'Manrope' },
    isPopular: true,
  },
  {
    key: 'harbour',
    name: 'Harbour',
    description: 'Dark teal water and a coral light on the horizon. Bold, friendly type.',
    mood: ['coastal', 'bold', 'warm'],
    palette: { background: '#0F3B3E', surface: '#174B4F', primary: '#FF9C7A', onPrimary: '#0F3B3E', accent: '#FF9C7A', glow: '#FFC4AE', text: '#E8F4F1', muted: '#A9CBC6' },
    fonts: { display: 'Bricolage Grotesque', body: 'Manrope' },
  },
  {
    key: 'meadow',
    name: 'Meadow',
    description: 'Soft sage paper and deep green ink with a gentle, rounded serif.',
    mood: ['botanical', 'light', 'calm'],
    palette: { background: '#EEF3EA', surface: '#FFFFFF', primary: '#1F3A2A', onPrimary: '#EEF3EA', accent: '#1F3A2A', glow: '#3D6B4C', text: '#1F3A2A', muted: '#4E6455' },
    fonts: { display: 'Fraunces', body: 'Inter' },
    isNew: true,
    demoSlug: 'demo-meadow',
  },
  {
    key: 'citrus',
    name: 'Citrus',
    description: 'Crisp white with a bright tangerine accent and big, confident lettering.',
    mood: ['bright', 'modern', 'playful'],
    palette: { background: '#FFFFFF', surface: '#F6F5F3', primary: '#C2410C', onPrimary: '#FFFFFF', accent: '#C2410C', glow: '#D9480F', text: '#1B1B1F', muted: '#5C5C66' },
    fonts: { display: 'Inter', body: 'Inter' },
  },
  {
    key: 'lilac',
    name: 'Lilac',
    description: 'Pale lavender with ink-blue type: soft, clear and easy to read.',
    mood: ['soft', 'light', 'modern'],
    palette: { background: '#E7E3F7', surface: '#F4F2FC', primary: '#2B2466', onPrimary: '#FFFFFF', accent: '#2B2466', glow: '#4C3FB0', text: '#2B2466', muted: '#575080' },
    fonts: { display: 'DM Sans', body: 'DM Sans' },
  },
  {
    key: 'nocturne',
    name: 'Nocturne',
    description: 'Near-black with a cool mint glow and light, airy lowercase type.',
    mood: ['night', 'minimal', 'cool'],
    palette: { background: '#1B1B1F', surface: '#26262C', primary: '#9FE3C4', onPrimary: '#1B1B1F', accent: '#9FE3C4', glow: '#9FE3C4', text: '#F2F2F2', muted: '#A9A9B4' },
    fonts: { display: 'Manrope', body: 'Manrope' },
  },
];

/** Earlier theme keys → replacement. Used by the seed to move existing rows before deleting the old themes. */
export const RETIRED_THEME_KEYS: Record<string, string> = {
  'coastal-linen': 'harbour',
  'garden-watercolour': 'meadow',
  'monochrome-editorial': 'nocturne',
  'minimal-type': 'citrus',
  'warm-dusk': 'evening',
  'travel-postcard': 'harbour',
  'std-reveal': 'lilac',
  'birthday-letter': 'citrus',
};

export function themeDefaultConfig(t: ThemeDef) {
  return {
    palette: t.palette,
    fonts: t.fonts,
    cover: { type: 'glow' },
    opening: { animation: 'glow', durationMs: 1800 },
    // Music only ever starts from the guest's tap on "Open invitation".
    music: { volume: 0.6, autoplayOnOpen: true },
  };
}

export const ALL_PRODUCTS: ProductType[] = ['wedding_invite', 'save_the_date', 'birthday', 'bridesmaid'];
export const themeFitsProduct = (theme: { products: ProductType[] }, product: ProductType) => theme.products.includes(product);
export const themeProductWhere = (product: ProductType) => ({ products: { has: product } });

/**
 * Default palettes of the retired themes, kept ONLY to recognise invitations that still use one unchanged.
 * The seed restyles those onto the replacement theme; a palette someone customised is left alone.
 */
export const LEGACY_THEME_PALETTES: Record<string, Record<string, string>> = {
  'coastal-linen': { background: '#F7F4EE', surface: '#FFFFFF', primary: '#2F5D62', accent: '#C9A66B', text: '#1F2A2C', muted: '#6B7A7C' },
  'garden-watercolour': { background: '#FBF7F4', surface: '#FFFFFF', primary: '#7A4E5A', accent: '#A9B89A', text: '#2B2326', muted: '#80727A' },
  'monochrome-editorial': { background: '#FFFFFF', surface: '#F2F2F2', primary: '#111111', accent: '#8C8C8C', text: '#111111', muted: '#5C5C5C' },
  'minimal-type': { background: '#FAFAF7', surface: '#FFFFFF', primary: '#3A3A36', accent: '#B5A88F', text: '#22221F', muted: '#77776F' },
  'warm-dusk': { background: '#FFF8F0', surface: '#FFFFFF', primary: '#8A4B2A', accent: '#E0A458', text: '#2E1F16', muted: '#86705F' },
  'travel-postcard': { background: '#F5F1E6', surface: '#FFFFFF', primary: '#1E4B6E', accent: '#D96C4F', text: '#1B2630', muted: '#6E7780' },
  'std-reveal': { background: '#FFF9F2', surface: '#FFFFFF', primary: '#C0392B', accent: '#F4D03F', text: '#2C2C2C', muted: '#7A7A7A' },
  'birthday-letter': { background: '#F8F3EA', surface: '#FFFFFF', primary: '#5B4636', accent: '#C8A97E', text: '#2A211A', muted: '#7D6E62' },
};
export const LEGACY_DEFAULT_FONTS = { display: 'serif-display', body: 'sans-body' };

/** Returns the retired theme key whose default palette this is (exact match, case-insensitive), else null. */
export function legacyPaletteKey(palette: unknown): string | null {
  if (!palette || typeof palette !== 'object') return null;
  const p = palette as Record<string, unknown>;
  for (const [key, legacy] of Object.entries(LEGACY_THEME_PALETTES)) {
    const keys = Object.keys(legacy);
    if (Object.keys(p).length === keys.length && keys.every((k) => String(p[k] ?? '').toUpperCase() === legacy[k]!.toUpperCase())) return key;
  }
  return null;
}
