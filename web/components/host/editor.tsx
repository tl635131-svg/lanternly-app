"use client";
import { SLUG_MESSAGE, slugIssue, toSlug } from "@/lib/validate";
import { AddonsDialog, ExtraPicker, QuoteTable, addonNeed, missingFrom, offeredFor, type Lock, type Quote } from "./addons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError, localPath, proxied } from "@/lib/api";
import { useEvent } from "@/lib/event-context";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { cleanConfig, countExtras, expandExtras, slugHistory, usesOwnSong, themeFits, type Catalogue, type EventT, Invitation, InvitationConfig, InviteContent, MusicTrack, Palette, ShareKit, Theme } from "@/lib/types";
import { formatDate, humanize, money, t } from "@/lib/format";
import { Badge, Button, ButtonLink, Card, Dialog, ErrorState, Field, LoadingBlock, Notice, Segmented, StatusChip, Toggle, cx, inputCls } from "@/components/ui/primitives";
import { IconArrowLeft, IconArrowRight, IconChevronDown, IconCloudCheck, IconExternal, IconEye, IconEyeOff, IconLock, IconPlus, IconSend, IconTrash, IconSparkle } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { Hero, InviteFooter, ReplyCard, SectionBlock, hasContent, inviteRoot, mergeConfig } from "@/components/invite/sections";
import { DEFAULT_PALETTE } from "@/lib/palette";
import { ThemePhone } from "@/components/marketing/theme-card";
import { visibleFields, CORE, SECTION_DEFS, customLabel, defFor, normalizeSection, slugifyCustom, validateSection } from "./section-defs";
import { CopyField, ShareActions, ShareKitPanel } from "./share";
import { FieldEditor, RightsCheck, acceptFor, TrackList, musicErrorText, uploadAsset, useEventAssets } from "./fields";

export function InvitationPage() {
  const { event } = useEvent();
  const inv = useAsync(() => api<Invitation>(`/api/events/${event!.id}/invitation`), [event?.id]);
  if (inv.loading && !inv.data) return <LoadingBlock label="Loading your invitation" rows={5} />;
  if (inv.error) return <ErrorState error={inv.error} onRetry={() => inv.reload()} />;
  if (!inv.data!.editable) return <StudioInvitation inv={inv.data!} onReload={() => inv.reload(true)} />;
  return <Editor initial={inv.data!} onReload={() => inv.reload(true)} />;
}

/* ───────── Studio events: read-only preview + share kit ───────── */
function StudioInvitation({ inv, onReload }: { inv: Invitation; onReload: () => void }) {
  const { event, reload, canWrite } = useEvent();
  const cat = useAsync(() => api<Catalogue>("/api/public/catalogue"));
  const [addons, setAddons] = useState<Record<string, number> | null>(null);
  const plan = cat.data?.plans.find((p) => p.code === event!.planCode);
  const kit = useAsync(() => api<ShareKit>(`/api/events/${event!.id}/share-kit`), [event?.id]);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl">Your invitation</h1>
          <p className="mt-1 text-muted">Our studio designs and edits this for you. Ask for changes from the review page.</p>
        </div>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Status</h2>
            {inv.status === "published" ? <StatusChip tone="attending">Live · version {inv.publishedVersion ?? inv.version}</StatusChip> : <StatusChip tone="neutral">Draft · not published</StatusChip>}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink href={localPath(inv.status === "published" ? inv.url : inv.previewUrl)} target="_blank" rel="noopener"><IconEye size={18} />Open {inv.status === "published" ? "live invitation" : "draft preview"}</ButtonLink>
            <ButtonLink href={`/app/${event!.id}/revisions`} variant="outline">Request changes</ButtonLink>
          </div>
        </Card>
        <LinkCard inv={inv} onInv={() => onReload()} onNeedAddon={() => setAddons({ custom_link: 1 })} linkPrice={cat.data?.extras.find((x) => x.code === "custom_link")?.priceCents} canWrite={canWrite} onChanged={reload} included={plan?.includesAllExtras} />
        {event!.myRole === "owner" && !plan?.includesAllExtras && (
          <Card className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-semibold">Add extras</h2><p className="text-sm text-muted">Your own song, a monogram, extra languages and more, any time.</p></div>
            <Button variant="outline" onClick={() => setAddons({})}>Add extras</Button>
          </Card>
        )}
        <AddonsDialog open={!!addons} onClose={() => setAddons(null)} need={addons ?? {}} />
        <Card>
          <h2 className="font-semibold">Share kit</h2>
          {kit.loading && !kit.data ? <LoadingBlock rows={2} /> : kit.error ? <ErrorState error={kit.error} onRetry={() => kit.reload()} /> : !kit.data!.published ? (
            <p className="mt-2 text-sm text-muted">Your share kit appears once the invitation is published.</p>
          ) : (
            <div className="mt-3"><ShareKitPanel kit={kit.data!} eventId={event!.id} title={event!.title} /></div>
          )}
        </Card>
      </div>
      <PhonePreview src={localPath(inv.status === "published" ? inv.url : inv.previewUrl)} />
    </div>
  );
}

function PhonePreview({ src }: { src: string }) {
  return (
    <div className="sticky top-20 hidden justify-center lg:flex" id="preview">
      <div className="phone"><div className="scr"><span aria-hidden className="notch" /><iframe title="Invitation preview" src={src} className="size-full border-0" /></div></div>
    </div>
  );
}

/* ───────── Self-serve editor ───────── */
type Draft = { themeKey: string; content: Record<string, InviteContent>; config: InvitationConfig };
type Tab = "design" | "content" | "sections" | "music" | "details";

function Editor({ initial, onReload }: { initial: Invitation; onReload: () => void }) {
  const { event, reload: reloadEvent, canWrite } = useEvent();
  const { me } = useSession();
  const toast = useToast();
  const cat = useAsync(() => api<Catalogue>("/api/public/catalogue"));
  const music = useAsync(() => api<{ items: MusicTrack[] }>("/api/public/music"));
  const [inv, setInv] = useState(initial);
  const [draft, setDraft] = useState<Draft>({ themeKey: initial.theme?.key ?? "", content: initial.content ?? {}, config: initial.config ?? {} });
  const [lang, setLang] = useState(initial.locale || event!.primaryLanguage || "en");
  const [tab, setTab] = useState<Tab>("design");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [addons, setAddons] = useState<{ need: Record<string, number>; reason?: string; languages?: string[] } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [mobilePreview, setMobilePreview] = useState(false);
  const [serverErrs, setServerErrs] = useState<Record<string, Record<string, string>>>({});
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const assets = useEventAssets(event!.id);
  const assetMap = useMemo(() => Object.fromEntries((assets.items ?? []).map((a) => [a.id, { url: a.url, mime: a.mime, kind: a.kind }])), [assets.items]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const themes = useMemo(() => (cat.data?.themes ?? []).filter((x) => themeFits(x, event!.product || "wedding_invite")), [cat.data, event]);
  const theme = themes.find((x) => x.key === draft.themeKey);
  const cfg = useMemo(() => mergeConfig(theme?.defaultConfig, draft.config), [theme, draft.config]);
  const c: InviteContent = draft.content[lang] ?? { hero: {}, sections: {} };
  const order = draft.config.sectionOrder?.length ? draft.config.sectionOrder : ["hero", ...Object.keys(c.sections ?? {})];
  const hidden = draft.config.hiddenSections ?? [];
  const sectionTitle = (k: string) => (k.startsWith("custom:") ? ((c.sections?.[k] as { title?: string } | undefined)?.title || customLabel(k)) : undefined);
  const clientErrs = useMemo(() => {
    const out: Record<string, Record<string, string>> = {};
    for (const [l, cc] of Object.entries(draft.content)) for (const [k, v] of Object.entries(cc.sections ?? {})) {
      const e = validateSection(defFor(k), v as Record<string, unknown>);
      if (Object.keys(e).length) out[l === lang ? k : `${l}:${k}`] = e;
    }
    return out;
  }, [draft.content, lang]);
  const errsFor = (k: string) => ({ ...(serverErrs[k] ?? {}), ...(clientErrs[k] ?? {}) });

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    setSaving(true);
    setSaveErr(null);
    try {
      const d = draftRef.current;
      const content = Object.fromEntries(Object.entries(d.content).map(([l, cc]) => [l, { ...cc, sections: Object.fromEntries(Object.entries(cc.sections ?? {}).map(([k, v]) => [k, normalizeSection(defFor(k), v as Record<string, unknown>)])) }]));
      const res = await api<Invitation>(`/api/events/${event!.id}/invitation`, { method: "PUT", body: { themeKey: d.themeKey || undefined, content, config: cleanConfig(d.config), locale: lang } });
      setServerErrs({});
      setInv(res);
      setDirty(false);
      setSavedAt(new Date());
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.fields) {
        // Map `content.<lang>.sections.<key>.<path>` back to inline field errors.
        const next: Record<string, Record<string, string>> = {};
        const other: string[] = [];
        for (const [path, m] of Object.entries(e.fields)) {
          const hit = /^content\.([^.]+)\.sections\.([^.]+)\.(.+)$/.exec(path);
          if (hit) { const key = hit[1] === lang ? hit[2] : `${hit[1]}:${hit[2]}`; (next[key] ??= {})[hit[3]] = m; }
          else other.push(`${path}: ${m}`);
        }
        setServerErrs(next);
        setSaveErr(other.length ? other.slice(0, 2).join("; ") : "Some fields need attention (see the Content tab)");
      } else if (e instanceof ApiError && (e.code === "GIFT_PAYOUT_REQUIRED" || e.code === "GIFT_REGISTRY_URL_REQUIRED" || e.code === "GIFT_REGISTRY_REQUIRED")) {
        // Gift money mode is display-only; the API may insist on at least one way to give.
        setServerErrs({ gift_list: { [e.code === "GIFT_PAYOUT_REQUIRED" ? "bank" : "registries"]: e.message } });
        setSaveErr("Gifts needs one more detail (see Content → Gifts)");
      } else {
        const need = addonNeed(e);
        if (need) setAddons({ need, reason: "Your draft uses an add-on you haven't bought yet. Add it to keep this change." });
        setSaveErr(need ? "Needs an add-on" : musicErrorText(e));
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [event, lang]);

  const update = (fn: (d: Draft) => Draft) => {
    setDraft((d) => fn(d));
    setDirty(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(), 1500);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); } };
    const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("beforeunload", beforeUnload); };
  }, [save, dirty]);

  const setContent = (fn: (c: InviteContent) => InviteContent) => update((d) => ({ ...d, content: { ...d.content, [lang]: fn(d.content[lang] ?? { hero: {}, sections: {} }) } }));
  const setSection = (key: string, value: Record<string, unknown>) => {
    if (serverErrs[key]) setServerErrs((x) => { const n = { ...x }; delete n[key]; return n; });
    setContent((cc) => ({ ...cc, sections: { ...cc.sections, [key]: value } }));
  };
  const setConfig = (patch: Partial<InvitationConfig>) => update((d) => ({ ...d, config: { ...d.config, ...patch } }));

  /** Event languages save instantly (PATCH event). The draft keeps one content block per language. */
  async function changeLanguages(next: string[]) {
    try {
      // Before payment the API auto-adds (or trims) extra_language units in selectedExtras; we just read them back.
      const ev = await api<EventT>(`/api/events/${event!.id}`, { method: "PATCH", body: { languages: next } });
      const from = draftRef.current.content[lang] ?? draftRef.current.content[event!.primaryLanguage] ?? { hero: {}, sections: {} };
      update((d) => ({ ...d, content: Object.fromEntries(next.map((l) => [l, d.content[l] ?? structuredClone(from)])) }));
      if (!next.includes(lang)) setLang(next[0]);
      reloadEvent();
      const added = next.find((l) => !event!.languages.includes(l));
      const units = (ev?.selectedExtras ?? []).filter((c) => c === "extra_language").length;
      const price = cat.data?.extras.find((x) => x.code === "extra_language");
      toast(`${added ? `${added.toUpperCase()} added. We copied your current text so you can translate it.` : "Languages updated."}${!event!.paid && units ? ` Extra language × ${units} is in your order${price ? ` (${money(price.priceCents, price.currency)} each)` : ""}.` : ""}`);
    } catch (e) {
      const need = addonNeed(e);
      if (need) setAddons({ need, languages: next, reason: "Each language beyond your plan's limit is an Extra language add-on. Once paid, the new language is added." });
      else toast(e instanceof ApiError && e.code === "INVALID_SELECTION" ? `${e.message}. You can use up to 8 languages.` : e instanceof Error ? e.message : "Couldn't change languages", "error");
    }
  }

  async function publish() {
    const bad = Object.keys(clientErrs);
    if (bad.length) {
      setTab("content");
      toast(`Fill in the required fields first: ${bad.map((k) => { const [l, key] = k.includes(":") && !k.startsWith("custom:") ? k.split(/:(.+)/) : [null, k]; return `${key.startsWith("custom:") ? customLabel(key) : defFor(key)?.label ?? key}${l ? ` (${l.toUpperCase()})` : ""}`; }).join(", ")}`, "error");
      return;
    }
    if (dirty && !(await save())) return;
    setPublishing(true);
    try {
      await api(`/api/events/${event!.id}/invitation/publish`, { method: "POST" });
      toast(inv.publishedVersion ? "Changes are live" : "Your invitation is live");
      onReload();
      reloadEvent();
      const fresh = await api<Invitation>(`/api/events/${event!.id}/invitation`);
      setInv(fresh);
    } catch (e) {
      const need = addonNeed(e);
      if (e instanceof ApiError && e.code === "PAYMENT_REQUIRED") setPayOpen(true);
      else if (need) setAddons({ need, reason: "These changes use an add-on you haven't bought yet. Add it, then publish your changes." });
      else toast(e instanceof Error ? e.message : "Couldn't publish", "error");
    } finally {
      setPublishing(false);
    }
  }
  async function discard() {
    setDiscarding(true);
    try {
      clearTimeout(timer.current);
      await api(`/api/events/${event!.id}/invitation/discard-draft`, { method: "POST" });
      const fresh = await api<Invitation>(`/api/events/${event!.id}/invitation`);
      setInv(fresh);
      setDraft({ themeKey: fresh.theme?.key ?? "", content: fresh.content ?? {}, config: fresh.config ?? {} });
      setDirty(false);
      setServerErrs({});
      setSaveErr(null);
      setConfirmDiscard(false);
      toast("Draft discarded. You're editing the live version again.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't discard the draft", "error");
    } finally {
      setDiscarding(false);
    }
  }
  async function unpublish() {
    try {
      await api(`/api/events/${event!.id}/invitation/unpublish`, { method: "POST" });
      toast("Your invitation is back in draft");
      setInv(await api<Invitation>(`/api/events/${event!.id}/invitation`));
      reloadEvent();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't unpublish", "error");
    }
  }

  const live = inv.status === "published";
  const liveVersion = inv.publishedVersion ?? (live ? inv.version : null);
  const changed = live && (dirty || inv.hasUnpublishedChanges !== false);
  const diyPrice = cat.data?.plans.find((p) => p.code === "diy")?.basePriceCents;
  const statusText = saving ? "Saving…" : saveErr ? "Not saved" : dirty ? "Unsaved changes" : savedAt ? `Saved ${savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "All changes saved";

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {/* B2: header status comes from the invitation's real status */}
          <h1 className="font-display flex flex-wrap items-center gap-3 text-[28px] leading-tight sm:text-h1">Invitation {live ? <StatusChip tone="attending">Live · version {liveVersion}</StatusChip> : <StatusChip tone="neutral">{liveVersion ? "Unpublished" : "Draft · not published"}</StatusChip>}{changed && <StatusChip tone="maybe">Unpublished changes</StatusChip>}</h1>
          <p className="mt-1 text-body-sm text-muted">Style, content, sections and music save to your <strong className="font-semibold text-ink">draft</strong>{live ? <>. Guests see them after <strong className="font-semibold text-ink">Publish changes</strong></> : null}. Event details, the reply form and your link save instantly.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cx("mr-1 inline-flex items-center gap-1.5 text-caption", saveErr ? "text-danger" : "text-muted")} aria-live="polite"><IconCloudCheck size={16} className={saveErr ? "" : "text-success"} />{live ? "Draft: " : ""}{statusText}{saveErr ? ` · ${saveErr}` : ""}</span>
          {saveErr && !saving && <Button variant="ghost" size="sm" onClick={save}>Retry</Button>}
          {event!.languages.length > 1 && <Segmented label="Content language" value={lang} onChange={setLang} options={event!.languages.map((l) => ({ value: l, label: l.toUpperCase() }))} />}
          <Button variant="outline" onClick={() => setMobilePreview(true)} className="lg:hidden"><IconEye size={18} />Preview</Button>
          <ButtonLink variant="outline" href={localPath(inv.previewUrl)} target="_blank" rel="noopener" className="hidden sm:inline-flex"><IconExternal size={18} />Draft preview</ButtonLink>
          {live && <ButtonLink variant="ghost" href={localPath(inv.url)} target="_blank" rel="noopener" className="hidden sm:inline-flex">View live page</ButtonLink>}
          {dirty && <Button variant="outline" onClick={save} loading={saving} disabled={!canWrite}>Save draft</Button>}
          {live ? (
            <>
              <Button variant="accent" onClick={publish} loading={publishing} disabled={!canWrite || !changed}><IconSend size={18} />Publish changes</Button>
              <Button variant="ghost" onClick={unpublish} disabled={!canWrite}>Unpublish</Button>
            </>
          ) : (
            <Button variant="accent" onClick={publish} loading={publishing} disabled={!canWrite}><IconSend size={18} />{event!.paid || diyPrice == null ? "Publish" : `Publish · ${money(diyPrice)}`}</Button>
          )}
        </div>
      </div>
      {changed && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
          <p><strong className="font-semibold">Guests still see version {liveVersion}.</strong> Publish changes when you&apos;re ready, or discard the draft to go back to the live version.</p>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(true)} disabled={!canWrite}>Discard draft</Button>
            <Button size="sm" variant="accent" onClick={publish} loading={publishing} disabled={!canWrite}>Publish changes</Button>
          </span>
        </div>
      )}
      {!canWrite && <Notice className="mb-4"><IconLock size={16} className="mr-1 inline" />You have view-only access to this invitation.</Notice>}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {/* B3: never wraps; scrolls sideways with an edge fade on small screens */}
          <ScrollFadeTabs tab={tab} setTab={setTab} />
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            <fieldset disabled={!canWrite} className="contents">
              {tab === "design" && <DesignPanel themes={themes} themeKey={draft.themeKey} cfg={cfg} onTheme={(th) => update((d) => ({ ...d, themeKey: th.key, config: { ...d.config, palette: { ...th.defaultConfig?.palette }, fonts: { ...th.defaultConfig?.fonts }, ...(th.defaultConfig?.cover ? { cover: { ...th.defaultConfig.cover } } : {}) } }))} onPalette={(p) => setConfig({ palette: { ...draft.config.palette, ...p } })} />}
              {tab === "content" && <ContentPanel languages={<LanguagesCard cat={cat.data} lang={lang} onChange={changeLanguages} onNeedAddon={(n, langs) => setAddons({ need: { extra_language: n }, languages: langs, reason: "Each language beyond your plan's limit is an Extra language add-on. Once paid, the new language is added." })} />} c={c} order={order} setContent={setContent} setSection={setSection} errsFor={errsFor} sectionTitle={sectionTitle} onFocusSection={setFocusKey} />}
              {tab === "sections" && <SectionsPanel order={order} hidden={hidden} sections={c.sections ?? {}} catalogueSections={cat.data?.sections ?? []}
                onOrder={(o) => setConfig({ sectionOrder: o })} onHidden={(h) => setConfig({ hiddenSections: h })}
                onAdd={(k, title) => update((d) => {
                  const o = d.config.sectionOrder?.length ? [...d.config.sectionOrder] : [...order];
                  const at = o.indexOf("rsvp");
                  if (!o.includes(k)) o.splice(at >= 0 ? at : o.length, 0, k);
                  const cc = d.content[lang] ?? { sections: {} };
                  return { ...d, config: { ...d.config, sectionOrder: o }, content: { ...d.content, [lang]: { ...cc, sections: { ...cc.sections, [k]: cc.sections?.[k] ?? (k.startsWith("custom:") ? { title: title || customLabel(k), content: "" } : {}) } } } };
                })}
                onRemove={(k) => update((d) => {
                  const o = (d.config.sectionOrder ?? order).filter((x) => x !== k);
                  const contents = Object.fromEntries(Object.entries(d.content).map(([l, cc]) => { const s = { ...cc.sections }; delete s[k]; return [l, { ...cc, sections: s }]; }));
                  return { ...d, config: { ...d.config, sectionOrder: o, hiddenSections: (d.config.hiddenSections ?? []).filter((x) => x !== k) }, content: contents };
                })} />}
              {tab === "music" && <MusicPanel tracks={music.data?.items ?? []} loading={music.loading} error={music.error} cfg={draft.config} onChange={(m) => setConfig({ music: { ...draft.config.music, ...m } })}
                ownSongOffered={offeredFor(cat.data, "diy").some((x) => x.code === "own_song")} onNeedAddon={() => setAddons({ need: { own_song: 1 } })} />}
              {tab === "details" && <DetailsPanel inv={inv} onInv={setInv} onNeedAddon={() => setAddons({ need: { custom_link: 1 } })} linkPrice={cat.data?.extras.find((x) => x.code === "custom_link")?.priceCents} />}
            </fieldset>
          </div>
        </div>
        <aside aria-label="Live preview" id="preview" className="sticky top-20 hidden flex-col items-center lg:flex">
          <p className="mb-3 self-end text-caption text-muted">Live preview{focusKey ? ` · scrolled to ${focusKey === "hero" ? "the cover" : (sectionTitle(focusKey) ?? defFor(focusKey)?.label ?? humanize(focusKey))}` : ""}</p>
          <LivePreview cfg={cfg} content={c} order={order} hidden={hidden} assets={assetMap} focusKey={focusKey} />
        </aside>
      </div>

      <Dialog open={mobilePreview} onClose={() => setMobilePreview(false)} title="Preview">
        <div className="flex justify-center"><LivePreview cfg={cfg} content={c} order={order} hidden={hidden} assets={assetMap} /></div>
      </Dialog>
      <Dialog open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title="Discard your draft?"
        footer={<><Button variant="ghost" onClick={() => setConfirmDiscard(false)}>Keep editing</Button><Button variant="danger" onClick={discard} loading={discarding}>Discard draft</Button></>}>
        <p className="text-sm">Your unpublished style, content, section and music changes are removed and the editor goes back to version {liveVersion}, the one guests see. Event details, reply settings and your link aren&apos;t affected.</p>
      </Dialog>
      <AddonsDialog open={!!addons} onClose={() => setAddons(null)} need={addons?.need} reason={addons?.reason} languages={addons?.languages} />
      <PayDialog open={payOpen} onClose={() => setPayOpen(false)} email={me?.user.email ?? ""} cat={cat.data} inv={inv} onChooseDesign={() => setTab("design")} />
    </div>
  );
}

const TABS: [Tab, string][] = [["design", "Style"], ["content", "Content"], ["sections", "Sections"], ["music", "Music"], ["details", "Link"]];
function ScrollFadeTabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <div className="mb-4">
      <Segmented label="Editor panels" value={tab} onChange={setTab} options={TABS.map(([value, label]) => ({ value, label }))} />
    </div>
  );
}

/** B1: fixed 300×620 phone (`.phone > .scr.inv`), scrolls internally and follows the section being edited. */
function LivePreview({ cfg, content, order, hidden, assets, focusKey }: { cfg: InvitationConfig; content: InviteContent; order: string[]; hidden: string[]; assets: Record<string, { url: string; mime: string; kind: string }>; focusKey?: string | null }) {
  const { event } = useEvent();
  const scr = useRef<HTMLDivElement>(null);
  const ev = { title: event!.title, hostNames: event!.hostNames, eventDate: event!.eventDate, timezone: event!.timezone, venueName: event!.venueName, venueAddress: event!.venueAddress };
  const root = inviteRoot(cfg);
  useEffect(() => {
    const box = scr.current;
    if (!box || !focusKey) return;
    const id = focusKey === "hero" ? "s-hero" : `s-${focusKey.startsWith("custom:") ? focusKey.replace(/[^a-z0-9]/gi, "-") : focusKey}`;
    const el = box.querySelector<HTMLElement>(`[id="${id}"]`);
    if (el) box.scrollTo({ top: Math.max(0, el.offsetTop - 24), behavior: "smooth" });
  }, [focusKey]);
  const numbered = order.filter((k) => !hidden.includes(k) && k !== "hero" && k !== "rsvp" && hasContent(k, content.sections?.[k] as Record<string, unknown> | undefined));
  return (
    <div className="phone">
      <div ref={scr} className={cx("scr overflow-y-auto overscroll-contain", root.className)} style={root.style}>
        <span aria-hidden className="notch" style={{ position: "sticky", display: "block", marginBottom: -24 }} />
        <div className="inv-col !px-5">
          {order.filter((k) => !hidden.includes(k)).map((k) => {
            if (k === "hero") return <Hero key={k} headingAs="h2" content={content} event={ev} bg={content.hero?.backgroundAssetId && assets[content.hero.backgroundAssetId] ? proxied(assets[content.hero.backgroundAssetId].url) : undefined} />;
            if (k === "rsvp") {
              const s = (content.sections?.rsvp ?? {}) as { heading?: string };
              return <div key={k} id="s-rsvp"><ReplyCard heading={s.heading} onReply={() => {}} /></div>;
            }
            const s = content.sections?.[k] as Record<string, unknown> | undefined;
            if (!hasContent(k, s)) return null;
            return <SectionBlock key={k} k={k} n={numbered.indexOf(k) + 1} s={s!} event={ev} assets={assets} />;
          })}
          <InviteFooter content={content} event={ev} credit={false} />
        </div>
      </div>
    </div>
  );
}

function DesignPanel({ themes, themeKey, cfg, onTheme, onPalette }: { themes: Theme[]; themeKey: string; cfg: InvitationConfig; onTheme: (t: Theme) => void; onPalette: (p: Partial<Palette>) => void }) {
  const p = { ...DEFAULT_PALETTE, ...cfg.palette } as Palette;
  const labels: Record<keyof Palette, string> = { background: "Background", surface: "Cards", text: "Text", muted: "Soft text", primary: "Buttons", onPrimary: "Button text", accent: "Highlights", glow: "Glow" };
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <h2 className="font-semibold">Style</h2>
        <p className="text-sm text-muted">Switching style resets colours and fonts to that style&apos;s defaults. Your words stay.</p>
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-6">
          {themes.map((th, i) => (
            <button key={th.key} type="button" aria-pressed={th.key === themeKey} disabled={th.status !== "active"} onClick={() => onTheme(th)}
              className={cx("relative rounded-card p-1.5 text-left disabled:opacity-50", th.key === themeKey ? "bg-tint shadow-[inset_0_0_0_2px_var(--brand-primary)]" : "hover:bg-surface-2")}>
              <ThemePhone theme={th} index={i} names="A & J" small />
              {th.key === themeKey && <span aria-hidden className="absolute right-2.5 top-2.5 grid size-5 place-items-center rounded-full bg-primary text-on-primary"><IconCheckSm /></span>}
              <span className="mt-2 block text-caption font-semibold leading-tight [overflow-wrap:anywhere]">{t(th.name)}</span>
              {th.status !== "active" && <span className="text-caption text-muted">Coming soon</span>}
            </button>
          ))}
        </div>
      </Card>
      <Card>
        <h2 className="font-semibold">Colours</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {(Object.keys(labels) as (keyof Palette)[]).map((k) => (
            <label key={k} className="flex items-center gap-3 rounded-md border-[1.5px] border-border-strong p-2">
              <input type="color" value={p[k]} onChange={(e) => onPalette({ [k]: e.target.value.toUpperCase() })} className="size-9 cursor-pointer rounded border-0 bg-transparent" />
              <span className="min-w-0"><span className="block text-sm font-semibold">{labels[k]}</span><span className="font-mono text-caption text-muted">{p[k]}</span></span>
            </label>
          ))}
        </div>
        <ContrastNote fg={p.text} bg={p.background} label="Text on background" />
        <ContrastNote fg={p.onPrimary} bg={p.primary} label="Button text" />
        <ContrastNote fg={p.accent} bg={p.background} label="Highlights on background" />
      </Card>
      <Card>
        <h2 className="font-semibold">Opening</h2>
        <p className="text-sm text-muted">Guests first see your names on a softly lit cover. When they tap <strong>Open invitation</strong>, a glow spreads from the centre and the invitation appears. With reduced motion turned on, it simply fades in.</p>
      </Card>
    </div>
  );
}

function lum(hex: string) {
  const c = hex.replace("#", "").match(/.{2}/g)!.map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function IconCheckSm() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.2 4.2L19 7" /></svg>;
}
function ContrastNote({ fg, bg, label, min = 4.5 }: { fg: string; bg: string; label: string; min?: number }) {
  if (!/^#[0-9a-f]{6}$/i.test(fg) || !/^#[0-9a-f]{6}$/i.test(bg)) return null;
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  const ratio = (a + 0.05) / (b + 0.05);
  const ok = ratio >= min;
  return <p className={cx("mt-3 text-caption", ok ? "text-success" : "text-warning")}>{label}: contrast {ratio.toFixed(1)}:1 {ok ? "· easy to read" : "· may be hard to read, try a darker or lighter shade"}</p>;
}

/** Languages: plan limit (diy 2 · Signature 3 · Couture 5) plus Extra language add-ons. Saves instantly. */
function LanguagesCard({ cat, lang, onChange, onNeedAddon }: { cat?: Catalogue; lang: string; onChange: (next: string[]) => Promise<void>; onNeedAddon: (n: number, languages: string[]) => void }) {
  const { event, canWrite } = useEvent();
  const [busy, setBusy] = useState<string | null>(null);
  const plan = cat?.plans.find((p) => p.code === (event!.planCode ?? "diy"));
  const included = plan?.maxLanguages ?? 2;
  const limit = event!.maxLanguages ?? included;
  const extra = cat?.extras.find((x) => x.code === "extra_language");
  const offered = offeredFor(cat, event!.planCode ?? "diy").some((x) => x.code === "extra_language") && !plan?.includesAllExtras;
  const langs = event!.languages;
  async function toggle(code: string) {
    const on = langs.includes(code);
    const next = on ? langs.filter((l) => l !== code) : [...langs, code];
    if (!on && next.length > limit) {
      if (!offered) return;
      if (event!.paid) { onNeedAddon(next.length - limit, next); return; }
    }
    setBusy(code);
    await onChange(next);
    setBusy(null);
  }
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Languages</h2>
          <p className="text-sm text-muted">
            Your plan includes {included} language{included === 1 ? "" : "s"}{limit > included ? `, plus ${limit - included} extra` : ""}.{" "}
            {offered && extra ? <>Each extra language is {money(extra.priceCents, extra.currency)}{event!.paid ? "" : ", charged when you publish"}.</> : null}
          </p>
        </div>
        <span className="flex items-center gap-2"><span className="tabular text-sm font-semibold">{langs.length} / {Math.max(limit, langs.length)}</span><Badge tone="success">Saved instantly</Badge></span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Invitation languages">
        {(cat?.languages ?? langs.map((l) => ({ code: l, label: l.toUpperCase() }))).map((l) => {
          const on = langs.includes(l.code);
          const primary = l.code === event!.primaryLanguage;
          const over = !on && langs.length >= limit;
          const blocked = over && !offered;
          return (
            <button key={l.code} type="button" aria-pressed={on} disabled={!canWrite || primary || blocked || busy !== null} onClick={() => toggle(l.code)}
              title={primary ? "Your main language can't be removed" : undefined}
              className={cx("flex min-h-11 flex-col items-start rounded-md border px-3 py-2 text-left text-sm font-medium disabled:cursor-not-allowed", on ? "border-primary bg-tint shadow-[inset_0_0_0_1px_var(--brand-primary)]" : "border-line bg-surface hover:bg-surface-2", blocked && "opacity-45")}>
              <span><span className="mr-1.5 font-mono text-xs uppercase text-muted">{l.code}</span>{l.label}{busy === l.code && " …"}</span>
              <span className="text-caption text-muted">{primary ? "Main language" : on ? (l.code === lang ? "Editing now" : "Included") : over && offered && extra ? `+${money(extra.priceCents, extra.currency)}` : "Add"}</span>
            </button>
          );
        })}
      </div>
      {!offered && langs.length >= limit && <p className="mt-2 text-caption text-muted">You&apos;ve reached your plan&apos;s limit of {limit} languages.</p>}
    </Card>
  );
}

function ContentPanel({ c, order, setContent, setSection, errsFor, sectionTitle, onFocusSection, languages }: { languages?: React.ReactNode; c: InviteContent; order: string[]; setContent: (fn: (c: InviteContent) => InviteContent) => void; setSection: (k: string, v: Record<string, unknown>) => void; errsFor: (k: string) => Record<string, string>; sectionTitle: (k: string) => string | undefined; onFocusSection: (k: string) => void }) {
  const { event, reload } = useEvent();
  const toast = useToast();
  const hero = c.hero ?? {};
  const [details, setDetails] = useState({ partner1: event!.hostNames.partner1 ?? "", partner2: event!.hostNames.partner2 ?? "", eventDate: event!.eventDate ?? "", venueName: event!.venueName ?? "", venueAddress: event!.venueAddress ?? "" });
  const [savingDetails, setSavingDetails] = useState(false);
  async function saveDetails() {
    setSavingDetails(true);
    try {
      await api(`/api/events/${event!.id}`, { method: "PATCH", body: { hostNames: { partner1: details.partner1, partner2: details.partner2 }, eventDate: details.eventDate || null, venueName: details.venueName || null, venueAddress: details.venueAddress || null } });
      toast("Event details saved");
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save", "error");
    } finally {
      setSavingDetails(false);
    }
  }
  const sectionKeys = order.filter((k) => k !== "hero");
  return (
    <div className="flex flex-col gap-3">
      {languages}
      <Accordion title="Names & date" defaultOpen onOpen={() => onFocusSection("hero")}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Event details</p>
          <Badge tone="success">Saved instantly</Badge>
        </div>
        <p className="-mt-1 mb-3 text-caption text-muted">Names, date and venue update your event and the live page as soon as you save them. They aren&apos;t part of Publish changes.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">{(p) => <input {...p} className={inputCls} value={details.partner1} onChange={(e) => setDetails({ ...details, partner1: e.target.value })} />}</Field>
          <Field label="Second name">{(p) => <input {...p} className={inputCls} value={details.partner2} onChange={(e) => setDetails({ ...details, partner2: e.target.value })} />}</Field>
          <Field label="Date">{(p) => <input {...p} type="date" className={inputCls} value={details.eventDate} onChange={(e) => setDetails({ ...details, eventDate: e.target.value })} />}</Field>
          <Field label="Venue">{(p) => <input {...p} className={inputCls} value={details.venueName} onChange={(e) => setDetails({ ...details, venueName: e.target.value })} />}</Field>
          <Field label="Venue address" className="sm:col-span-2">{(p) => <input {...p} className={inputCls} value={details.venueAddress} onChange={(e) => setDetails({ ...details, venueAddress: e.target.value })} />}</Field>
        </div>
        <Button variant="outline" size="sm" className="mt-3" onClick={saveDetails} loading={savingDetails}>Save event details</Button>
        <hr className="my-5 border-line" />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Cover text</p>
          <Badge>Draft · goes live when you publish</Badge>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Small line above names" optional>{(p) => <input {...p} className={inputCls} placeholder="You're invited" value={hero.tagline ?? ""} onChange={(e) => setContent((cc) => ({ ...cc, hero: { ...cc.hero, tagline: e.target.value } }))} />}</Field>
          <Field label="Names as shown" optional>{(p) => <input {...p} className={inputCls} placeholder={event!.title} value={hero.title ?? ""} onChange={(e) => setContent((cc) => ({ ...cc, hero: { ...cc.hero, title: e.target.value } }))} />}</Field>
          <Field label="Line below names" optional>{(p) => <input {...p} className={inputCls} placeholder="are getting married" value={hero.subtitle ?? ""} onChange={(e) => setContent((cc) => ({ ...cc, hero: { ...cc.hero, subtitle: e.target.value } }))} />}</Field>
          <Field label="Date as shown" optional>{(p) => <input {...p} className={inputCls} placeholder={event!.eventDate ? formatDate(event!.eventDate, { dateStyle: "full" }) : ""} value={hero.dateText ?? ""} onChange={(e) => setContent((cc) => ({ ...cc, hero: { ...cc.hero, dateText: e.target.value } }))} />}</Field>
          <div className="sm:col-span-2"><FieldEditor f={{ key: "backgroundAssetId", label: "Cover photo", type: "asset", assetKinds: ["cover", "gallery"] }} value={hero.backgroundAssetId ?? undefined} onChange={(v) => setContent((cc) => ({ ...cc, hero: { ...cc.hero, backgroundAssetId: (v as string | undefined) ?? null } }))} /></div>
          <Field label="Sign-off at the bottom" optional className="sm:col-span-2">{(p) => <input {...p} className={inputCls} placeholder="With love, …" value={c.footer?.signature ?? ""} onChange={(e) => setContent((cc) => ({ ...cc, footer: { ...cc.footer, signature: e.target.value } }))} />}</Field>
        </div>
      </Accordion>
      {sectionKeys.map((k) => {
        const def = defFor(k, sectionTitle(k));
        if (!def) return null;
        const s = (c.sections?.[k] ?? {}) as Record<string, unknown>;
        const errs = errsFor(k);
        const nErr = Object.keys(errs).length;
        return (
          <Accordion key={k} title={def.label} done={hasContent(k, s) && k !== "rsvp" && k !== "countdown"} errors={nErr} onOpen={() => onFocusSection(k)}>
            <div className="flex flex-col gap-4">
              {visibleFields(def, s).map((f) => <FieldEditor key={f.key} f={f} value={s[f.key]} errors={errs} onChange={(v) => setSection(k, { ...s, [f.key]: v })} />)}
            </div>
            {k === "rsvp" && <p className="mt-4 text-sm text-muted">Meals, plus-ones, deadline and questions live in <Link href={`/app/${event!.id}/settings`} className="font-semibold underline">Settings → Reply form</Link>.</p>}
          </Accordion>
        );
      })}
      <p className="text-sm text-muted">Need another section? Add it from the <strong>Sections</strong> tab.</p>
    </div>
  );
}

function Accordion({ title, children, defaultOpen, done, errors = 0, onOpen }: { title: string; children: React.ReactNode; defaultOpen?: boolean; done?: boolean; errors?: number; onOpen?: () => void }) {
  // N-37: errors force it open, but fixing them doesn't close it; only the user does.
  const [open, setOpen] = useState(!!defaultOpen || errors > 0);
  const [prevErrors, setPrevErrors] = useState(errors);
  if (errors !== prevErrors) { setPrevErrors(errors); if (errors > 0 && !open) setOpen(true); }
  return (
    <details open={open} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== open) setOpen(o); if (o) onOpen?.(); }} className={cx("group rounded-card border bg-surface shadow-card", errors ? "border-danger" : "border-line")}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-semibold marker:hidden">
        <span className="flex min-w-0 items-center gap-2">{title}{done && !errors && <span className="size-2 rounded-full bg-success" aria-label="has content" />}{errors > 0 && <Badge tone="danger">{errors} to fix</Badge>}</span>
        <IconChevronDown size={18} className="transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-line px-5 py-4">{children}</div>
    </details>
  );
}

function SectionsPanel({ order, hidden, sections, catalogueSections, onOrder, onHidden, onAdd, onRemove }: { order: string[]; hidden: string[]; sections: Record<string, unknown>; catalogueSections: { key: string; label: string }[]; onOrder: (o: string[]) => void; onHidden: (h: string[]) => void; onAdd: (k: string, title?: string) => void; onRemove: (k: string) => void }) {
  const [custom, setCustom] = useState("");
  const [customErr, setCustomErr] = useState("");
  const available = SECTION_DEFS.filter((d) => !order.includes(d.key));
  const label = (k: string) => (k === "hero" ? "Cover" : k.startsWith("custom:") ? ((sections[k] as { title?: string } | undefined)?.title || customLabel(k)) : defFor(k)?.label ?? catalogueSections.find((s) => s.key === k)?.label ?? humanize(k));
  const move = (i: number, d: number) => { const n = [...order]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); onOrder(n); };
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <h2 className="font-semibold">Order &amp; visibility</h2>
        <p className="text-sm text-muted">Guests see sections top to bottom. Hidden sections keep their content.</p>
        <ol className="mt-4 divide-y divide-line rounded-md border border-line">
          {order.map((k, i) => {
            const isHidden = hidden.includes(k);
            return (
              <li key={k} className={cx("flex items-center gap-2 px-3 py-2.5", isHidden && "opacity-60")}>
                <span className="tabular w-6 text-xs text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 text-sm font-medium">{label(k)}{CORE.includes(k) && <span className="ml-2 text-caption text-muted">core</span>}{!CORE.includes(k) && !hasContent(k, sections[k] as Record<string, unknown>) && <span className="ml-2 text-caption text-warning">empty, hidden from guests</span>}</span>
                <button type="button" className="grid size-8 place-items-center rounded hover:bg-surface-2 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${label(k)} up`}><IconArrowLeft size={16} className="rotate-90" /></button>
                <button type="button" className="grid size-8 place-items-center rounded hover:bg-surface-2 disabled:opacity-30" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${label(k)} down`}><IconArrowRight size={16} className="rotate-90" /></button>
                {k !== "hero" && <button type="button" className="grid size-8 place-items-center rounded hover:bg-surface-2" aria-pressed={isHidden} onClick={() => onHidden(isHidden ? hidden.filter((x) => x !== k) : [...hidden, k])} aria-label={`${isHidden ? "Show" : "Hide"} ${label(k)}`}>{isHidden ? <IconEyeOff size={16} /> : <IconEye size={16} />}</button>}
                {!CORE.includes(k) && <button type="button" className="grid size-8 place-items-center rounded text-danger hover:bg-danger-soft" onClick={() => onRemove(k)} aria-label={`Remove ${label(k)}`}><IconTrash size={16} /></button>}
              </li>
            );
          })}
        </ol>
      </Card>
      <Card>
        <h2 className="font-semibold">Add a section</h2>
        {available.length === 0 ? <p className="mt-2 text-sm text-muted">You&apos;ve added every standard section.</p> : (
          <div className="mt-3 flex flex-wrap gap-2">
            {available.map((d) => <Button key={d.key} type="button" variant="outline" size="sm" onClick={() => onAdd(d.key)}><IconPlus size={16} />{d.label}</Button>)}
          </div>
        )}
        <form className="mt-4 flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); const slug = slugifyCustom(custom); if (!slug) return; if (order.includes(`custom:${slug}`)) { setCustomErr("You already have a section with that name."); return; } onAdd(`custom:${slug}`, custom.trim().slice(0, 120)); setCustom(""); setCustomErr(""); }}>
          <label htmlFor="custom-sec" className="sr-only">Custom section name</label>
          <input id="custom-sec" className={inputCls} placeholder="Your own section, e.g. Kids' corner" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <Button type="submit" variant="outline" disabled={!custom.trim()}><IconSparkle size={16} />Add</Button>
        </form>
        {customErr && <p className="mt-1 text-[13px] font-medium text-danger" role="alert">{customErr}</p>}
      </Card>
    </div>
  );
}

function MusicPanel({ tracks, loading, error, cfg, onChange, ownSongOffered, onNeedAddon }: { tracks: MusicTrack[]; loading: boolean; error: unknown; cfg: InvitationConfig; onChange: (m: NonNullable<InvitationConfig["music"]>) => void; ownSongOffered: boolean; onNeedAddon: () => void }) {
  const m = cfg.music ?? {};
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <h2 className="font-semibold">Background music</h2>
        <p className="text-sm text-muted">Music never plays until a guest taps to open. They can mute it at any time. Tap Listen to preview a track.</p>
        <div className="mt-4">
          {loading ? <LoadingBlock rows={3} /> : error ? <ErrorState error={error} /> : <TrackList tracks={tracks} value={usesOwnSong(cfg) ? "__own" : m.trackId} onChange={(id) => onChange({ trackId: id, assetId: null, externalUrl: null })} />}
        </div>
        <div className="mt-5 flex flex-col gap-4">
          <Toggle checked={m.autoplayOnOpen ?? true} onChange={(v) => onChange({ autoplayOnOpen: v })} label="Start playing when a guest opens the invitation" />
          <div>
            <label htmlFor="vol" className="text-sm font-semibold">Volume <span className="tabular font-normal text-muted">{Math.round((m.volume ?? 0.6) * 100)}%</span></label>
            <input id="vol" type="range" min={0} max={1} step={0.05} value={m.volume ?? 0.6} onChange={(e) => onChange({ volume: parseFloat(e.target.value) })} className="mt-2 w-full accent-[var(--brand-primary)]" />
          </div>
        </div>
        <Notice className="mt-4">The library tracks are short placeholder tunes until licensed music is added. Guests hear them on a loop.</Notice>
      </Card>
      {ownSongOffered && <OwnSong cfg={cfg} onChange={onChange} onNeedAddon={onNeedAddon} />}
    </div>
  );
}

/** own_song: upload or link, gated by the required rights tick. Hidden when the feature is off (403 FEATURE_DISABLED). */
function OwnSong({ cfg, onChange, onNeedAddon }: { cfg: InvitationConfig; onChange: (m: NonNullable<InvitationConfig["music"]>) => void; onNeedAddon: () => void }) {
  const { event, canWrite } = useEvent();
  const toast = useToast();
  const m = cfg.music ?? {};
  const assets = useEventAssets(event!.id);
  const rightsLog = useAsync(() => api<{ items: { id: string; userName: string | null; assetId: string | null; url: string | null; confirmedAt: string }[] }>(`/api/events/${event!.id}/music-rights`), [event!.id, m.assetId, m.externalUrl]);
  const [rights, setRights] = useState(false);
  const [mode, setMode] = useState<"upload" | "link">(m.externalUrl ? "link" : "upload");
  const [url, setUrl] = useState(m.externalUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const owned = event!.purchasedExtras?.includes("own_song");
  const needsPurchase = event!.paid && !owned;
  const current = m.assetId ? (assets.items ?? []).find((a) => a.id === m.assetId) : null;
  const confirmation = (rightsLog.data?.items ?? []).find((r) => (m.assetId && r.assetId === m.assetId) || (m.externalUrl && r.url === m.externalUrl));
  if (disabled) return null;
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.code === "FEATURE_DISABLED") { setDisabled(true); toast(musicErrorText(e), "error"); return; }
    if (addonNeed(e)) { onNeedAddon(); return; }
    setErr(musicErrorText(e));
  };
  async function upload(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setBusy(true); setErr(null);
    try {
      const a = await uploadAsset(event!.id, "music", f, { rightsConfirmed: rights });
      onChange({ assetId: a.id, trackId: null, externalUrl: null });
      toast("Song uploaded. It's in your draft.");
    } catch (e) { fail(e); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  async function useLink(e: React.FormEvent) {
    e.preventDefault();
    if (!/^https:\/\//.test(url.trim())) { setErr("Paste a link that starts with https://"); return; }
    setBusy(true); setErr(null);
    try {
      await api(`/api/events/${event!.id}/music-rights`, { body: { url: url.trim(), confirmed: true } });
      onChange({ externalUrl: url.trim(), trackId: null, assetId: null });
      rightsLog.reload();
      toast("Link saved to your draft");
    } catch (e2) { fail(e2); } finally { setBusy(false); }
  }
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Use your own song</h2>
          <p className="text-sm text-muted">Upload an MP3, M4A or AAC file (up to 20 MB) or paste an https link.</p>
        </div>
        {owned ? <Badge tone="success">Add-on bought</Badge> : event!.paid ? null : usesOwnSong(cfg) ? <Badge tone="warning">Added to your order</Badge> : <Badge>Paid add-on · charged when you publish</Badge>}
      </div>
      {usesOwnSong(cfg) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-2 p-3 text-sm">
          <span className="min-w-0">
            <span className="block font-semibold">Now playing: {current?.originalName ?? (m.externalUrl ? <span className="break-all">{m.externalUrl}</span> : "your uploaded song")}</span>
            <span className="block text-caption text-muted">{confirmation ? `Rights confirmed by ${confirmation.userName ?? "a host"} on ${formatDate(confirmation.confirmedAt, { dateStyle: "medium" })}` : rightsLog.loading ? "Checking the rights record…" : "Rights confirmed"}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => onChange({ assetId: null, externalUrl: null })}>Remove</Button>
        </div>
      )}
      {needsPurchase ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">Your own song is an add-on. Buy it to upload or link a song.</p>
          <Button variant="outline" onClick={onNeedAddon}>Buy add-on</Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <RightsCheck checked={rights} onChange={setRights} />
          <Segmented label="How to add your song" value={mode} onChange={setMode} options={[{ value: "upload", label: "Upload a file" }, { value: "link", label: "Paste a link" }]} />
          {mode === "upload" ? (
            <div>
              <input ref={fileRef} type="file" accept={acceptFor(["music"])} className="sr-only" id="own-song-file" onChange={(e) => upload(e.target.files)} disabled={!rights || !canWrite} />
              <Button type="button" variant="outline" loading={busy} disabled={!rights || !canWrite} onClick={() => fileRef.current?.click()}><IconPlus size={16} />Choose a song file</Button>
              {!rights && <p className="mt-1 text-caption text-muted">Tick the box above to enable uploads.</p>}
            </div>
          ) : (
            <form onSubmit={useLink} className="flex flex-col gap-2 sm:flex-row">
              <label htmlFor="own-song-url" className="sr-only">Song link</label>
              <input id="own-song-url" type="url" inputMode="url" className={inputCls} placeholder="https://…" value={url} maxLength={500} onChange={(e) => setUrl(e.target.value)} disabled={!rights} />
              <Button type="submit" variant="outline" loading={busy} disabled={!rights || !url.trim()}>Use this link</Button>
            </form>
          )}
          {err && <p role="alert" className="text-sm font-medium text-danger">{err}</p>}
        </div>
      )}
    </Card>
  );
}

function DetailsPanel({ inv, onInv, onNeedAddon, linkPrice }: { inv: Invitation; onInv: (i: Invitation) => void; onNeedAddon: () => void; linkPrice?: number }) {
  const { event, reload: reloadEvent, canWrite } = useEvent();
  const toast = useToast();
  const versions = useAsync(() => api<{ items: { version: number; publishedAt: string; createdAt?: string }[] }>(`/api/events/${event!.id}/invitation/versions`), [inv.version]);
  async function rotate() {
    try {
      await api(`/api/events/${event!.id}/invitation/preview-token`, { method: "POST" });
      onInv(await api<Invitation>(`/api/events/${event!.id}/invitation`));
      toast("New preview link created. The old one no longer works.");
    } catch (err) { toast(err instanceof Error ? err.message : "Failed", "error"); }
  }
  async function rollback(version: number) {
    try {
      onInv(await api<Invitation>(`/api/events/${event!.id}/invitation/rollback`, { body: { version } }));
      toast(`Version ${version} copied into your draft. Reload to see it in the editor, then publish changes to make it live.`);
    } catch (err) { toast(err instanceof Error ? err.message : "Failed", "error"); }
  }
  return (
    <div className="flex flex-col gap-5">
      <LinkCard inv={inv} onInv={onInv} onNeedAddon={onNeedAddon} linkPrice={linkPrice} canWrite={canWrite} onChanged={reloadEvent} />
      <Card>
        <h2 className="font-semibold">Private preview link</h2>
        <p className="text-sm text-muted">Share this with family to get feedback before you publish. Replies are switched off in previews.</p>
        <div className="mt-3"><CopyField value={inv.previewUrl} label="preview link" /></div>
        <div className="mt-3 flex gap-2">
          <ButtonLink href={localPath(inv.previewUrl)} target="_blank" rel="noopener" variant="outline" size="sm"><IconEye size={16} />Open preview</ButtonLink>
          <Button variant="ghost" size="sm" onClick={rotate}>Create a new preview link</Button>
        </div>
      </Card>
      {inv.status === "published" && (
        <Card>
          <h2 className="font-semibold">Share</h2>
          <div className="mt-3"><ShareActions url={inv.url} title={event!.title} qrBase={`/api/events/${event!.id}/qr`} /></div>
        </Card>
      )}
      <Card>
        <h2 className="font-semibold">Published versions</h2>
        {versions.loading && !versions.data ? <LoadingBlock rows={1} /> : !versions.data?.items?.length ? <p className="mt-2 text-sm text-muted">Nothing published yet. Each time you publish, we keep a copy you can go back to.</p> : (
          <ul className="mt-3 divide-y divide-line">
            {versions.data.items.map((v) => (
              <li key={v.version} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>Version {v.version} · {formatDate(v.publishedAt ?? v.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                <Button variant="ghost" size="sm" onClick={() => rollback(v.version)}>Restore to draft</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** H-02 Link panel (custom_link). Saves instantly, outside the draft; old links keep redirecting. */
function LinkCard({ inv, onInv, onNeedAddon, linkPrice, canWrite, onChanged, included }: { inv: Invitation; onInv: (i: Invitation) => void; onNeedAddon: () => void; linkPrice?: number; canWrite: boolean; onChanged: () => void; included?: boolean }) {
  const { event } = useEvent();
  const toast = useToast();
  const [slug, setSlug] = useState(inv.slug);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [previous, setPrevious] = useState(() => slugHistory(inv.previousSlugs));
  const has = included || event!.purchasedExtras?.includes("custom_link") || event!.selectedExtras?.includes("custom_link");
  const unlocked = has || !event!.paid;
  const base = inv.url.slice(0, inv.url.length - inv.slug.length);
  const issue = slug === inv.slug ? null : slugIssue(slug);
  async function save() {
    setBusy(true);
    setServerErr(null);
    const old = inv.slug;
    try {
      const r = await api<{ slug: string; url: string; previousSlugs?: string[] }>(`/api/events/${event!.id}/invitation/slug`, { method: "PATCH", body: { slug } });
      const prev = r.previousSlugs;
      setSlug(r.slug); // the server normalises (lowercase, single hyphens, trimmed)
      const fresh = await api<Invitation>(`/api/events/${event!.id}/invitation`);
      // Prefer GET's dated list; the PATCH answer (plain strings) or a local guess only if an older API omits it.
      const nextPrev = fresh.previousSlugs ? slugHistory(fresh.previousSlugs) : prev ? slugHistory(prev) : [{ oldSlug: old }, ...previous.filter((x) => x.oldSlug !== old && x.oldSlug !== r.slug)];
      onInv({ ...fresh, previousSlugs: nextPrev, customLinkLocked: fresh.customLinkLocked ?? nextPrev.length > 0 });
      setPrevious(nextPrev);
      setConfirm(false);
      onChanged();
      toast("Link saved. Your old link redirects here.");
    } catch (e) {
      setConfirm(false);
      if (addonNeed(e)) { onNeedAddon(); return; }
      if (e instanceof ApiError && e.status === 409) setServerErr("That link is already taken. Try another.");
      else if (e instanceof ApiError && e.status === 400) setServerErr(e.fields?.slug === "reserved" || /reserved/i.test(e.fields?.slug ?? e.message) ? SLUG_MESSAGE.reserved : e.fields?.slug ?? e.message);
      else setServerErr(e instanceof Error ? e.message : "Couldn't change the link");
    } finally { setBusy(false); }
  }
  const err = serverErr ?? (issue ? SLUG_MESSAGE[issue] : null);
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-semibold">Your link</h2>
        <Badge tone="success">Saved instantly</Badge>
      </div>
      {!unlocked ? (
        <>
          <p className="mt-1 text-sm text-muted">Your invitation has its own link. Want something more personal, like your names?</p>
          <div className="mt-3"><CopyField value={inv.url} label="invitation link" /></div>
          <Button variant="outline" className="mt-3" onClick={onNeedAddon}>Choose your own link{linkPrice != null ? ` · ${money(linkPrice)}` : ""}</Button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">Changes apply right away, not when you publish. {!event!.paid && !has && <>Choosing your own link adds <strong className="font-semibold text-ink">Custom link name{linkPrice != null ? ` (${money(linkPrice)})` : ""}</strong> to your order, charged when you publish.</>}</p>
          <form onSubmit={(e) => { e.preventDefault(); if (!issue && slug !== inv.slug) setConfirm(true); }} className="mt-3 flex flex-col gap-2 sm:flex-row" noValidate>
            <div className={cx("flex min-w-0 flex-1 items-center rounded-md border bg-surface-2 pl-3 text-sm text-muted", err ? "border-danger" : "border-line")}>
              <span className="truncate">{base}</span>
              <label htmlFor="slug" className="sr-only">Link ending</label>
              <input id="slug" value={slug} maxLength={60} aria-invalid={!!err} aria-describedby="slug-rules" autoComplete="off" spellCheck={false}
                onChange={(e) => { setServerErr(null); setSlug(toSlug(e.target.value)); }} className="h-11 min-w-0 flex-1 rounded-r-md border-l border-line bg-surface px-2 text-ink" />
            </div>
            <Button type="submit" variant="outline" loading={busy} disabled={!canWrite || slug === inv.slug || !!issue}>Save link</Button>
          </form>
          <p id="slug-rules" className={cx("mt-1 text-caption", err ? "font-medium text-danger" : "text-muted")} role={err ? "alert" : undefined}>{err ?? "Lowercase letters, numbers and hyphens · 3 to 60 characters · must be unique"}</p>
        </>
      )}
      {previous.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold">Previous links</p>
          <ul className="mt-1 divide-y divide-line text-sm">
            {previous.map((p) => <li key={p.oldSlug} className="flex flex-wrap justify-between gap-2 py-2"><span className="break-all text-muted">{base}{p.oldSlug}</span><span className="text-caption"><span className="font-semibold text-success">Redirects here</span>{p.createdAt && <span className="text-muted"> · changed {formatDate(p.createdAt, { dateStyle: "medium" })}</span>}</span></li>)}
          </ul>
        </div>
      )}
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Change your link?"
        footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button onClick={save} loading={busy}>Save link</Button></>}>
        <p className="text-sm">Your invitation will move to <strong className="break-all">{base}{slug}</strong>.</p>
        <p className="mt-2 text-sm">Your old link (<span className="break-all">/i/{inv.slug}</span>) will keep working and redirect to the new one, so personal links you&apos;ve already sent still open.</p>
      </Dialog>
    </Card>
  );
}

type SessionRes = { url: string; extras?: (string | { code: string; qty?: number })[]; lines?: Quote["lines"]; subtotalCents?: number; currency?: string };
/** Pay to publish (self-serve). Add-on rows are pre-ticked from the Extras step and from what the invitation already uses; the total is the server quote. */
function PayDialog({ open, onClose, email, cat, inv, onChooseDesign }: { open: boolean; onClose: () => void; email: string; cat?: Catalogue; inv: Invitation; onChooseDesign: () => void }) {
  const { event } = useEvent();
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const plan = cat?.plans.find((p) => p.code === "diy");
  const offered = offeredFor(cat, "diy");
  // Add-ons the server says the invitation uses (422 `missing` from quote/checkout): locked like the ones we detect.
  const [serverNeed, setServerNeed] = useState<Record<string, number>>({});
  const locked = useMemo(() => {
    const l: Record<string, Lock> = {};
    if (usesOwnSong(inv.config)) l.own_song = { min: 1, reason: "Used in your invitation" };
    // N-39: `customLinkLocked` (or `previousSlugs`) survives a reload; older APIs send neither, and the review step below catches it.
    if (inv.customLinkLocked || slugHistory(inv.previousSlugs).length) l.custom_link = { min: 1, reason: `Your link was changed to /i/${inv.slug}` };
    for (const [c, n] of Object.entries(serverNeed)) if (!l[c] || l[c].min < n) l[c] = { min: n, reason: c === "custom_link" ? `Your link was changed to /i/${inv.slug}` : "Used in your invitation" };
    const over = Math.max(0, (event?.languages.length ?? 1) - (plan?.maxLanguages ?? 2));
    if (over) l.extra_language = { min: over, reason: `You use ${event!.languages.length} languages; your plan includes ${plan?.maxLanguages ?? 2}` };
    return l;
  }, [inv, event, plan, serverNeed]);
  const initial = useMemo(() => {
    const v = countExtras(event?.selectedExtras);
    for (const [c, lk] of Object.entries(locked)) v[c] = Math.max(v[c] ?? 0, lk.min);
    return v;
  }, [event?.selectedExtras, locked]);
  const [sel, setSel] = useState<Record<string, number>>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  // Which selection `quote` prices, so Continue never runs against a stale total.
  const [quotedKey, setQuotedKey] = useState<string | null>(null);
  // N-39: the server needed more than the dialog showed. Hold the payment until the couple confirms the new total.
  const [review, setReview] = useState<{ key: string; note: string; was: number; url?: string } | null>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const holdRef = useRef<string | null>(null);
  // 422 "Please choose a design." (no saved theme): point the couple at the Style tab instead of a dead end.
  const [needTheme, setNeedTheme] = useState(false);
  const isNoTheme = (e: unknown) => e instanceof ApiError && (e.fields?.themeKey === "Required" || /choose a design/i.test(e.message));
  const initKey = JSON.stringify(initial);
  // Reset to the saved selection when the dialog opens; afterwards only raise locked minimums, keeping the user's ticks.
  useEffect(() => { if (open) setSel(JSON.parse(initKey)); else { setServerNeed({}); setReview(null); holdRef.current = null; } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const init = JSON.parse(initKey) as Record<string, number>;
    setSel((v) => { const m = { ...v }; for (const [c, n] of Object.entries(init)) m[c] = Math.max(m[c] ?? 0, n); return m; });
  }, [initKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const extras = expandExtras(sel);
  const extrasKey = extras.join(",");
  const languages = event?.languages?.length ? event.languages : ["en"];
  useEffect(() => {
    if (!open) return;
    if (holdRef.current === extrasKey) return; // showing the server's lines for a held checkout
    holdRef.current = null;
    let live = true;
    // N-32: send the saved style (and eventId, so the server can fall back to the event's saved theme/languages).
    api<Quote>("/api/checkout/quote", { body: { plan: "diy", eventId: event?.id, themeKey: inv.theme?.key ?? undefined, extras, languages } })
      .then((q) => { if (live) { setQuote(q); setQuotedKey(extrasKey); setErr(null); setNeedTheme(false); } })
      .catch((e) => {
        if (!live) return;
        setQuote(null);
        setQuotedKey(null);
        if (isNoTheme(e)) { setNeedTheme(true); setErr(null); return; }
        // `missing` is the shortfall (units still short), so add it to what's ticked.
        const miss = missingFrom(e);
        if (miss) { setServerNeed((v) => ({ ...v, ...Object.fromEntries(Object.entries(miss).map(([c, n]) => [c, (sel[c] ?? 0) + n])) })); setSel((v) => { const m = { ...v }; for (const [c, n] of Object.entries(miss)) m[c] = (m[c] ?? 0) + n; return m; }); }
        else setErr(e instanceof Error ? e.message : "Couldn't price this");
      });
    return () => { live = false; };
  }, [open, extrasKey, languages.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const reviewing = review != null && review.key === extrasKey;
  useEffect(() => { if (review) reviewRef.current?.focus(); }, [review]);
  /** Show the server's lines and subtotal in the dialog and wait for an explicit confirm (never redirect on a changed order). */
  function holdForReview(next: Record<string, number>, q: Quote, added: string[], was: number, url?: string) {
    const key = expandExtras(next).join(",");
    const onlyLink = added.length > 0 && added.every((c) => c === "custom_link");
    const note = onlyLink
      ? `Your link was already changed to /i/${inv.slug}, so Custom link stays included.`
      : "We updated your total because some items are required. Please review before paying.";
    if (added.length) setServerNeed((v) => ({ ...v, ...Object.fromEntries(added.map((c) => [c, next[c] ?? 1])) }));
    holdRef.current = url ? key : null; // keep the server's own lines on screen for the order we hold
    setSel(next);
    setQuote({ ...q, taxNote: "Plus tax at payment." });
    setQuotedKey(key);
    setReview({ key, note, was, url });
  }
  async function pay() {
    if (!terms || !privacy) { setErr("Please accept both to continue."); return; }
    if (!quote || quotedKey !== extrasKey) return;
    // Confirmed: go to the checkout we already hold for exactly these lines.
    if (reviewing && review.url) { setBusy(true); window.location.href = review.url; return; }
    setBusy(true);
    setErr(null);
    const shown = quote.subtotalCents;
    const attempt = (list: string[]) => api<SessionRes>("/api/checkout/session", { body: { plan: "diy", eventId: event!.id, themeKey: inv.theme?.key ?? undefined, extras: list, info: { email }, consents: { terms, privacy } }, headers: { "Idempotency-Key": `diy-${event!.id}-${[...list].sort().join("+")}` } });
    try {
      let r: SessionRes;
      try { r = await attempt(extras); } catch (e) {
        // 422 with `missing` (older API, or the lock wasn't known): never re-add silently. Lock, re-price, ask to confirm.
        const miss = missingFrom(e);
        if (!miss) throw e;
        const merged = { ...sel };
        for (const [c, n] of Object.entries(miss)) merged[c] = (merged[c] ?? 0) + n; // `missing` = shortfall
        const q = await api<Quote>("/api/checkout/quote", { body: { plan: "diy", eventId: event?.id, themeKey: inv.theme?.key ?? undefined, extras: expandExtras(merged), languages } });
        holdForReview(merged, q, Object.keys(miss), shown);
        setBusy(false);
        return;
      }
      // N-39: the order must match what the dialog quoted (extras and subtotal); otherwise show the server's lines first.
      const got = r.extras ? countExtras(r.extras.flatMap((x) => (typeof x === "string" ? [x] : Array(x.qty ?? 1).fill(x.code)))) : null;
      const gotKey = got ? expandExtras(got).join(",") : extrasKey;
      const changed = (r.subtotalCents != null && r.subtotalCents !== shown) || (r.currency != null && r.currency !== quote.currency) || gotKey !== extrasKey;
      if (changed) {
        const next = got ?? sel;
        const added = Object.keys(next).filter((c) => (next[c] ?? 0) > (sel[c] ?? 0));
        const q: Quote = r.lines ? { lines: r.lines, subtotalCents: r.subtotalCents ?? shown, currency: r.currency ?? quote.currency } : { ...quote, subtotalCents: r.subtotalCents ?? shown };
        holdForReview(next, q, added, shown, r.url);
        setBusy(false);
        return;
      }
      window.location.href = r.url;
    } catch (e) {
      setBusy(false);
      if (isNoTheme(e)) { setNeedTheme(true); return; }
      const f = e instanceof ApiError ? Object.entries(e.fields ?? {}).find(([k]) => k.startsWith("extras.")) : undefined;
      setErr(f ? `${f[1]} (${humanize(f[0].slice(7))})` : e instanceof Error ? e.message : "Checkout failed");
    }
  }
  const total = quote?.subtotalCents;
  return (
    <Dialog open={open} onClose={onClose} title="Publish your invitation" wide
      footer={<><Button variant="ghost" onClick={onClose}>Not now</Button><Button variant="accent" onClick={pay} loading={busy} disabled={total == null || quotedKey !== extrasKey}>{reviewing ? "Confirm and pay" : "Continue to payment"}{total != null ? ` · ${money(total, quote!.currency)}` : ""}</Button></>}>
      <p className="text-sm">Publishing makes your invitation live at its link and opens replies. It&apos;s a one-time payment, plus tax. Your invitation stays live until 60 days after your date.</p>
      {plan && <p className="mt-3 flex justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm"><span className="font-semibold">{t(plan.name)}</span><span className="tabular">{money(plan.basePriceCents, plan.currency)}</span></p>}
      {offered.length > 0 && <div className="mt-4"><ExtraPicker extras={offered} value={sel} onChange={setSel} locked={locked} legend="Add-ons (optional unless your invitation uses them)" /></div>}
      {reviewing && quote && (
        <div ref={reviewRef} tabIndex={-1} role="status" aria-live="polite" className="mt-4 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]">
          <Notice tone="warning">
            <strong>Please review your new total.</strong> {review.note}{" "}
            {review.was !== quote.subtotalCents && <>The total changed from <span className="tabular">{money(review.was, quote.currency)}</span> to <span className="tabular font-semibold">{money(quote.subtotalCents, quote.currency)}</span>.</>}
            {" "}Tax is added at payment. Nothing has been charged. Select <strong>Confirm and pay</strong> to continue.
          </Notice>
        </div>
      )}
      {quote && <div className="mt-4"><QuoteTable quote={quote} /><p className="mt-1 text-caption text-muted">{reviewing ? "Plus tax at payment." : quote.taxNote ?? "Tax calculated at checkout."}</p></div>}
      <p className="mt-3 text-sm"><span className="text-muted">Receipt and sign-in email:</span> <span className="font-semibold">{email}</span></p>
      <div className="mt-3 space-y-1">
        <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-5 accent-[var(--brand-primary)]" checked={terms} onChange={(e) => setTerms(e.target.checked)} />I accept the terms of service</label>
        <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-5 accent-[var(--brand-primary)]" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />I accept the privacy policy</label>
      </div>
      {needTheme && (
        <Notice tone="danger" className="mt-3">
          <span role="alert"><strong>Choose a design first.</strong> Your invitation doesn&apos;t have a style yet, so we can&apos;t price it.</span>{" "}
          <button type="button" className="inline-flex min-h-11 items-center font-semibold underline" onClick={() => { onClose(); onChooseDesign(); }}>Go to Style</button>
        </Notice>
      )}
      {err && <p role="alert" className="mt-3 text-sm font-medium text-danger">{err}</p>}
      <Notice className="mt-4">Test mode: no card is charged.</Notice>
    </Dialog>
  );
}
