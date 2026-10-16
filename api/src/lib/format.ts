export function money(cents: number, currency = 'CAD', locale = 'en-CA') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}
export function isoDate(d: Date | null | undefined) {
  return d ? d.toISOString().slice(0, 10) : null;
}
export function parseDateOnly(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
export function addMonths(d: Date, months: number) {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
}
export function i18nName(v: unknown, lang = 'en'): string {
  const o = (v ?? {}) as Record<string, string>;
  return o[lang] ?? Object.values(o)[0] ?? '';
}
