"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api, ApiError, proxied } from "@/lib/api";
import type { PublicInvitation } from "@/lib/types";
import { usePrefersReducedMotion } from "@/lib/hooks";
import { BrandSymbol } from "@/components/brand";
import { InviteLangProvider, inviteDict, useIt } from "@/lib/invite-i18n";
import { Hero, InviteFooter, Names, ReplyCard, SectionBlock, coupleNames, fmtEventDate, hasContent, inviteRoot, mergeConfig } from "./sections";
import { RsvpSection } from "./rsvp";
import { IconMusic, IconMusicOff, IconNote } from "@/components/ui/icons";
import { EmptyPage } from "@/components/ui/empty-page";

export function GuestInvite() {
  const { slug } = useParams<{ slug: string }>();
  const sp = useSearchParams();
  const g = sp.get("g");
  const preview = sp.get("preview");
  const lang = sp.get("lang") ?? undefined;
  const editLink = sp.get("rsvp") && sp.get("edit") ? { guestId: sp.get("rsvp")!, editToken: sp.get("edit")! } : null;
  const [data, setData] = useState<PublicInvitation | null>(null);
  const [err, setErr] = useState<ApiError | Error | null>(null);
  // Returning from an edit link or switching language skips the cover.
  const [opened, setOpened] = useState(() => !!editLink);

  useEffect(() => {
    setErr(null);
    api<PublicInvitation>(`/api/public/invitations/${encodeURIComponent(slug)}`, { query: { g, preview, lang } })
      .then((d) => {
        setData(d);
        document.documentElement.lang = d.lang;
      })
      .catch((e) => setErr(e));
  }, [slug, g, preview, lang]);

  if (err) return <InviteError err={err} lang={lang} />;
  if (!data)
    return (
      <div role="status" className="inv grid min-h-svh place-items-center">
        <span className="flex flex-col items-center gap-4"><span aria-hidden className="inv-orb animate-pulse" /><span className="inv-muted text-sm">Opening your invitation…</span></span>
      </div>
    );
  return <InviteBody data={data} slug={slug} g={g} preview={preview} editLink={editLink} opened={opened} setOpened={setOpened} />;
}

function InviteBody({ data, slug, g, preview, editLink, opened, setOpened }: { data: PublicInvitation; slug: string; g: string | null; preview: string | null; editLink: { guestId: string; editToken: string } | null; opened: boolean; setOpened: (v: boolean) => void }) {
  const cfg = useMemo(() => mergeConfig(data.theme?.defaultConfig, data.config), [data]);
  const root = useMemo(() => inviteRoot(cfg), [cfg]);
  const light = root.className.includes("light");
  const T = inviteDict(data.lang);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const sentOpen = useRef(false);
  const music = data.music;
  // Uploaded files can disappear (e.g. a host without persistent storage); a failed load turns the music button off.
  const [musicFailed, setMusicFailed] = useState(false);
  const musicUrl = music?.url && !musicFailed ? proxied(music.url) : null;

  function onOpened() {
    setOpened(true);
    if (!sentOpen.current && !data.invitation.preview) {
      sentOpen.current = true;
      api(`/api/public/invitations/${slug}/open`, { body: { g: g ?? undefined, lang: data.lang } }).catch(() => {});
    }
  }
  /** Music is strictly user-initiated: it starts from the tap on "Open invitation". */
  function startMusic() {
    if (musicUrl && music?.autoplayOnOpen && audio.current) {
      audio.current.volume = music.volume ?? 0.5;
      audio.current.play().then(() => setPlaying(true)).catch(() => {});
    }
  }
  function toggleMusic() {
    const a = audio.current;
    if (!a) return;
    if (a.paused) a.play().then(() => setPlaying(true)).catch(() => {});
    else { a.pause(); setPlaying(false); }
  }

  const order = (cfg.sectionOrder?.length ? cfg.sectionOrder : ["hero", ...Object.keys(data.content.sections ?? {}), "rsvp"]).filter((k) => !(cfg.hiddenSections ?? []).includes(k));
  const sections = data.content.sections ?? {};
  const href = (l: string) => {
    const p = new URLSearchParams();
    if (g) p.set("g", g);
    if (preview) p.set("preview", preview);
    p.set("lang", l);
    return `?${p}`;
  };
  const heroBg = data.content.hero?.backgroundAssetId ? proxied(data.assets[data.content.hero.backgroundAssetId]?.url) : undefined;
  const replyBy = data.rsvp?.deadline ? fmtEventDate(data.rsvp.deadline, data.lang, "weekday") : null;
  const toRsvp = () => document.getElementById("s-rsvp")?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Number only the sections that actually render.
  const numbered = order.filter((k) => k !== "hero" && k !== "rsvp" && hasContent(k, sections[k] as Record<string, unknown> | undefined));
  const blocks = order.map((k) => {
    if (k === "hero") return <Hero key={k} content={data.content} event={data.event} bg={heroBg} replyBy={data.rsvp?.open ? replyBy : null} invitee={data.invitee} lang={data.lang} onReply={data.rsvp?.open ? toRsvp : undefined} />;
    if (k === "rsvp") {
      if (!data.rsvp) return null;
      return (
        <div key={k}>
          {data.rsvp.open && <ReplyCard replyBy={replyBy} onReply={() => document.getElementById("rsvp-form")?.scrollIntoView({ behavior: "smooth", block: "start" })} heading={(sections.rsvp as { heading?: string } | undefined)?.heading} />}
          <RsvpSection data={data} slug={slug} personalToken={g} editLink={editLink} replyBy={replyBy} />
        </div>
      );
    }
    const s = sections[k] as Record<string, unknown> | undefined;
    if (!hasContent(k, s)) return null;
    return <SectionBlock key={k} k={k} n={numbered.indexOf(k) + 1} s={s!} event={data.event} assets={data.assets} calendarUrl={data.calendarUrl} lang={data.lang} />;
  });

  return (
    <InviteLangProvider lang={data.lang}>
    <div lang={data.lang} style={root.style} className={root.className + " min-h-svh"}>
      {(data.invitation.preview || data.invitation.demo) && (
        <div className="sticky top-0 z-30 px-4 py-2 text-center text-[13px] font-semibold" style={{ background: "var(--inv-accent)", color: "var(--inv-on-accent)" }}>
          {data.invitation.preview ? T.previewBanner : T.demoBanner}
        </div>
      )}
      {data.languages.length > 1 && (
        <nav aria-label={T.language} className="inv-lang" style={data.invitation.preview || data.invitation.demo ? { top: 52 } : undefined}>
          {data.languages.map((l) => (
            <button key={l} type="button" aria-pressed={l === data.lang} lang={l} onClick={() => { if (l !== data.lang) location.assign(href(l)); }}>{l.toUpperCase()}</button>
          ))}
        </nav>
      )}
      {!opened && <Opening data={data} light={light} onTap={startMusic} onOpen={onOpened} />}
      {/* B5: content is always rendered under the fixed cover and revealed when it lifts. */}
      <div className="inv-col" aria-hidden={!opened || undefined} inert={!opened || undefined}>
        <main id="main" className={opened ? "inv-reveal" : undefined}>{blocks}</main>
        <InviteFooter content={data.content} event={data.event} lang={data.lang} light={light} />
      </div>

      {opened && music && !musicFailed && (
        <button
          type="button"
          onClick={toggleMusic}
          disabled={!musicUrl}
          aria-pressed={playing}
          aria-label={!musicUrl ? "Music not available yet" : playing ? T.pauseMusic : T.playMusic}
          title={!musicUrl ? `${music.title} (audio coming soon)` : `${music.title} · ${music.artist}`}
          className="inv-float disabled:opacity-60"
          style={{ position: "fixed", right: "max(16px, calc(50% - 230px + 16px))", bottom: "calc(16px + env(safe-area-inset-bottom))" }}
        >
          {playing ? <IconMusic size={18} /> : <IconMusicOff size={18} />}
        </button>
      )}
      {musicUrl && <audio ref={audio} src={musicUrl} loop preload="none" onError={() => { setPlaying(false); setMusicFailed(true); }} />}
    </div>
    </InviteLangProvider>
  );
}

/**
 * Opening: "growing glow" (design/invite.css `.opening`). The halo swells from the centre and the
 * names fade up on arrival; tapping "Open invitation" lifts the cover to reveal the invitation.
 * Reduced motion: static lit cover and a short cross-fade.
 */
function Opening({ data, light, onTap, onOpen }: { data: PublicInvitation; light: boolean; onTap: () => void; onOpen: () => void }) {
  const t = useIt();
  const reduced = usePrefersReducedMotion();
  const [leaving, setLeaving] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const names = coupleNames(data.content, data.event);
  const venue = [data.event.venueName, data.event.venueAddress?.split(",").slice(-2).join(",").trim()].filter(Boolean).join(" · ");

  useEffect(() => { btn.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  function open() {
    if (leaving) return;
    onTap();
    setLeaving(true);
    setTimeout(onOpen, reduced ? 200 : 900);
  }
  return (
    <div role="dialog" aria-modal="true" aria-label={t.invitationFrom(names)} className={"opening" + (leaving ? " leaving" : " play")}>
      <span aria-hidden className="halo" />
      <span aria-hidden className="spark" />
      <div className="content px-8">
        <span aria-hidden className="mx-auto mb-5 block w-fit"><BrandSymbol size={36} dark={!light} /></span>
        {data.invitee && <p className="mb-3 text-[15px] font-semibold" style={{ color: "var(--inv-head)" }}>{t.dear(data.invitee.householdName ?? [data.invitee.firstName, data.invitee.lastName].filter(Boolean).join(" "))}</p>}
        <p className="inv-over">{data.content.hero?.tagline || t.youreInvited}</p>
        <Names names={names} className="inv-names mt-3" as="p" />
        <div aria-hidden className="inv-rule mx-auto my-6" />
        {data.event.eventDate && <p className="text-[16px] font-bold" style={{ color: "var(--inv-glow-text)" }}>{data.content.hero?.dateText || fmtEventDate(data.event.eventDate, data.lang)}</p>}
        {venue && <p className="inv-muted mt-1 text-[14px]">{venue}</p>}
        <button ref={btn} type="button" onClick={open} className="inv-btn mt-9">{t.openInvitation}</button>
        {data.music && <p className="inv-muted mt-4 flex items-center justify-center gap-1.5 text-[13px]"><IconNote size={16} />{t.musicStarts}</p>}
      </div>
    </div>
  );
}

function InviteError({ err, lang }: { err: Error; lang?: string }) {
  const t = inviteDict(lang);
  const e = err as ApiError;
  const gone = e.status === 410;
  const archived = gone ? (e.details?.archived as { title?: string; eventDate?: string } | undefined) : undefined;
  const nf = e.status === 404;
  return (
    <EmptyPage
      title={gone ? t.endedTitle : nf ? t.notFoundTitle : t.wrong}
      body={gone ? t.tookPlace(archived?.title ?? t.invitation, archived?.eventDate ? fmtEventDate(archived.eventDate, lang) : "—")
        : nf ? t.notFoundBody
        : e.message}
      action={!gone && !nf ? { label: t.tryAgain, onClick: () => location.reload() } : undefined}
    />
  );
}
