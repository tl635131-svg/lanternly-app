/**
 * Ready-to-paste invitation texts for manual sharing (WhatsApp, SMS, email).
 *
 * Only locales with hand-written templates are listed. We never return English
 * text under another language's key. Callers fall back to English for the
 * primary message and report the untranslated languages to the client.
 */

export const SHARE_TEXT_LOCALES = ['en', 'fr'] as const;
export type ShareLocale = (typeof SHARE_TEXT_LOCALES)[number];

export interface ShareTextInput {
  title: string;
  /** `partner1 & partner2` → plural phrasing (needed for French verb agreement). */
  hostNames?: unknown;
  eventDate?: Date | null;
  /** RSVP deadline, `YYYY-MM-DD`. */
  deadline?: string | null;
  url: string;
}

/** `fr-CA` → `fr`; returns null when no template exists for the language. */
export function shareLocale(lang: string | null | undefined): ShareLocale | null {
  const base = (lang ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return (SHARE_TEXT_LOCALES as readonly string[]).includes(base!) ? (base as ShareLocale) : null;
}

function isPlural(hostNames: unknown) {
  const h = (hostNames ?? {}) as Record<string, unknown>;
  return typeof h.partner1 === 'string' && !!h.partner1.trim() && typeof h.partner2 === 'string' && !!h.partner2.trim();
}

function dateOnly(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const parsed = new Date(`${d}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Long, human date. Date-only values are stored at UTC midnight, so format in UTC. */
export function formatLongDate(d: Date | string | null | undefined, locale: ShareLocale, withWeekday = true): string | null {
  const date = dateOnly(d);
  if (!date) return null;
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric', ...(withWeekday ? { weekday: 'long' } : {}) };
  if (locale === 'fr') {
    // French writes the first day of the month as an ordinal: « 1er mai 2027 ».
    const parts = new Intl.DateTimeFormat('fr-FR', opts).formatToParts(date);
    return parts.map((p) => (p.type === 'day' && p.value === '1' ? '1er' : p.value)).join('');
  }
  return new Intl.DateTimeFormat('en-US', opts).format(date);
}

/** Shared message for the whole event (share kit). */
export function eventShareText(locale: ShareLocale, i: ShareTextInput): string {
  const date = formatLongDate(i.eventDate, locale);
  const deadline = formatLongDate(i.deadline, locale, false);
  if (locale === 'fr') {
    const plural = isPlural(i.hostNames);
    const intro = `${i.title} ${plural ? 'ont' : 'a'} le plaisir de vous inviter à ${plural ? 'leur' : 'sa'} célébration${date ? ` le ${date}` : ''}.`;
    const ask = deadline ? `Découvrez l’invitation et merci de répondre d’ici le ${deadline} : ${i.url}` : `Découvrez l’invitation : ${i.url}`;
    return `${intro} ${ask}`;
  }
  const intro = `${i.title} would love for you to join the celebration${date ? ` on ${date}` : ''}.`;
  const ask = deadline ? `Open the invitation and please reply by ${deadline}: ${i.url}` : `Open the invitation: ${i.url}`;
  return `${intro} ${ask}`;
}

/** Personal message for one household (invitee link). */
export function personalShareText(locale: ShareLocale, i: ShareTextInput & { firstName: string }): string {
  if (locale === 'fr') {
    const plural = isPlural(i.hostNames);
    // Gender-neutral wording on purpose (no « ravis / ravies »).
    return `Bonjour ${i.firstName}, ${i.title} ${plural ? 'ont' : 'a'} le plaisir de vous inviter à ${plural ? 'leur' : 'sa'} célébration. Voici votre invitation personnelle : ${i.url}`;
  }
  return `Dear ${i.firstName}, ${i.title} would love to celebrate with you. Your personal invitation: ${i.url}`;
}

export function shareSubject(locale: ShareLocale, title: string): string {
  return locale === 'fr' ? `Invitation : ${title}` : `You're invited: ${title}`;
}
