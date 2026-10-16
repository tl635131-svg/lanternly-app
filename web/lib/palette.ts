import type { CSSProperties } from "react";
import type { InvitationConfig, Palette } from "@/lib/types";
import { brand } from "@/theme/brand";
import { resolveInviteFont } from "@/theme/css";

/**
 * Maps a couple's invitation palette (from the API theme/config) onto the
 * --inv-* variables read by app/invite.css. Nothing here is a fixed theme:
 * the six gallery themes come from /api/public/catalogue (theme.defaultConfig).
 */
export const DEFAULT_PALETTE: Palette = {
  background: brand.colors.night, surface: brand.colors.nightRaised, primary: brand.colors.accent, onPrimary: brand.colors.onAccent,
  accent: brand.colors.glow, glow: brand.colors.glow, text: brand.colors.onNight, muted: brand.colors.onNightMuted,
};

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function luminance(hex: string | undefined): number {
  const c = hex ? rgb(hex) : null;
  if (!c) return 0;
  const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Mixes two hex colours (t = share of `a`) into a hex colour. */
export function mixHex(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return a;
  return "#" + x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, "0")).join("");
}
/** Moves `fg` towards `toward` until it reaches `min` contrast against every background (M-09). */
export function ensureContrast(fg: string, bgs: string[], toward: string, min = 4.6): string {
  if (!rgb(fg)) return fg;
  for (let t = 1; t >= 0; t -= 0.05) {
    const c = mixHex(fg, toward, t);
    if (bgs.every((b) => !rgb(b) || contrast(c, b) >= min)) return c;
  }
  return toward;
}
export const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
export const isLightColor = (hex: string | undefined) => luminance(hex) > 0.4;

export function invPalette(cfg: InvitationConfig | undefined): Palette {
  return { ...DEFAULT_PALETTE, ...(cfg?.palette ?? {}) } as Palette;
}

/** Inline style for the `.inv` root. Returns the variables plus whether the theme is light. */
export function invVars(cfg: InvitationConfig | undefined): { style: CSSProperties; light: boolean } {
  const p = invPalette(cfg);
  const light = isLightColor(p.background);
  // Palette roles (API): primary = main button (+ onPrimary), accent = highlight text, glow = light colour.
  const btn = p.primary;
  const onBtn = p.onPrimary || (contrast(btn, "#FFFFFF") >= contrast(btn, brand.colors.ink) ? "#FFFFFF" : brand.colors.ink);
  const raised = p.surface && p.surface.toLowerCase() !== p.background.toLowerCase() ? p.surface : mixHex(p.background, light ? "#000000" : "#FFFFFF", 0.92);
  // Highlight text and muted text must stay AA (4.5:1) on both the page and raised cards, whatever the palette.
  const hi = ensureContrast(p.accent, [p.background, raised], light ? "#000000" : "#FFFFFF");
  const muted = ensureContrast(p.muted || mixHex(p.text, p.background, 0.7), [p.background, raised], p.text);
  const glow = cfg?.cover?.glowColor || p.glow || p.accent;
  const style = {
    "--inv-bg": p.background,
    "--inv-raised": raised,
    "--inv-ink": p.text,
    "--inv-head": p.text,
    "--inv-muted": muted,
    "--inv-accent": btn,
    "--inv-on-accent": onBtn,
    "--inv-glow": glow,
    "--inv-glow-text": hi,
    "--inv-bloom": light ? `color-mix(in srgb, ${glow} 10%, transparent)` : "rgba(140,130,220,.10)",
    "--inv-field": light ? "#FFFFFF" : `color-mix(in srgb, ${p.background} 82%, #000)`,
    "--inv-map": light ? `color-mix(in srgb, ${p.surface || p.background} 70%, ${p.background})` : `color-mix(in srgb, ${p.surface || p.background} 70%, ${p.background})`,
    "--inv-display": resolveInviteFont(cfg?.fonts?.display, `var(--brand-font-display)`),
    "--inv-body": resolveInviteFont(cfg?.fonts?.body, `var(--brand-font-body)`),
  } as CSSProperties;
  return { style, light };
}
