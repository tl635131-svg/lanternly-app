"use client";
/*
 * Shared invitation renderer: used by the public guest page and the editor's live preview.
 * Skin = app/invite.css (Lanternly design system): Manrope display, left-aligned numbered
 * sections, orbs and glow instead of ornaments. Colours come from the couple's palette via
 * --inv-* variables (lib/palette.ts).
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import type { InvitationConfig, InviteContent, PublicInvitation } from "@/lib/types";
import { invVars } from "@/lib/palette";
import { useCountdown, useCopy } from "@/lib/hooks";
import { proxied } from "@/lib/api";
import { useIt } from "@/lib/invite-i18n";
import { IconCalendar, IconChevronDown, IconCopy, IconCheck, IconExternal, IconGift, IconMap, IconArrowRight } from "@/components/ui/icons";
import { BRAND_NAME, BrandSymbol } from "@/components/brand";
import Link from "next/link";
import { SafeImg } from "@/components/ui/primitives";

export function mergeConfig(themeDefault: InvitationConfig | undefined, config: InvitationConfig | undefined): InvitationConfig {
  const a = themeDefault ?? {};
  const b = config ?? {};
  return {
    ...a, ...b,
    palette: { ...a.palette, ...b.palette },
    fonts: { ...a.fonts, ...b.fonts },
    cover: { ...a.cover, ...b.cover },
    opening: { ...a.opening, ...b.opening },
    music: { ...a.music, ...b.music },
  };
}

/** Root props for an `.inv` container skinned with the couple's palette. */
export function inviteRoot(cfg: InvitationConfig): { style: CSSProperties; className: string } {
  const { style, light } = invVars(cfg);
  return { style, className: light ? "inv light" : "inv" };
}

type S = Record<string, unknown>;
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function hasContent(key: string, s: S | undefined): boolean {
  if (!s) return false;
  if (key === "rsvp" || key === "countdown") return true;
  return Object.entries(s).some(([k, v]) => k !== "heading" && (Array.isArray(v) ? v.length > 0 : typeof v === "object" && v ? Object.values(v).some(Boolean) : !!v));
}

export const coupleNames = (content: InviteContent, event: PublicInvitation["event"]) =>
  content.hero?.title || [event.hostNames.partner1, event.hostNames.partner2].filter(Boolean).join(" & ") || event.hostNames.honoree || event.title;

/** "Maya & Theo" → two lines with the ampersand leading the second, as in the mockups. */
export function Names({ names, className, style, as: As = "h1", id }: { names: string; className?: string; style?: CSSProperties; as?: "h1" | "h2" | "p"; id?: string }) {
  const parts = names.split(/\s*&\s*/);
  return (
    <As id={id} className={className ?? "inv-names"} style={style}>
      {parts.length === 2 ? <>{parts[0]}<br />&amp; {parts[1]}</> : names}
    </As>
  );
}

export function SectionFrame({ id, n, heading, children, className }: { id: string; n?: number; heading?: string; children: ReactNode; className?: string }) {
  return (
    <section id={`s-${id}`} aria-labelledby={heading ? `h-${id}` : undefined} className={"inv-sec " + (className ?? "")}>
      {heading && (
        <div className="inv-sec-h">
          {n != null && <span aria-hidden className="num tabular">{String(n).padStart(2, "0")}</span>}
          <h2 id={`h-${id}`}>{heading}</h2>
        </div>
      )}
      {children}
    </section>
  );
}

export function Hero({ content, event, onReply, bg, replyBy, invitee, lang, headingAs = "h1" }: { content: InviteContent; event: PublicInvitation["event"]; onReply?: () => void; bg?: string; replyBy?: string | null; invitee?: PublicInvitation["invitee"]; lang?: string; headingAs?: "h1" | "h2" }) {
  const t = useIt();
  const h = content.hero ?? {};
  const names = coupleNames(content, event);
  return (
    <header id="s-hero" className="relative pb-6 pt-16 text-center">
      {bg && <div aria-hidden className="inv-hero-photo" style={{ backgroundImage: `url("${bg}")` }} />}
      <div aria-hidden className="inv-bloom" style={{ width: 520, height: 520, left: "50%", top: -120, marginLeft: -260 }} />
      <div className="relative">
        <p className="inv-over">{h.tagline || t.youreInvited}</p>
        <Names names={names} className="inv-names phone-names mt-3" as={headingAs} />
        {h.subtitle && <p className="inv-muted mt-2 text-[15px]">{h.subtitle}</p>}
        <div aria-hidden className="inv-rule mx-auto my-5" />
        {(h.dateText || event.eventDate) && <p className="text-[16px] font-bold" style={{ color: "var(--inv-glow-text)" }}>{h.dateText || fmtEventDate(event.eventDate, lang)}</p>}
        {(event.venueName || event.venueAddress) && <p className="inv-muted mt-1 text-[14px]">{[event.venueName, event.venueAddress?.split(",").slice(-2).join(",").trim()].filter(Boolean).join(" · ")}</p>}
        {onReply && (
          <button type="button" onClick={onReply} className="inv-btn ghost mt-6">
            {replyBy ? t.replyBy(replyBy) : t.reply} <IconChevronDown size={16} />
          </button>
        )}
      </div>
      {invitee && (
        <div className="inv-card relative mt-8 flex items-center gap-3 text-left">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-[10px]" style={{ background: "color-mix(in srgb, var(--inv-accent) 18%, transparent)", color: "var(--inv-glow-text)" }}><IconGift size={18} /></span>
          <div>
            <p className="text-[15px] font-semibold" style={{ color: "var(--inv-head)" }}>{t.hi(invitee.householdName ?? invitee.firstName)}</p>
            <p className="inv-muted text-[13px]">{t.seatsSaved(invitee.maxPartySize)}</p>
          </div>
        </div>
      )}
    </header>
  );
}

function Countdown({ s, event, n }: { s: S; event: PublicInvitation["event"]; n?: number }) {
  const start = str(s.startAt) || (event.eventDate ? event.eventDate + "T16:00" : "");
  const t = useIt();
  const c = useCountdown(start ? new Date(start) : null);
  if (!start) return null;
  return (
    <SectionFrame id="countdown" n={n} heading={str(s.heading) || t.h.countdown}>
      {c?.done ? (
        <p className="inv-p">{t.todayIsTheDay}</p>
      ) : (
        <div role="timer" aria-label={c ? t.timer(c.days, c.hours, c.minutes) : t.countdown} className="inv-count">
          {([[t.units[0], c?.days], [t.units[1], c?.hours], [t.units[2], c?.minutes], [t.units[3], c?.seconds]] as const).map(([l, v]) => (
            <div key={l} aria-hidden><b>{v == null ? "–" : String(v).padStart(2, "0")}</b>{l}</div>
          ))}
        </div>
      )}
    </SectionFrame>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const { copied, copy } = useCopy();
  const t = useIt();
  return (
    <div className="flex items-center justify-between gap-3 border-b py-2.5 last:border-0" style={{ borderColor: "var(--inv-line)" }}>
      <span className="min-w-0"><span className="inv-muted block text-[12.5px]">{label}</span><span className="block break-all font-mono text-[14px]">{value}</span></span>
      <button type="button" onClick={() => copy(value)} aria-label={t.copy(label)} className="grid size-10 shrink-0 place-items-center rounded-md" style={{ color: "var(--inv-glow-text)" }}>{copied ? <IconCheck size={18} /> : <IconCopy size={18} />}</button>
    </div>
  );
}

function Gifts({ s, n }: { s: S; n?: number }) {
  const [show, setShow] = useState(false);
  const t = useIt();
  // Contract: mode "cash" | "registry" | "both"; bank details live in the nested `bank` object.
  const mode = str(s.mode) || "both";
  const bank = (s.bank ?? {}) as Record<string, string>;
  const cash = mode !== "registry";
  // Display only: the couple's message, their own payout details and registry links. No payment buttons or amounts.
  const registries = [...(Array.isArray(s.registries) ? (s.registries as { name?: string; url?: string }[]) : []), ...(str(s.registryUrl) ? [{ url: str(s.registryUrl) }] : [])]
    .filter((r, i, a): r is { name?: string; url: string } => typeof r.url === "string" && /^https:\/\//.test(r.url) && a.findIndex((x) => x.url === r.url) === i);
  const interac = cash ? str(s.interacEmail) : "";
  const hasBank = cash && Object.values(bank).some(Boolean);
  const canadian = bank.institutionNumber || bank.transitNumber || bank.accountNumber;
  return (
    <SectionFrame id="gift_list" n={n} heading={str(s.heading) || t.h.gift_list}>
      {str(s.note) && <p className="inv-p">{str(s.note)}</p>}
      <div className="mt-4 flex flex-col gap-2.5">
        {mode !== "cash" && registries.map((r, i) => <a key={i} href={r.url} target="_blank" rel="noopener noreferrer" className="inv-btn ghost justify-start"><IconExternal size={16} />{r.name || t.openRegistry}</a>)}
        {interac && (
          <div className="inv-card">
            <CopyRow label={t.interac} value={interac} />
            <p className="inv-muted mt-1 text-[13px]">{t.interacHint}</p>
          </div>
        )}
        {hasBank && (
          <>
            <button type="button" className="inv-btn ghost justify-start" aria-expanded={show} onClick={() => setShow(!show)}><IconGift size={16} />{show ? t.hideTransfer : t.showTransfer}</button>
            {show && (
              <div className="inv-card">
                {bank.holder && <CopyRow label={t.accountHolder} value={bank.holder} />}
                {bank.bank && <CopyRow label={t.bank} value={bank.bank} />}
                {canadian && <>
                  {bank.institutionNumber && <CopyRow label={t.institution} value={bank.institutionNumber} />}
                  {bank.transitNumber && <CopyRow label={t.transit} value={bank.transitNumber} />}
                  {bank.accountNumber && <CopyRow label={t.account} value={bank.accountNumber} />}
                </>}
                {bank.reference && <CopyRow label={t.reference} value={bank.reference} />}
                {(bank.iban || bank.bic) && <p className="inv-label mt-3">{t.international}</p>}
                {bank.iban && <CopyRow label={t.iban} value={bank.iban} />}
                {bank.bic && <CopyRow label={t.bic} value={bank.bic} />}
              </div>
            )}
          </>
        )}
      </div>
    </SectionFrame>
  );
}

/** Stylised map card (no third-party tiles until a licensed provider is chosen — design-review B6). */
function MapArt() {
  return (
    <>
      <svg aria-hidden className="roads" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M-10 120 C 60 100, 120 140, 200 96 S 300 60, 340 74" strokeWidth="6" />
        <path d="M40 -10 C 70 60, 90 120, 70 200" strokeWidth="3" />
        <path d="M230 -10 C 210 50, 250 110, 236 200" strokeWidth="3" />
        <path d="M-10 40 C 80 50, 180 20, 340 30" strokeWidth="2" />
        <path d="M120 200 C 140 160, 190 150, 340 160" strokeWidth="2" />
      </svg>
      <span aria-hidden className="inv-orb pin" />
    </>
  );
}

export function SectionBlock({ k, s, n, event, assets, calendarUrl, lang = "en" }: { k: string; s: S; n?: number; event: PublicInvitation["event"]; assets?: PublicInvitation["assets"]; calendarUrl?: string; lang?: string }) {
  const t = useIt();
  const heading = str(s.heading) || t.h[k];
  switch (k) {
    case "invitation_text":
      return (
        <SectionFrame id={k} n={n} heading={heading}>
          <p className="inv-p whitespace-pre-line">{str(s.body)}</p>
        </SectionFrame>
      );
    case "countdown":
      return <Countdown s={s} event={event} n={n} />;
    case "our_story": {
      const ms = arr<{ year: string; title: string; text: string; photo?: string }>(s.milestones);
      return (
        <SectionFrame id={k} n={n} heading={heading}>
          {str(s.text) && <p className="inv-p mb-4 whitespace-pre-line">{str(s.text)}</p>}
          {ms.length > 0 && (
            <ol className="inv-tl">
              {ms.map((m, i) => (
                <li key={i} className={"row" + (i === ms.length - 1 ? " now" : "")}>
                  <span className="t">{m.year}</span>
                  <span>
                    <span className="w block">{m.title}</span>
                    {m.text && <span className="s block">{m.text}</span>}
                    {m.photo && assets?.[m.photo] && (
                      <SafeImg src={proxied(assets[m.photo].url)} alt={m.title} loading="lazy" className="mt-3 aspect-[4/3] w-full rounded-[10px] object-cover" />
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </SectionFrame>
      );
    }
    case "timeline": {
      const rows = arr<{ time: string; title: string; description?: string }>(s.rows);
      return (
        <SectionFrame id={k} n={n} heading={heading}>
          <ol className="inv-tl">
            {rows.map((r, i) => (
              <li key={i} className={"row" + (i === 0 ? " now" : "")}>
                <span className="t">{r.time}</span>
                <span><span className="w block">{r.title}</span>{r.description && <span className="s block">{r.description}</span>}</span>
              </li>
            ))}
          </ol>
        </SectionFrame>
      );
    }
    case "venue": {
      const items = arr<{ label?: string; name: string; address?: string; startsAt?: string; endsAt?: string; mapQuery?: string; lat?: number; lng?: number; note?: string }>(s.items);
      return (
        <SectionFrame id={k} n={n} heading={heading}>
          <div className="space-y-3">
            {items.map((v, i) => {
              const q = v.lat != null && v.lng != null ? `${v.lat},${v.lng}` : v.mapQuery || [v.name, v.address].filter(Boolean).join(", ");
              const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
              return (
                <article key={i} className="inv-card">
                  <div className="inv-map lg"><MapArt /></div>
                  {v.label && <p className="inv-over mt-4">{v.label}</p>}
                  <h3 className="mt-1 text-[18px] font-bold" style={{ color: "var(--inv-head)", fontFamily: "var(--inv-display)" }}>{v.name}</h3>
                  {v.address && <p className="inv-muted mt-0.5 text-[14px]">{v.address}</p>}
                  {(v.startsAt || event.eventDate) && <p className="mt-1 text-[14px] font-semibold">{[fmtEventDate(event.eventDate, lang), v.startsAt && (v.endsAt ? `${v.startsAt}–${v.endsAt}` : v.startsAt)].filter(Boolean).join(" · ")}</p>}
                  {v.note && <p className="mt-2 text-[14px]">{v.note}</p>}
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="inv-btn ghost"><IconMap size={16} />{t.directions}</a>
                    {calendarUrl ? <a href={proxied(calendarUrl)} className="inv-btn ghost"><IconCalendar size={16} />{t.addToCalendar}</a> : <span />}
                  </div>
                </article>
              );
            })}
          </div>
        </SectionFrame>
      );
    }
    case "dress_code": {
      const pal = arr<string>(s.palette);
      return (
        <SectionFrame id={k} n={n} heading={heading}>
          {str(s.text) && <p className="inv-p">{str(s.text)}</p>}
          {pal.length > 0 && (
            <ul className="inv-swatch mt-4" aria-label={t.suggestedColours}>
              {pal.map((c) => <li key={c} className="flex-1"><i style={{ background: c }} /><span className="sr-only">{c}</span></li>)}
            </ul>
          )}
        </SectionFrame>
      );
    }
    case "gift_list":
      return <Gifts s={s} n={n} />;
    case "accommodation": {
      const rows = arr<{ name: string; address?: string; url?: string; note?: string }>(s.rows);
      return (
        <SectionFrame id={k} n={n} heading={heading}>
          <div className="space-y-3">
            {rows.map((r, i) => (
              <article key={i} className="inv-card">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[15.5px] font-semibold" style={{ color: "var(--inv-head)" }}>{r.name}</h3>
                  {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="grid size-11 shrink-0 place-items-center rounded-md" style={{ color: "var(--inv-glow-text)" }} aria-label={t.websiteFor(r.name)}><IconExternal size={18} /></a>}
                </div>
                {r.address && <p className="inv-muted mt-0.5 text-[13.5px]">{r.address}</p>}
                {r.note && <p className="mt-1.5 text-[13.5px]">{r.note}</p>}
              </article>
            ))}
          </div>
        </SectionFrame>
      );
    }
    case "transport": {
      const rows = arr<{ type: string; time?: string; from?: string; to?: string; note?: string }>(s.rows);
      return (
        <SectionFrame id={k} n={n} heading={heading}>
          <ol className="inv-tl">
            {rows.map((r, i) => (
              <li key={i} className="row">
                <span className="t">{r.time}</span>
                <span>
                  <span className="w block">{r.type}</span>
                  {(r.from || r.to) && <span className="s block">{r.from}{r.from && r.to && " → "}{r.to}</span>}
                  {r.note && <span className="s block">{r.note}</span>}
                </span>
              </li>
            ))}
          </ol>
        </SectionFrame>
      );
    }
    case "faq": {
      const rows = arr<{ question: string; answer: string }>(s.rows);
      return (
        <SectionFrame id={k} n={n} heading={heading}>
          {rows.map((r, i) => (
            <details key={i} className="inv-faq-item">
              <summary className="inv-faq">{r.question}<IconChevronDown size={18} className="shrink-0 transition-transform" /></summary>
              <div>{r.answer}</div>
            </details>
          ))}
        </SectionFrame>
      );
    }
    case "activities": {
      const rows = arr<{ name: string; date?: string; details?: string }>(s.rows);
      return (
        <SectionFrame id={k} n={n} heading={heading}>
          <div className="space-y-3">
            {rows.map((r, i) => <article key={i} className="inv-card"><p className="text-[15.5px] font-semibold" style={{ color: "var(--inv-head)" }}>{r.name}</p>{r.date && <p className="text-[13.5px] font-semibold" style={{ color: "var(--inv-glow-text)" }}>{r.date}</p>}{r.details && <p className="inv-muted mt-1 text-[13.5px]">{r.details}</p>}</article>)}
          </div>
        </SectionFrame>
      );
    }
    case "pre_wedding":
      return (
        <SectionFrame id={k} n={n} heading={heading}>
          <div className="inv-card">
            {str(s.date) && <p className="text-[14px] font-bold" style={{ color: "var(--inv-glow-text)" }}>{str(s.date)}</p>}
            {str(s.location) && <p className="mt-1 text-[15.5px] font-semibold" style={{ color: "var(--inv-head)" }}>{str(s.location)}</p>}
            {str(s.details) && <p className="inv-muted mt-1.5 text-[14px]">{str(s.details)}</p>}
          </div>
        </SectionFrame>
      );
    case "menu":
      return (
        <SectionFrame id={k} n={n} heading={heading}>
          {str(s.main) && <p className="text-[17px] font-semibold" style={{ color: "var(--inv-head)" }}>{str(s.main)}</p>}
          {str(s.courses) && <p className="inv-p mt-2 whitespace-pre-line">{str(s.courses)}</p>}
        </SectionFrame>
      );
    case "photos": {
      const rows = arr<{ assetId: string; name?: string }>(s.rows).filter((r) => assets?.[r.assetId]);
      return (
        <SectionFrame id={k} n={n} heading={heading}>
          {str(s.intro) && <p className="inv-p mb-4">{str(s.intro)}</p>}
          <ul className="inv-photos">
            {rows.map((r) => (
              <PhotoItem key={r.assetId} src={proxied(assets![r.assetId].url)} alt={r.name ?? ""} />
            ))}
          </ul>
        </SectionFrame>
      );
    }
    default:
      if (k.startsWith("custom:"))
        return (
          <SectionFrame id={k.replace(/[^a-z0-9]/gi, "-")} n={n} heading={str(s.title) || (k.slice(7).replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()))}>
            <p className="inv-p whitespace-pre-line">{str(s.content)}</p>
          </SectionFrame>
        );
      return null;
  }
}

/** Reply call-to-action card that leads into the form. */
export function ReplyCard({ replyBy, onReply, heading }: { replyBy?: string | null; onReply: () => void; heading?: string }) {
  const t = useIt();
  return (
    <div className="inv-card relative mt-12 overflow-hidden text-center">
      <div aria-hidden className="inv-bloom" style={{ width: 360, height: 360, left: "50%", top: -180, marginLeft: -180 }} />
      <div className="relative py-2">
        {replyBy && <p className="inv-over">{t.replyBy(replyBy)}</p>}
        <p className="mt-2 text-[24px] font-bold leading-tight" style={{ color: "var(--inv-head)", fontFamily: "var(--inv-display)", letterSpacing: "-.025em" }}>{heading || t.willYouJoin}</p>
        <button type="button" onClick={onReply} className="inv-btn mt-4 w-full">{t.replyNow} <IconArrowRight size={18} /></button>
      </div>
    </div>
  );
}

export function InviteFooter({ content, event, lang = "en", credit = true, light }: { content: InviteContent; event: PublicInvitation["event"]; lang?: string; credit?: boolean; light?: boolean }) {
  const t = useIt();
  const h = event.hostNames;
  const mono = [h.partner1?.[0], h.partner2?.[0]].filter(Boolean).join("·") || h.honoree?.[0] || "";
  const names = coupleNames(content, event);
  return (
    <footer className="pb-24 pt-12 text-center">
      {mono && <div aria-hidden className="mx-auto grid size-11 place-items-center rounded-[12px] text-[13px] font-bold" style={{ background: "var(--inv-raised)", boxShadow: "0 0 0 1px var(--inv-line)", color: "var(--inv-glow-text)" }}>{mono}</div>}
      <p className="mt-4 text-[17px] font-bold" style={{ color: "var(--inv-head)" }}>{content.footer?.signature || t.withLove(names)}</p>
      {event.eventDate && <p className="inv-muted mt-1 text-[13px]">{[fmtEventDate(event.eventDate, lang, "long"), event.venueName].filter(Boolean).join(" · ")}</p>}
      {credit && (
        <p className="inv-muted mt-6 flex items-center justify-center gap-1.5 text-[12.5px]">
          {t.madeWith} <Link href="/" className="inv-credit-link inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline" style={{ color: "var(--inv-ink)" }}><BrandSymbol size={14} dark={!light} />{BRAND_NAME}</Link>
        </p>
      )}
    </footer>
  );
}

export function fmtEventDate(d: string | null | undefined, lang = "en", style: "full" | "long" | "weekday" = "full") {
  if (!d) return "";
  const date = new Date(d.length <= 10 ? d + "T12:00:00" : d);
  try {
    if (style === "weekday") return new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long" }).format(date);
    return new Intl.DateTimeFormat(lang, { dateStyle: style }).format(date);
  } catch { return d; }
}

/** A gallery photo that removes itself if the file is missing, so guests never see a broken image. */
function PhotoItem({ src, alt }: { src: string; alt: string }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <li><img src={src} alt={alt} loading="lazy" onError={() => setGone(true)} /></li>;
}
