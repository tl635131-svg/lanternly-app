"use client";
// Shared form editors for invitation content and the studio brief.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, ApiError, proxied } from "@/lib/api";
import { useEvent } from "@/lib/event-context";
import type { Asset, AssetKind, MusicTrack } from "@/lib/types";
import { humanize } from "@/lib/format";
import { Button, Dialog, Field, LoadingBlock, Notice, SafeImg, cx, inputCls, selectCls, textareaCls } from "@/components/ui/primitives";
import { IconArrowLeft, IconArrowRight, IconCheck, IconPlus, IconTrash } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import type { FieldDef, GroupField } from "./section-defs";

/* ───────── Event assets (shared cache per event) ───────── */
const assetCache = new Map<string, Promise<Asset[]>>();
const listeners = new Set<() => void>();
export function invalidateAssets(eventId: string) {
  assetCache.delete(eventId);
  listeners.forEach((l) => l());
}
export function useEventAssets(eventId: string | undefined) {
  const [items, setItems] = useState<Asset[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  useEffect(() => {
    if (!eventId) return;
    let alive = true;
    if (!assetCache.has(eventId)) assetCache.set(eventId, api<{ items: Asset[] }>(`/api/events/${eventId}/assets`).then((r) => r.items));
    assetCache.get(eventId)!.then((x) => { if (alive) { setItems(x); setError(null); } }, (e) => { assetCache.delete(eventId); if (alive) setError(e); });
    return () => { alive = false; };
  }, [eventId, tick]);
  const reload = useCallback(() => { if (eventId) invalidateAssets(eventId); }, [eventId]);
  return { items, error, loading: items === null && !error, reload };
}

/** Own songs need the rights tick: the API reads `rightsConfirmed` before the file part (400 RIGHTS_CONFIRMATION_REQUIRED otherwise). */
export async function uploadAsset(eventId: string, kind: AssetKind, file: File, opts: { rightsConfirmed?: boolean } = {}): Promise<Asset> {
  const max = kind === "music" ? 20 : 15;
  if (file.size > max * 1024 * 1024) throw new Error(`${file.name} is over ${max} MB`);
  const fd = new FormData();
  if (kind === "music") fd.append("rightsConfirmed", opts.rightsConfirmed ? "true" : "false");
  fd.append("file", file);
  const a = await api<Asset>(`/api/events/${eventId}/assets`, { method: "POST", body: fd, query: { kind } });
  invalidateAssets(eventId);
  return a;
}
/** Friendly text for the own-song errors. */
export function musicErrorText(e: unknown): string {
  if (e instanceof ApiError && e.code === "RIGHTS_CONFIRMATION_REQUIRED") return "Tick “I have the rights to use this music” first.";
  if (e instanceof ApiError && e.code === "FEATURE_DISABLED") return "Your own songs aren't available right now. Library tracks still work.";
  return e instanceof Error ? e.message : "Upload failed";
}
export const acceptFor = (kinds: AssetKind[]) => (kinds.includes("music") ? "audio/mpeg,audio/mp4,audio/aac,.mp3,.m4a,.aac" : "image/jpeg,image/png,image/webp,image/heic,.heic");

/** Pick one (or several) uploaded images, or upload a new one. Value is an asset id (uuid) or an array of ids. */
export function AssetPicker({ label, kinds, value, onChange, multiple = false, max = 10, error, required }: { label: string; kinds: AssetKind[]; value: string | string[] | undefined; onChange: (v: string | string[] | undefined) => void; multiple?: boolean; max?: number; error?: string; required?: boolean }) {
  const { event, canWrite } = useEvent();
  const toast = useToast();
  const { items, loading, error: loadErr } = useEventAssets(event?.id);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rights, setRights] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const ids = multiple ? ((value as string[] | undefined) ?? []) : value ? [value as string] : [];
  const byId = new Map((items ?? []).map((a) => [a.id, a]));
  const choices = (items ?? []).filter((a) => kinds.includes(a.kind) || (kinds.some((k) => k !== "music") && a.mime.startsWith("image/")));
  const isAudio = kinds.includes("music");
  function toggle(id: string) {
    if (!multiple) { onChange(id); setOpen(false); return; }
    if (ids.includes(id)) onChange(ids.filter((x) => x !== id));
    else if (ids.length < max) onChange([...ids, id]);
  }
  async function upload(files: FileList | null) {
    if (!files?.length || !event) return;
    setBusy(true);
    try {
      for (const f of Array.from(files).slice(0, multiple ? max - ids.length : 1)) {
        const a = await uploadAsset(event.id, kinds[0], f, { rightsConfirmed: rights });
        if (multiple) ids.push(a.id);
        else onChange(a.id);
      }
      if (multiple) onChange([...ids]);
      toast("Uploaded");
    } catch (e) { toast(musicErrorText(e), "error"); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  const errId = useId();
  return (
    <div>
      <p className="text-sm font-semibold" id={`${errId}-l`}>{label}{required ? <span className="text-danger" aria-hidden> *</span> : <span className="font-normal text-muted"> (optional)</span>}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2" aria-describedby={error ? `${errId}-e` : undefined}>
        {ids.map((id) => {
          const a = byId.get(id);
          return (
            <span key={id} className="relative">
              {a && a.mime.startsWith("image/") ? (
                <SafeImg src={proxied(a.url)} alt={a.originalName} className="size-16 rounded-md border border-line object-cover"
                  fallback={<span className="grid size-16 place-items-center rounded-md border border-line bg-surface-2 px-1 text-center text-[12px] leading-tight text-muted">File unavailable</span>} />
              ) : <span className="grid size-16 place-items-center rounded-md border border-line bg-surface-2 px-1 text-center text-[12px] leading-tight text-muted">{a ? (isAudio ? "Audio" : a.originalName) : "Missing file"}</span>}
              {canWrite && <button type="button" onClick={() => onChange(multiple ? ids.filter((x) => x !== id) : undefined)} className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full border border-line bg-surface text-muted hover:text-danger" aria-label={`Remove ${a?.originalName ?? "file"}`}><IconTrash size={12} /></button>}
            </span>
          );
        })}
        {canWrite && (multiple ? ids.length < max : ids.length === 0) && <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><IconPlus size={16} />{isAudio ? "Choose audio" : ids.length ? "Add photo" : "Choose photo"}</Button>}
      </div>
      {error && <p id={`${errId}-e`} className="mt-1 text-xs font-medium text-danger">{error}</p>}
      <Dialog open={open} onClose={() => setOpen(false)} title={label} wide footer={<><input ref={input} type="file" accept={acceptFor(kinds)} multiple={multiple} className="sr-only" onChange={(e) => upload(e.target.files)} aria-label="Upload a file" /><Button type="button" variant="outline" loading={busy} disabled={isAudio && !rights} onClick={() => input.current?.click()}>Upload new</Button><Button type="button" onClick={() => setOpen(false)}>Done</Button></>}>
        {isAudio && <RightsCheck checked={rights} onChange={setRights} className="mb-4" />}
        {loading ? <LoadingBlock rows={2} /> : loadErr ? <Notice tone="danger">Couldn&apos;t load your files.</Notice> : choices.length === 0 ? (
          <p className="text-sm text-muted">Nothing uploaded yet. Upload {isAudio ? "an MP3, M4A or AAC file (up to 20 MB)" : "a JPEG, PNG, WebP or HEIC image (up to 15 MB)"}.</p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {choices.map((a) => {
              const sel = ids.includes(a.id);
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => toggle(a.id)} aria-pressed={sel} className={cx("relative block w-full overflow-hidden rounded-md border-2", sel ? "border-primary" : "border-transparent")}>
                    {a.mime.startsWith("image/")
                      ? <SafeImg src={proxied(a.url)} alt={a.originalName} className="aspect-square w-full object-cover" loading="lazy" fallback={<span className="grid aspect-square place-items-center bg-surface-2 p-1 text-xs text-muted">File unavailable</span>} />
                      : <span className="grid aspect-square place-items-center bg-surface-2 p-1 text-xs text-muted">{a.originalName}</span>}
                    {sel && <span className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-primary text-on-primary"><IconCheck size={14} /></span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Dialog>
    </div>
  );
}

/** The required "I have the rights to use this music" tick (spec F2.3 / api §9). */
export function RightsCheck({ checked, onChange, className }: { checked: boolean; onChange: (v: boolean) => void; className?: string }) {
  return (
    <label className={cx("flex min-h-11 items-start gap-3 rounded-md border border-line bg-surface-2 p-3 text-sm", className)}>
      <input type="checkbox" required className="mt-0.5 size-5 shrink-0 accent-[var(--brand-primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="font-semibold">I have the rights to use this music</span> <span className="text-danger" aria-hidden>*</span><span className="mt-0.5 block text-caption text-muted">You own it, it&apos;s royalty-free, or you have a licence that covers sharing it on your invitation. We keep a record of this confirmation.</span></span>
    </label>
  );
}

/* ───────── Music library list with previews (plays through the /api proxy) ───────── */
export function TrackList({ tracks, value, onChange, name = "track", allowNone = true }: { tracks: MusicTrack[]; value: string | null | undefined; onChange: (id: string | null) => void; name?: string; allowNone?: boolean }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { audio.current?.pause(); }, []);
  function preview(tr: MusicTrack) {
    if (!tr.url) return;
    if (playing === tr.id) { audio.current?.pause(); setPlaying(null); return; }
    audio.current?.pause();
    const a = new Audio(proxied(tr.url));
    a.onended = () => setPlaying((p) => (p === tr.id ? null : p));
    a.play().then(() => setPlaying(tr.id)).catch(() => setPlaying(null));
    audio.current = a;
  }
  const dur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <ul className="divide-y divide-line rounded-md border border-line" role="radiogroup" aria-label="Music track">
      {allowNone && (
        <li>
          <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
            <input type="radio" name={name} checked={!value} onChange={() => onChange(null)} className="size-4 accent-[var(--brand-primary)]" />
            <span className="font-medium">No music</span>
          </label>
        </li>
      )}
      {tracks.map((tr) => (
        <li key={tr.id} className="flex items-center gap-3 px-4 py-3">
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
            <input type="radio" name={name} checked={value === tr.id} onChange={() => onChange(tr.id)} className="size-4 shrink-0 accent-[var(--brand-primary)]" />
            <span className="min-w-0"><span className="block truncate font-medium">{tr.title}</span><span className="block truncate text-xs text-muted">{tr.artist} · {dur(tr.durationS)}{tr.moodTags.length ? ` · ${tr.moodTags.join(", ")}` : ""}</span></span>
          </label>
          <Button type="button" variant="ghost" size="sm" disabled={!tr.url} onClick={() => preview(tr)} aria-pressed={playing === tr.id} aria-label={tr.url ? `${playing === tr.id ? "Stop" : "Play"} ${tr.title}` : `${tr.title}: no audio yet`}>
            {!tr.url ? "No audio yet" : playing === tr.id ? <><span className="inline-block size-2 animate-pulse rounded-full bg-accent" aria-hidden />Stop</> : "Listen"}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function TrackField({ label, value, onChange }: { label: string; value: string | null | undefined; onChange: (v: string | null) => void }) {
  const [tracks, setTracks] = useState<MusicTrack[] | null>(null);
  useEffect(() => { api<{ items: MusicTrack[] }>("/api/public/music").then((r) => setTracks(r.items), () => setTracks([])); }, []);
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{label} <span className="font-normal text-muted">(optional)</span></legend>
      {tracks === null ? <LoadingBlock rows={2} /> : <TrackList tracks={tracks} value={value} onChange={onChange} name={`track-${label}`} />}
    </fieldset>
  );
}

/* ───────── Generic field editor ───────── */
export function FieldEditor({ f, value, onChange, errors = {} }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void; errors?: Record<string, string> }) {
  if (f.type === "rows") {
    const rows = Array.isArray(value) ? (value as Record<string, string>[]) : [];
    const setRow = (i: number, patch: Record<string, unknown>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    const move = (i: number, d: number) => { const n = [...rows]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); onChange(n); };
    const max = f.max ?? 50;
    return (
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{f.label}</legend>
        {errors[f.key] && <p role="alert" className="mb-2 text-sm font-medium text-danger">{errors[f.key]}</p>}
        <ol className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <li key={i} className="rounded-md border border-line bg-surface-2/50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-muted">{humanize(f.item)} {i + 1}</span>
                <span className="flex gap-1">
                  <button type="button" className="grid size-8 place-items-center rounded hover:bg-surface disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${f.item} ${i + 1} up`}><IconArrowLeft size={16} className="rotate-90" /></button>
                  <button type="button" className="grid size-8 place-items-center rounded hover:bg-surface disabled:opacity-30" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${f.item} ${i + 1} down`}><IconArrowRight size={16} className="rotate-90" /></button>
                  <button type="button" className="grid size-8 place-items-center rounded text-danger hover:bg-danger-soft" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove ${f.item} ${i + 1}`}><IconTrash size={16} /></button>
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {f.fields.map((sf) => {
                  const err = errors[`${f.key}.${i}.${sf.key}`];
                  if (sf.type === "asset")
                    return <div key={sf.key} className="sm:col-span-2"><AssetPicker label={sf.label} kinds={sf.assetKinds ?? ["gallery"]} value={r[sf.key]} onChange={(v) => setRow(i, { [sf.key]: v })} required={sf.required} error={err} /></div>;
                  return (
                    <Field key={sf.key} label={sf.label} required={sf.required} optional={!sf.required} error={err} className={sf.type === "textarea" ? "sm:col-span-2" : ""}>
                      {(p) => sf.type === "textarea"
                        ? <textarea {...p} rows={2} maxLength={sf.max} className={textareaCls + " min-h-16"} value={r[sf.key] ?? ""} onChange={(e) => setRow(i, { [sf.key]: e.target.value })} />
                        : <input {...p} type={sf.type === "url" ? "url" : sf.type === "time" ? "time" : "text"} maxLength={sf.max} placeholder={sf.placeholder} className={inputCls} value={r[sf.key] ?? ""} onChange={(e) => setRow(i, { [sf.key]: e.target.value })} />}
                    </Field>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>
        {rows.length < max && <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => onChange([...rows, {}])}><IconPlus size={16} />Add {f.item}</Button>}
      </fieldset>
    );
  }
  if (f.type === "asset" || f.type === "assets")
    return <AssetPicker label={f.label} kinds={f.assetKinds} multiple={f.type === "assets"} max={f.max} value={value as string | string[] | undefined} onChange={onChange} error={errors[f.key]} />;
  if (f.type === "track") return <TrackField label={f.label} value={value as string | null | undefined} onChange={onChange} />;
  if (f.type === "color") {
    const v = typeof value === "string" ? value : "";
    return (
      <Field label={f.label} optional error={errors[f.key]} hint={f.hint}>
        {(p) => (
          <span className="flex items-center gap-2">
            <input type="color" aria-label={`${f.label} picker`} value={v || "#888888"} onChange={(e) => onChange(e.target.value.toUpperCase())} className="size-10 cursor-pointer rounded border border-line bg-transparent" />
            <input {...p} className={cx(inputCls, "max-w-36 font-mono uppercase")} placeholder="#RRGGBB" maxLength={7} value={v} onChange={(e) => onChange(e.target.value)} />
            {v && <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>Clear</Button>}
          </span>
        )}
      </Field>
    );
  }
  if (f.type === "colors") {
    const colors = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{f.label}</legend>
        <div className="flex flex-wrap items-center gap-2">
          {colors.map((col, i) => (
            <span key={i} className="flex items-center gap-1 rounded-md border border-line p-1">
              <input type="color" aria-label={`Colour ${i + 1}`} value={col} onChange={(e) => onChange(colors.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))} className="size-8 cursor-pointer border-0 bg-transparent" />
              <button type="button" aria-label={`Remove colour ${i + 1}`} className="grid size-7 place-items-center rounded text-muted hover:text-danger" onClick={() => onChange(colors.filter((_, j) => j !== i))}><IconTrash size={14} /></button>
            </span>
          ))}
          {colors.length < 8 && <Button type="button" variant="outline" size="sm" onClick={() => onChange([...colors, "#888888"])}><IconPlus size={16} />Add colour</Button>}
        </div>
      </fieldset>
    );
  }
  if (f.type === "rights") return <RightsCheck checked={value === true} onChange={(v) => onChange(v)} />;
  if (f.type === "group") {
    const g = (value ?? {}) as Record<string, string>;
    const input = (sf: GroupField) => (
      <Field key={sf.key} label={sf.label} optional hint={sf.hint} error={errors[`${f.key}.${sf.key}`] ?? (g[sf.key]?.trim() ? sf.check?.(g[sf.key]) ?? undefined : undefined)}>
        {(p) => <input {...p} className={inputCls} inputMode={sf.inputMode} type={sf.inputMode === "email" ? "email" : "text"} maxLength={sf.maxLength} autoComplete="off" value={g[sf.key] ?? ""} onChange={(e) => onChange({ ...g, [sf.key]: e.target.value })} />}
      </Field>
    );
    const basic = f.fields.filter((x) => !x.advanced);
    const adv = f.fields.filter((x) => x.advanced);
    return (
      <fieldset className="rounded-md border border-line p-3">
        <legend className="px-1 text-sm font-semibold">{f.label}</legend>
        {f.hint && <p className="mb-3 text-caption text-muted">{f.hint}</p>}
        {errors[f.key] && <p role="alert" className="mb-3 text-sm font-medium text-danger">{errors[f.key]}</p>}
        <div className="grid gap-3 sm:grid-cols-2">{basic.map(input)}</div>
        {adv.length > 0 && (
          <details className="mt-3" open={adv.some((x) => g[x.key]) || undefined}>
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-primary">{f.advancedLabel ?? "More"}</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">{adv.map(input)}</div>
          </details>
        )}
      </fieldset>
    );
  }
  if (f.type === "select")
    return (
      <Field label={f.label} error={errors[f.key]}>
        {(p) => (
          <select {...p} className={selectCls} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || undefined)}>
            <option value="">Choose…</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </Field>
    );
  const v = String(value ?? "");
  const max = "max" in f ? f.max : undefined;
  return (
    <Field label={f.label} hint={"hint" in f ? f.hint : undefined} optional={f.key === "heading" || f.type === "email"} error={errors[f.key] ?? ("check" in f && f.check && v.trim() ? f.check(v) ?? undefined : undefined)}>
      {(p) => f.type === "textarea"
        ? <textarea {...p} maxLength={max} className={textareaCls} placeholder={"placeholder" in f ? f.placeholder : undefined} value={v} onChange={(e) => onChange(e.target.value)} />
        : <input {...p} maxLength={max ?? (f.type === "datetime" ? 30 : undefined)} type={f.type === "datetime" ? "datetime-local" : f.type === "url" ? "url" : f.type === "time" ? "time" : f.type === "date" ? "date" : f.type === "email" ? "email" : "text"} placeholder={"placeholder" in f ? f.placeholder : undefined} className={inputCls} value={v} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}
