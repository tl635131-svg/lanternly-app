/**
 * Client-side checks that mirror spec items 19 and 23 ([Decided, pending build]).
 * The server stays authoritative; these only give instant feedback.
 */
import { brand } from "@/theme/brand";

const RESERVED = new Set(["api", "admin", "app", "auth", "login", "checkout", "pricing", "styles", "blog", "docs", "health", "static", "i", "demo"]);

export type SlugIssue = "short" | "long" | "format" | "edges" | "reserved" | null;

export function slugIssue(raw: string): SlugIssue {
  const s = raw.trim();
  if (s.length < 3) return "short";
  if (s.length > 60) return "long";
  if (!/^[a-z0-9-]+$/.test(s)) return "format";
  if (!/^[a-z0-9].*[a-z0-9]$/.test(s)) return "edges";
  const name = brand.name.toLowerCase();
  if (RESERVED.has(s) || s.startsWith("demo-") || s === name || s.startsWith(`${name}-`)) return "reserved";
  return null;
}

export const SLUG_MESSAGE: Record<Exclude<SlugIssue, null>, string> = {
  short: "Use at least 3 characters.",
  long: "Keep it to 60 characters or fewer.",
  format: "Use lowercase letters, numbers and hyphens only.",
  edges: "Start and end with a letter or number.",
  reserved: "That word is reserved. Try something more personal.",
};

/** Lowercase, strip accents, spaces → hyphens. Used as the user types. */
export function toSlug(raw: string): string {
  return raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").slice(0, 60);
}

const digits = (v: string) => v.replace(/\s/g, "");

/** Canadian deposit details: institution 3 digits, transit 5, account 7–12. Returns a message or null. */
export const giftCheck = {
  interacEmail: (v: string) => (!v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : "Enter a valid email for Interac e-Transfer."),
  institutionNumber: (v: string) => (!v || /^\d{3}$/.test(digits(v)) ? null : "Institution number is 3 digits."),
  transitNumber: (v: string) => (!v || /^\d{5}$/.test(digits(v)) ? null : "Transit number is 5 digits."),
  accountNumber: (v: string) => (!v || /^\d{7,12}$/.test(digits(v)) ? null : "Account number is 7 to 12 digits."),
  iban: (v: string) => (!v || /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(digits(v).toUpperCase()) ? null : "Check the IBAN format."),
  bic: (v: string) => (!v || /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v.trim().toUpperCase()) ? null : "A BIC has 8 or 11 letters and digits."),
};
