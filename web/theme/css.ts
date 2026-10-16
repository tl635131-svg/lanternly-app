import { brand, scriptFonts, type Brand, type FontToken } from "./brand";

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

/** CSS custom properties generated from the brand config. */
export function brandCssVars(b: Brand = brand): string {
  const vars: string[] = [];
  for (const [k, v] of Object.entries(b.colors)) vars.push(`--brand-${kebab(k)}:${v}`);
  for (const [k, v] of Object.entries(b.radius)) vars.push(`--brand-radius-${k}:${v}`);
  for (const [k, v] of Object.entries(b.shadow)) vars.push(`--brand-shadow-${k}:${v}`);
  vars.push(`--brand-font-display:${fontStack(b.fonts.display, b)}`);
  vars.push(`--brand-font-body:${fontStack(b.fonts.body, b)}`);
  vars.push(`--brand-display-weight:${b.displayWeight}`);
  vars.push(`--brand-display-tracking:${b.displayTracking}`);
  return `:root{${vars.join(";")}}`;
}

/** `"Primary", <script fallbacks e.g. "Noto Sans Tamil">, <system fallbacks>`. */
export function fontStack(f: FontToken, b: Brand = brand): string {
  const scripts = (b.fonts.scripts ?? scriptFonts).map((s) => `"${s.family}"`);
  return [`"${f.family}"`, ...scripts, f.fallback].filter(Boolean).join(",");
}

/** @font-face rules for the brand fonts plus the invitation font library. */
export function brandFontFaces(b: Brand = brand): string {
  const seen = new Set<string>();
  const out: string[] = [];
  const all = [b.fonts.display, b.fonts.body, ...(b.fonts.mono ? [b.fonts.mono] : []), ...inviteFonts, ...(b.fonts.scripts ?? scriptFonts)];
  for (const f of all) {
    for (const face of f.faces) {
      const key = f.family + face.src + face.weight;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(
        `@font-face{font-family:"${f.family}";src:url("${face.src}") format("${face.src.endsWith(".woff2") ? "woff2" : "truetype"}");font-weight:${face.weight};font-style:${face.style ?? "normal"};font-display:swap${face.unicodeRange ? `;unicode-range:${face.unicodeRange}` : ""}}`,
      );
    }
  }
  return out.join("\n");
}

/** Fonts available to couples' invitations (OFL, self-hosted in /public/fonts). */
export const inviteFonts: FontToken[] = [
  { family: "Fraunces", fallback: "Georgia, serif", faces: [{ src: "/fonts/Fraunces-latin.woff2", weight: "100 900" }] },
  { family: "Instrument Serif", fallback: "Georgia, serif", faces: [{ src: "/fonts/InstrumentSerif-Regular.ttf", weight: "400" }] },
  { family: "Inter", fallback: "system-ui, sans-serif", faces: [{ src: "/fonts/Inter-latin.woff2", weight: "100 900" }] },
  { family: "Manrope", fallback: "system-ui, sans-serif", faces: [{ src: "/fonts/Manrope-latin.woff2", weight: "200 800" }] },
  { family: "DM Sans", fallback: "system-ui, sans-serif", faces: [{ src: "/fonts/DMSans-latin.woff2", weight: "100 1000" }] },
  { family: "Bricolage Grotesque", fallback: "system-ui, sans-serif", faces: [{ src: "/fonts/BricolageGrotesque-latin.woff2", weight: "200 800" }] },
];

const T = scriptFonts.map((f) => `"${f.family}"`).join(", ");

/** Maps the API's abstract font tokens (config.fonts.*) onto real families. */
export const inviteFontTokens: Record<string, string> = {
  "serif-display": `"Fraunces", ${T}, Georgia, serif`,
  "sans-body": `"Manrope", ${T}, system-ui, sans-serif`,
  "sans-display": `"Bricolage Grotesque", ${T}, system-ui, sans-serif`,
  "modern-sans": `"DM Sans", ${T}, system-ui, sans-serif`,
  "editorial-serif": `"Instrument Serif", ${T}, Georgia, serif`,
  script: `"Instrument Serif", ${T}, Georgia, serif`,
  inter: `"Inter", ${T}, system-ui, sans-serif`,
};
export const resolveInviteFont = (token: string | undefined, fallback: string) =>
  (token && (inviteFontTokens[token] ?? `"${token}", ${T}, ${fallback}`)) || fallback;
