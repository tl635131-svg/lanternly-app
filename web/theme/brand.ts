/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  BRAND CONFIG — the single file to edit when the brand is chosen.
 * ─────────────────────────────────────────────────────────────────────────────
 *  Every colour, font, radius and shadow in the product UI comes from here.
 *  `theme/css.ts` turns this object into CSS custom properties that are injected
 *  into <html>, and `app/globals.css` maps those variables onto Tailwind tokens
 *  (bg-surface, text-ink, rounded-card, shadow-glow, font-display …).
 *
 *  Components never use raw hex values or font names, so swapping this object
 *  (and the logo files it points to) re-skins the whole app in one step.
 *
 *  Current default: Lanternly, from design/tokens.json (Product Designer, final tokens).
 *  To try another option, replace `brand` with one of the presets at the bottom
 *  (e.g. `export const brand = hearthAndHour;`) or paste in the final tokens.
 *
 *  Note: the *guest invitation* is skinned by each couple's own invitation
 *  palette (from the API), not by this file. Only its loading/opening chrome and
 *  the "made with" credit use the brand.
 */

export type FontFace = { src: string; weight: string; style?: "normal" | "italic"; unicodeRange?: string };
export type FontToken = { family: string; fallback: string; faces: FontFace[] };

/**
 * Script fallbacks (SIL OFL, self-hosted in /public/fonts). Each face has a unicode-range, so the
 * browser only downloads it when the page contains that script. Their families are slotted into every
 * stack right after the primary family (display and body), before the system fonts.
 * Noto Sans Tamil: variable wght 100-900, width pinned to 100, subset to the Tamil block (U+0B80-0BFF).
 */
export const scriptFonts: FontToken[] = [
  { family: "Noto Sans Tamil", fallback: "", faces: [{ src: "/fonts/NotoSansTamil-tamil.woff2", weight: "100 900", unicodeRange: "U+0B80-0BFF" }] },
];
/** `"Noto Sans Tamil"` (comma-joined), for use inside a font-family stack. */
export const scriptStack = scriptFonts.map((f) => `"${f.family}"`).join(",");

export type BrandColors = {
  /** page background */
  canvas: string;
  /** cards, inputs */
  surface: string;
  /** subtle panels, hover rows, table stripes */
  surface2: string;
  /** popovers, menus, raised cards */
  surfaceRaised: string;
  /** hairline borders and dividers */
  line: string;
  /** input & control borders (≥ 3:1 on surface, WCAG 1.4.11) */
  borderStrong: string;
  /** body text */
  ink: string;
  /** secondary text (must stay ≥ 4.5:1 on canvas & surface) */
  muted: string;
  /** tertiary text: placeholders, meta (≥ 4.5:1 on surface) */
  inkSubtle: string;
  /** primary action / brand colour */
  primary: string;
  /** hover / pressed primary */
  primaryHover: string;
  /** text & icons on primary */
  onPrimary: string;
  /** highlight colour (badges, glow, small accents) */
  accent: string;
  /** text on accent */
  onAccent: string;
  /** accent colour that is safe for text on light surfaces */
  accentText: string;
  /** soft secondary tint (chips, selected rows) */
  tint: string;
  /** deep "night" surface used for hero bands and dark cards */
  night: string;
  /** raised panel on night */
  nightRaised: string;
  /** text on night */
  onNight: string;
  /** secondary text on night */
  onNightMuted: string;
  /** glow / highlight on night */
  glow: string;
  /** keyboard focus ring (solid) */
  focus: string;
  /** soft halo drawn around the focus ring */
  focusHalo: string;
  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  info: string;
  infoSoft: string;
  /** reply status chips: Coming / Can't come / Waiting / Maybe */
  rsvpAttending: string;
  rsvpAttendingSoft: string;
  rsvpDeclined: string;
  rsvpDeclinedSoft: string;
  rsvpPending: string;
  rsvpPendingSoft: string;
  rsvpMaybe: string;
  rsvpMaybeSoft: string;
  /** modal backdrop */
  scrim: string;
};

export type Brand = {
  /** product name shown in header, titles and emails */
  name: string;
  /** short promise used in <title> and hero */
  tagline: string;
  /** logo files in /public (wordmark for light & dark backgrounds, square symbol) */
  logo: { light: string; dark: string; symbol: string; symbolDark: string; width: number; height: number };
  fonts: { display: FontToken; body: FontToken; mono?: FontToken; scripts?: FontToken[] };
  /** weight used for display headings */
  displayWeight: number;
  /** letter-spacing for display headings */
  displayTracking: string;
  colors: BrandColors;
  /** xs 6 · sm 8 · md 10 (inputs, buttons) · card 12 · xl 16 · 2xl 24 · full (chips only, never buttons) */
  radius: { xs: string; sm: string; md: string; card: string; xl: string; "2xl": string; full: string };
  /** card = elevation-1, raised = elevation-2, pop = elevation-3, glow = accent glow, glowNight = glow on night */
  shadow: { card: string; raised: string; pop: string; glow: string; glowNight: string };
};

/* ── Lanternly (default for now) ───────────────────────────────────────────── */
export const lanternly: Brand = {
  name: "Lanternly",
  tagline: "Light the way to your celebration",
  logo: {
    light: "/brand/lanternly-logo.svg",
    dark: "/brand/lanternly-logo-reverse.svg",
    symbol: "/brand/lanternly-symbol.svg",
    symbolDark: "/brand/lanternly-symbol-reverse.svg",
    width: 277,
    height: 64,
  },
  fonts: {
    display: {
      family: "Manrope",
      fallback: "ui-sans-serif, system-ui, sans-serif",
      faces: [{ src: "/fonts/Manrope-latin.woff2", weight: "200 800" }],
    },
    body: {
      family: "Manrope",
      fallback: "ui-sans-serif, system-ui, sans-serif",
      faces: [{ src: "/fonts/Manrope-latin.woff2", weight: "200 800" }],
    },
    scripts: scriptFonts,
  },
  displayWeight: 700,
  displayTracking: "-0.03em",
  colors: {
    canvas: "#F5F4FB",
    surface: "#FFFFFF",
    surface2: "#EDEBF7",
    surfaceRaised: "#FFFFFF",
    line: "#DCD9EC",
    borderStrong: "#8A85B3",
    ink: "#161838",
    muted: "#55587A",
    inkSubtle: "#6A6D8E",
    primary: "#1E2156",
    primaryHover: "#2B2F72",
    onPrimary: "#FFFFFF",
    accent: "#F4A93A",
    onAccent: "#161838",
    accentText: "#8F5300",
    tint: "#E5E2F6",
    night: "#12143A",
    nightRaised: "#1C1F4E",
    onNight: "#EEEDF9",
    onNightMuted: "#BDB9DE",
    glow: "#FFD08A",
    focus: "#1E2156",
    focusHalo: "#F4A93A",
    success: "#17683F",
    successSoft: "#DCF2E5",
    danger: "#A3202B",
    dangerSoft: "#FBE4E6",
    warning: "#865000",
    warningSoft: "#FFF0D4",
    info: "#2A52A8",
    infoSoft: "#E3EBFB",
    rsvpAttending: "#17683F",
    rsvpAttendingSoft: "#DCF2E5",
    rsvpDeclined: "#A3202B",
    rsvpDeclinedSoft: "#FBE4E6",
    rsvpPending: "#4A4D70",
    rsvpPendingSoft: "#ECEBF5",
    rsvpMaybe: "#865000",
    rsvpMaybeSoft: "#FFF0D4",
    scrim: "rgba(18,20,58,.56)",
  },
  radius: { xs: "6px", sm: "8px", md: "10px", card: "12px", xl: "16px", "2xl": "24px", full: "9999px" },
  shadow: {
    card: "0 0 0 1px rgba(30,33,86,.06), 0 0 14px rgba(169,163,212,.22)",
    raised: "0 0 0 1px rgba(30,33,86,.06), 0 0 32px rgba(169,163,212,.38)",
    pop: "0 0 0 1px rgba(30,33,86,.08), 0 0 56px rgba(120,112,190,.40)",
    glow: "0 0 0 4px rgba(244,169,58,.18), 0 0 24px 2px rgba(244,169,58,.45)",
    glowNight: "0 0 0 1px rgba(189,185,222,.18), 0 0 40px rgba(255,208,138,.18)",
  },
};

/* ── Alternative presets (kept so the swap is one line) ───────────────────── */
export const hearthAndHour: Brand = {
  name: "Hearth & Hour",
  tagline: "Invitations with time to breathe",
  logo: {
    light: "/brand/hearth-and-hour-logo.svg",
    dark: "/brand/hearth-and-hour-logo-reverse.svg",
    symbol: "/brand/hearth-and-hour-symbol.svg",
    symbolDark: "/brand/hearth-and-hour-symbol-reverse.svg",
    width: 300,
    height: 64,
  },
  fonts: {
    display: { family: "Fraunces", fallback: "Georgia, serif", faces: [{ src: "/fonts/Fraunces-latin.woff2", weight: "100 900" }] },
    body: { family: "Inter", fallback: "ui-sans-serif, system-ui, sans-serif", faces: [{ src: "/fonts/Inter-latin.woff2", weight: "100 900" }] },
    scripts: scriptFonts,
  },
  displayWeight: 460,
  displayTracking: "-0.02em",
  colors: {
    canvas: "#F6F1E4",
    surface: "#FFFDF8",
    surface2: "#EFE7D5",
    surfaceRaised: "#FFFFFF",
    line: "#DCD1B8",
    borderStrong: "#8C8A74",
    ink: "#1D211E",
    muted: "#52574D",
    inkSubtle: "#62675C",
    primary: "#24402F",
    primaryHover: "#2F533D",
    onPrimary: "#FFFFFF",
    accent: "#B85A35",
    onAccent: "#FFFFFF",
    accentText: "#9C4826",
    tint: "#E6EADB",
    night: "#24402F",
    nightRaised: "#2F533D",
    onNight: "#F6F1E4",
    onNightMuted: "#CBD3C2",
    glow: "#E9B48C",
    focus: "#24402F",
    focusHalo: "#E9B48C",
    success: "#2E6B3F",
    successSoft: "#E1EFDF",
    danger: "#A3282A",
    dangerSoft: "#F7E1DE",
    warning: "#7A5300",
    warningSoft: "#F8EBCB",
    info: "#2D5A86",
    infoSoft: "#E1EAF2",
    rsvpAttending: "#2E6B3F",
    rsvpAttendingSoft: "#E1EFDF",
    rsvpDeclined: "#A3282A",
    rsvpDeclinedSoft: "#F7E1DE",
    rsvpPending: "#52574D",
    rsvpPendingSoft: "#ECE6D6",
    rsvpMaybe: "#7A5300",
    rsvpMaybeSoft: "#F8EBCB",
    scrim: "rgba(29,33,30,.55)",
  },
  radius: { xs: "4px", sm: "6px", md: "8px", card: "10px", xl: "12px", "2xl": "20px", full: "9999px" },
  shadow: {
    card: "0 0 0 1px rgba(29,33,30,.08)",
    raised: "0 0 0 1px rgba(29,33,30,.08), 0 6px 18px -10px rgba(29,33,30,.25)",
    pop: "0 0 0 1px rgba(29,33,30,.10), 0 18px 40px -16px rgba(29,33,30,.35)",
    glow: "0 0 0 3px rgba(184,90,53,.25)",
    glowNight: "0 0 0 1px rgba(246,241,228,.16)",
  },
};

export const merrymade: Brand = {
  name: "Merrymade",
  tagline: "Invites that feel like a party",
  logo: {
    light: "/brand/merrymade-logo.svg",
    dark: "/brand/merrymade-logo-reverse.svg",
    symbol: "/brand/merrymade-symbol.svg",
    symbolDark: "/brand/merrymade-symbol-reverse.svg",
    width: 300,
    height: 64,
  },
  fonts: {
    display: { family: "Bricolage Grotesque", fallback: "ui-sans-serif, system-ui", faces: [{ src: "/fonts/BricolageGrotesque-latin.woff2", weight: "200 800" }] },
    body: { family: "DM Sans", fallback: "ui-sans-serif, system-ui", faces: [{ src: "/fonts/DMSans-latin.woff2", weight: "100 1000" }] },
    scripts: scriptFonts,
  },
  displayWeight: 800,
  displayTracking: "-0.035em",
  colors: {
    canvas: "#FAFAF7",
    surface: "#FFFFFF",
    surface2: "#F0F2F8",
    surfaceRaised: "#FFFFFF",
    line: "#DDE1EE",
    borderStrong: "#7D82A0",
    ink: "#14162B",
    muted: "#4D5170",
    inkSubtle: "#5D6180",
    primary: "#1F4FE0",
    primaryHover: "#1A43C0",
    onPrimary: "#FFFFFF",
    accent: "#FFC933",
    onAccent: "#14162B",
    accentText: "#1F4FE0",
    tint: "#E8EEFF",
    night: "#14162B",
    nightRaised: "#22254A",
    onNight: "#FAFAF7",
    onNightMuted: "#C3C6DA",
    glow: "#FF8FAB",
    focus: "#1F4FE0",
    focusHalo: "#FFC933",
    success: "#14794A",
    successSoft: "#DCF4E6",
    danger: "#BC2129",
    dangerSoft: "#FDE2E3",
    warning: "#7A5800",
    warningSoft: "#FFF2CC",
    info: "#1F4FE0",
    infoSoft: "#E8EEFF",
    rsvpAttending: "#126C42",
    rsvpAttendingSoft: "#DCF4E6",
    rsvpDeclined: "#B21E26",
    rsvpDeclinedSoft: "#FDE2E3",
    rsvpPending: "#4D5170",
    rsvpPendingSoft: "#EEF0F6",
    rsvpMaybe: "#7A5800",
    rsvpMaybeSoft: "#FFF2CC",
    scrim: "rgba(20,22,43,.55)",
  },
  radius: { xs: "8px", sm: "10px", md: "12px", card: "14px", xl: "18px", "2xl": "28px", full: "9999px" },
  shadow: {
    card: "0 0 0 1.5px rgba(20,22,43,.08)",
    raised: "0 0 0 1.5px rgba(20,22,43,.10)",
    pop: "0 0 0 2px #14162B",
    glow: "0 0 0 3px #FFC933",
    glowNight: "0 0 0 2px rgba(250,250,247,.2)",
  },
};

/** ← the active brand. Change this one line (or the object above) to re-skin. */
export const brand: Brand = lanternly;
