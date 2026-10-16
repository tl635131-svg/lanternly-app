"use client";
import { SLUG_MESSAGE, slugIssue } from "@/lib/validate";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError, localPath, proxied } from "@/lib/api";
import { useEvent } from "@/lib/event-context";
import { useAsync } from "@/lib/hooks";
import type { Asset, AssetKind, Brief, Revisions } from "@/lib/types";
import { formatDate, humanize } from "@/lib/format";
import { Badge, StatusChip, Button, ButtonLink, Card, Dialog, EmptyState, ErrorState, Field, LoadingBlock, Notice, PageHeader, cx, inputCls, textareaCls, SafeImg } from "@/components/ui/primitives";
import { IconCheck, IconChevronDown, IconEye, IconLock, IconTrash } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { visibleFields, BRIEF_CUSTOM_DEF, customLabel, defFor, normalizeSection, validateSection, type SectionDef } from "./section-defs";
import { FieldEditor, acceptFor, invalidateAssets, uploadAsset, useEventAssets } from "./fields";

/* ───────── Revisions & approval ───────── */
export function RevisionsPage() {
  const { event, canWrite, reload, subscribe } = useEvent();
  const toast = useToast();
  const r = useAsync(() => api<Revisions>(`/api/events/${event!.id}/revisions`), [event?.id]);
  useEffect(() => subscribe((m) => { if (m.type === "revision.updated" || m.type === "stage.changed") r.reload(true); }), [subscribe, r]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (event!.serviceMode !== "studio") return <EmptyState title="Not needed for self-serve" body="You edit your invitation directly in the editor." action={<ButtonLink href={`/app/${event!.id}/invitation`}>Open editor</ButtonLink>} />;
  if (r.loading && !r.data) return <LoadingBlock rows={4} />;
  if (r.error) return <ErrorState error={r.error} onRetry={() => r.reload()} />;
  const d = r.data!;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim().length < 5) { toast("Please describe the changes (at least 5 characters).", "error"); return; }
    setBusy(true);
    try { await api(`/api/events/${event!.id}/revisions`, { body: { request: text.trim() } }); setText(""); toast("Sent to the studio"); r.reload(true); reload(); }
    catch (err) { toast(err instanceof Error ? err.message : "Failed", "error"); } finally { setBusy(false); }
  }
  async function approve() {
    try { await api(`/api/events/${event!.id}/approve`, { method: "POST" }); toast("Approved. We'll publish it shortly."); setConfirm(false); r.reload(true); reload(); }
    catch (err) { toast(err instanceof Error ? err.message : "Failed", "error"); }
  }
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Review your draft" subtitle={d.unlimited ? "Unlimited revision rounds" : `Round ${Math.min(d.used + 1, d.maxRounds)} of ${d.maxRounds} · ${d.remaining} left`}
        actions={d.draftUrl && <ButtonLink href={localPath(d.draftUrl)} target="_blank" rel="noopener" variant="outline"><IconEye size={18} />View my draft</ButtonLink>} />
      {d.approvedAt ? (
        <Notice tone="success" className="mb-5"><IconCheck size={16} className="mr-1 inline" />You approved the design on {formatDate(d.approvedAt)}. Thank you!</Notice>
      ) : d.open ? (
        <Notice className="mb-5">We&apos;re working on your latest changes. We&apos;ll let you know when the next draft is ready.</Notice>
      ) : d.stage !== "review" ? (
        <Notice className="mb-5">Your draft isn&apos;t ready for review yet. You&apos;ll get an email when it is.</Notice>
      ) : null}

      {canWrite && d.canSubmit && (
        <Card className="mb-5">
          <form onSubmit={submit}>
            <Field label="What would you like changed?" hint={`${text.length} / 5000 · List everything in one go. Each send uses one round.`}>
              {(p) => <textarea {...p} className={textareaCls + " min-h-32"} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Make the names a little larger, move the FAQ above gifts, and change the shuttle time to 14:30." />}
            </Field>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="submit" loading={busy}>Send changes</Button>
              {d.canApprove && <Button type="button" variant="accent" onClick={() => setConfirm(true)}><IconCheck size={18} />Approve design</Button>}
            </div>
          </form>
        </Card>
      )}
      {canWrite && !d.canSubmit && d.canApprove && <div className="mb-5"><Button variant="accent" onClick={() => setConfirm(true)}><IconCheck size={18} />Approve design</Button></div>}
      {!d.canSubmit && !d.unlimited && d.remaining === 0 && !d.approvedAt && <Notice tone="warning" className="mb-5">You&apos;ve used all your revision rounds. You can still approve, or contact us for extra changes.</Notice>}

      <h2 className="font-display mb-3 text-xl">History</h2>
      {d.items.length === 0 ? <EmptyState title="No change requests yet" body="When you send changes, they'll appear here with the studio's notes." /> : (
        <ol className="space-y-3">
          {d.items.map((it) => (
            <li key={it.id}>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">Round {it.round}</h3>
                  <Badge tone={it.status === "completed" ? "success" : it.status === "in_progress" ? "warning" : "neutral"}>{it.status === "submitted" ? "Received" : it.status === "in_progress" ? "In progress" : "Done"}</Badge>
                </div>
                <p className="mt-2 whitespace-pre-line text-sm">{it.request}</p>
                <p className="mt-1 text-xs text-muted">Sent {formatDate(it.createdAt, { dateStyle: "medium" })}{it.resolvedAt ? ` · done ${formatDate(it.resolvedAt, { dateStyle: "medium" })}` : ""}</p>
                {it.staffNote && <p className="mt-3 rounded-md bg-tint px-3 py-2 text-sm"><span className="font-semibold">Studio note: </span>{it.staffNote}</p>}
                {it.comments.length > 0 && (
                  <ul className="mt-3 space-y-2 border-l-2 border-line pl-3">
                    {it.comments.map((c) => <li key={c.id} className="text-sm"><span className="font-semibold">{c.author.name ?? humanize(c.author.role)}</span> <span className="text-xs text-muted">{formatDate(c.createdAt, { dateStyle: "medium" })}</span><p>{c.body}</p></li>)}
                  </ul>
                )}
                {canWrite && <CommentForm eventId={event!.id} revisionId={it.id} onDone={() => r.reload(true)} />}
              </Card>
            </li>
          ))}
        </ol>
      )}
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Approve your design?" footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Not yet</Button><Button variant="accent" onClick={approve}>Yes, approve</Button></>}>
        <p className="text-sm">Approving tells the studio the design is final and ready to publish. This can&apos;t be undone, and any unused revision rounds will close.</p>
      </Dialog>
    </div>
  );
}

function CommentForm({ eventId, revisionId, onDone }: { eventId: string; revisionId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!open) return <button className="mt-3 text-sm font-semibold text-primary underline" onClick={() => setOpen(true)}>Reply</button>;
  return (
    <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!body.trim()) return; setBusy(true); try { await api(`/api/events/${eventId}/revisions/${revisionId}/comments`, { body: { body: body.trim() } }); setBody(""); setOpen(false); onDone(); } catch (err) { toast(err instanceof Error ? err.message : "Failed", "error"); } finally { setBusy(false); } }}>
      <label htmlFor={`c-${revisionId}`} className="sr-only">Your reply</label>
      <input id={`c-${revisionId}`} className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a reply" autoFocus />
      <Button type="submit" loading={busy}>Send</Button>
    </form>
  );
}

/* ───────── Studio brief ───────── */
// Brief data uses the invitation section shapes without `heading`, plus the extra-only sections below.
const EXTRA_DEFS: Record<string, SectionDef> = {
  own_song: { key: "own_song", label: "Your own song", group: "Extras", fields: [
    { key: "libraryTrackId", label: "Pick from our library", type: "track" },
    { key: "description", label: "Or describe the song or mood", type: "textarea", max: 500 },
    { key: "url", label: "Link to a song", type: "url", max: 500 },
    { key: "assetId", label: "Or upload a track you hold the rights to", type: "asset", assetKinds: ["music"] },
    { key: "rightsConfirmed", label: "I have the rights to use this music", type: "rights" },
  ] },
  custom_link: { key: "custom_link", label: "Custom link name", group: "Extras", fields: [
    { key: "slug", label: "The link ending you'd like", type: "text", max: 60, placeholder: "maya-and-theo", hint: "Lowercase letters, numbers and hyphens, 3 to 60 characters. The studio applies it; your old link keeps working.", check: (v: string) => { const i = slugIssue(v); return i ? SLUG_MESSAGE[i] : null; } },
    { key: "note", label: "Anything else about the link", type: "textarea", max: 300 },
  ] },
  custom_monogram: { key: "custom_monogram", label: "Custom monogram", group: "Extras", fields: [
    { key: "letters", label: "Monogram letters (up to 6 characters)", type: "text", max: 6, placeholder: "M·T" },
    { key: "glowColor", label: "Glow colour", type: "color" },
    { key: "note", label: "Anything we should know about the monogram", type: "textarea", max: 500 },
  ] },
  photo_cover_film: { key: "photo_cover_film", label: "Photo cover film", group: "Extras", fields: [
    { key: "description", label: "What should the film feel like?", type: "textarea", max: 2000 },
    { key: "photos", label: "Your photos (up to 10)", type: "assets", assetKinds: ["brief_photo", "gallery"], max: 10 },
  ] },
};
export function briefDef(key: string, names: Brief["customBlockNames"]): SectionDef | null {
  if (EXTRA_DEFS[key]) return EXTRA_DEFS[key];
  if (key.startsWith("custom:")) return BRIEF_CUSTOM_DEF(key, names);
  const d = defFor(key);
  return d ? { ...d, fields: d.fields.filter((f) => f.key !== "heading") } : null;
}

export function BriefPage() {
  const { event, canWrite, reload } = useEvent();
  const toast = useToast();
  const b = useAsync(() => api<Brief>(`/api/events/${event!.id}/brief`), [event?.id]);
  const [data, setData] = useState<Brief["data"]>({});
  const [saved, setSaved] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [serverErrs, setServerErrs] = useState<Record<string, Record<string, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef<Record<string, Record<string, unknown>>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { if (b.data) setData({ ...b.data.data, ...pending.current }); }, [b.data]);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (event!.serviceMode !== "studio") return <EmptyState title="No brief needed" body="Self-serve invitations are edited directly." />;
  if (b.loading && !b.data) return <LoadingBlock rows={5} />;
  if (b.error) return <ErrorState error={b.error} onRetry={() => b.reload()} />;
  const brief = b.data!;
  const names = brief.customBlockNames;
  const editable = (k: string) => canWrite && (!brief.locked || brief.newSections.includes(k));
  const label = (k: string, fallback: string) => (k.startsWith("custom:") ? customLabel(k, names) : EXTRA_DEFS[k]?.label ?? fallback);
  const clientErrs: Record<string, Record<string, string>> = {};
  for (const sct of brief.sections) {
    const e = validateSection(briefDef(sct.key, names) ?? undefined, data[sct.key]);
    if (Object.keys(e).length) clientErrs[sct.key] = e;
  }
  function change(k: string, v: Record<string, unknown>) {
    setData((d) => ({ ...d, [k]: v }));
    if (serverErrs[k]) setServerErrs((x) => { const n = { ...x }; delete n[k]; return n; });
    pending.current[k] = v;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 1200);
  }
  async function flush() {
    const body = Object.fromEntries(Object.entries(pending.current).map(([k, v]) => [k, normalizeSection(briefDef(k, names) ?? undefined, v)]));
    if (!Object.keys(body).length) return;
    pending.current = {};
    setSaving(true); setSaveErr(null);
    try {
      const r = await api<Brief>(`/api/events/${event!.id}/brief`, { method: "PATCH", body: { data: body } });
      b.setData(r);
      setSaved(new Date());
    } catch (e) {
      pending.current = { ...body, ...pending.current }; // keep the edits so the next change retries them
      if (e instanceof ApiError && e.fields) {
        const next: Record<string, Record<string, string>> = {};
        for (const [path, m] of Object.entries(e.fields)) {
          const hit = /^data\.([^.]+)\.(.+)$/.exec(path);
          if (hit) (next[hit[1]] ??= {})[hit[2]] = m;
        }
        setServerErrs(next);
        setSaveErr("Some fields need attention");
      } else if (e instanceof ApiError && e.code === "BRIEF_LOCKED") {
        setSaveErr("Your brief is locked, so this change wasn't saved.");
        b.reload(true);
      } else setSaveErr(e instanceof Error ? e.message : "Couldn't save");
    } finally { setSaving(false); }
  }
  async function submit() {
    if (Object.keys(clientErrs).length) { toast("Fill in the highlighted required fields first", "error"); return; }
    clearTimeout(timer.current);
    await flush();
    setSubmitting(true);
    try { await api(`/api/events/${event!.id}/brief/submit`, { method: "POST" }); toast("Brief sent to the studio"); b.reload(true); reload(); }
    catch (e) { if (e instanceof ApiError && e.code === "BRIEF_INCOMPLETE") toast(`A few sections still need details: ${((e.details?.missing as string[]) ?? []).map((k) => label(k, brief.sections.find((x) => x.key === k)?.label ?? humanize(k))).join(", ")}`, "error"); else toast(e instanceof Error ? e.message : "Failed", "error"); }
    finally { setSubmitting(false); }
  }
  const { done, total, missing } = brief.completion;
  const status = brief.locked ? <><IconLock size={14} className="mr-1 inline" />Submitted {brief.submittedAt ? formatDate(brief.submittedAt, { dateStyle: "medium" }) : ""}</> : saving ? "Saving…" : saveErr ? <span className="text-danger">{saveErr}</span> : saved ? `Saved at ${saved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Changes save automatically";
  return (
    <div className="mx-auto max-w-3xl pb-20">
      <PageHeader title="Your brief" subtitle={<span aria-live="polite">{status}</span>} actions={<StatusChip tone={brief.locked ? "attending" : brief.status === "not_started" ? "neutral" : "pending"}>{({ not_started: "Not started", in_progress: "In progress", submitted: "Submitted", archived: "Archived" } as Record<string, string>)[brief.status] ?? humanize(brief.status)}</StatusChip>} />
      <div className="mb-5">
        <div className="flex flex-wrap justify-between gap-2 text-sm"><span>{done} of {total} sections complete</span>{missing.length > 0 && <span className="text-muted">Missing: {missing.map((k) => label(k, brief.sections.find((x) => x.key === k)?.label ?? humanize(k))).join(", ")}</span>}</div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Brief completion" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><div className="h-full bg-accent" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
      </div>
      {brief.locked && brief.newSections.length === 0 && <Notice className="mb-4">Your brief is with the studio and locked. Need to change something? Mention it in your review or contact us.</Notice>}
      {brief.newSections.length > 0 && <Notice tone="warning" className="mb-4">The studio added new sections for you: {brief.newSections.map((k) => label(k, brief.sections.find((x) => x.key === k)?.label ?? humanize(k))).join(", ")}.</Notice>}
      <div className="flex flex-col gap-3">
        {brief.sections.map((sct) => {
          const isDone = !missing.includes(sct.key);
          if (sct.key === "rsvp")
            return <Card key={sct.key} className="flex items-center justify-between gap-3"><span className="font-semibold">{sct.label}</span><Link href={`/app/${event!.id}/settings`} className="text-sm font-semibold text-primary underline">Set up in Settings</Link></Card>;
          const def = briefDef(sct.key, names);
          const errs = { ...(serverErrs[sct.key] ?? {}), ...(clientErrs[sct.key] ?? {}) };
          const nErr = Object.keys(errs).length;
          const sdata = data[sct.key] ?? {};
          return (
            <details key={sct.key} open={nErr > 0 || undefined} className={cx("group rounded-card border bg-surface shadow-card", nErr ? "border-danger" : brief.newSections.includes(sct.key) ? "border-accent" : "border-line")}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 marker:hidden">
                <span className="flex items-center gap-2 font-semibold">
                  <span className={cx("grid size-6 place-items-center rounded-full text-xs", isDone ? "bg-success text-surface" : "bg-surface-2 text-muted")} aria-label={isDone ? "Complete" : "Incomplete"}>{isDone ? <IconCheck size={14} /> : ""}</span>
                  {label(sct.key, sct.label)}
                  {nErr > 0 && <span className="rounded-sm bg-danger-soft px-1.5 py-0.5 text-xs font-semibold text-danger">{nErr} to fix</span>}
                </span>
                <IconChevronDown size={18} className="transition group-open:rotate-180" />
              </summary>
              <fieldset disabled={!editable(sct.key)} className="border-t border-line px-5 py-4">
                {!def ? <p className="text-sm text-muted">The studio handles this section.</p> : (
                  <div className="flex flex-col gap-4">
                    {visibleFields(def, sdata).map((f) => <FieldEditor key={f.key} f={f} value={sdata[f.key]} errors={errs} onChange={(v) => change(sct.key, { ...sdata, [f.key]: v })} />)}
                  </div>
                )}
              </fieldset>
            </details>
          );
        })}
      </div>
      <AssetsCard eventId={event!.id} canWrite={canWrite} />
      {canWrite && !brief.locked && (
        <div className="fixed inset-x-0 bottom-16 z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:bottom-0">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <span className="text-sm text-muted">{missing.length ? `${missing.length} section${missing.length > 1 ? "s" : ""} to go` : "Everything's filled in"}</span>
            <Button variant="accent" onClick={submit} loading={submitting} disabled={missing.length > 0}>Send brief to the studio</Button>
          </div>
        </div>
      )}
    </div>
  );
}

const ASSET_KINDS: [AssetKind, string][] = [
  ["brief_photo", "Photo of the two of you"],
  ["illustration_ref", "Venue or illustration reference"],
  ["cover", "Cover image"],
  ["gallery", "Gallery photo"],
  ["music", "Song file"],
];

function AssetsCard({ eventId, canWrite }: { eventId: string; canWrite: boolean }) {
  const toast = useToast();
  const a = useEventAssets(eventId);
  const [kind, setKind] = useState<AssetKind>("brief_photo");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Asset | null>(null);
  const input = useRef<HTMLInputElement>(null);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    let ok = 0;
    for (const f of Array.from(files)) {
      try { await uploadAsset(eventId, kind, f); ok++; } catch (e) { toast(e instanceof Error ? e.message : `Couldn't upload ${f.name}`, "error"); }
    }
    if (ok) toast(ok === 1 ? "Uploaded" : `${ok} files uploaded`);
    setBusy(false);
    if (input.current) input.current.value = "";
  }
  async function remove(x: Asset) {
    try { await api(`/api/events/${eventId}/assets/${x.id}`, { method: "DELETE" }); invalidateAssets(eventId); toast("File removed"); setConfirm(null); }
    catch (e) { toast(e instanceof Error ? e.message : "Couldn't remove it", "error"); }
  }
  return (
    <Card className="mt-5">
      <h2 className="font-semibold">Photos &amp; files for the studio</h2>
      <p className="text-sm text-muted">Images (JPEG, PNG, WebP, HEIC) up to 15 MB. Audio (MP3, M4A, AAC) up to 20 MB.</p>
      {canWrite && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="What is it?" className="sm:w-72">{(p) => <select {...p} className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>{ASSET_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
          <input ref={input} type="file" multiple accept={acceptFor([kind])} className="sr-only" aria-label="Choose files to upload" onChange={(e) => upload(e.target.files)} />
          <Button variant="outline" loading={busy} onClick={() => input.current?.click()}>Choose files</Button>
        </div>
      )}
      {a.loading ? <LoadingBlock rows={2} /> : a.error ? <ErrorState error={a.error} onRetry={a.reload} /> : !a.items?.length ? (
        <p className="mt-4 text-sm text-muted">Nothing uploaded yet.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {a.items.map((x) => (
            <li key={x.id} className="relative overflow-hidden rounded-md border border-line bg-surface-2">
              {x.mime.startsWith("image/") ? (
                <SafeImg src={proxied(x.url)} alt={x.originalName} className="aspect-square w-full object-cover" loading="lazy" fallback={<div className="grid aspect-square place-items-center p-2 text-center text-xs text-muted">File unavailable</div>} />
              ) : x.mime.startsWith("audio/") ? (
                <div className="grid aspect-square place-items-center p-2"><audio controls preload="none" src={proxied(x.url)} className="w-full" aria-label={x.originalName} /></div>
              ) : <div className="grid aspect-square place-items-center text-xs text-muted">File</div>}
              <p className="truncate px-2 py-1.5 text-xs" title={x.originalName}>{x.originalName}<span className="block text-muted">{humanize(x.kind)} · {Math.max(1, Math.round(x.bytes / 1024))} KB</span></p>
              {canWrite && <button type="button" onClick={() => setConfirm(x)} className="absolute right-1.5 top-1.5 grid size-8 place-items-center rounded-full border border-line bg-surface text-muted hover:text-danger" aria-label={`Remove ${x.originalName}`}><IconTrash size={14} /></button>}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title="Remove this file?" footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Keep it</Button><Button variant="danger" onClick={() => confirm && remove(confirm)}>Remove</Button></>}>
        <p className="text-sm">{confirm?.originalName} will be deleted. Anywhere it&apos;s used in your brief or invitation will show nothing instead.</p>
      </Dialog>
    </Card>
  );
}
