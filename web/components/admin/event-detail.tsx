"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { ADMIN_STAGES, orderSource, type AdminEventDetail, type Order } from "@/lib/admin";
import { slugHistory, type Brief, type Catalogue, type Invitation, type Revision, type Stage, type User } from "@/lib/types";
import { formatDate, humanize, money, relTime } from "@/lib/format";
import { Button, ButtonLink, Card, Dialog, EmptyState, ErrorState, Field, LoadingBlock, Notice, ScrollFade, Segmented, StatusChip, Toggle, cx, inputCls, selectCls, textareaCls } from "@/components/ui/primitives";
import { IconArrowLeft, IconArrowRight, IconCheck, IconCopy, IconEdit, IconExternal, IconEye, IconMail, IconPlus, IconRefresh, IconSend, IconTrash, IconWand } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { FieldEditor } from "@/components/host/fields";
import { briefDef } from "@/components/host/studio";
import { visibleFields, normalizeSection } from "@/components/host/section-defs";

type Tab = "overview" | "brief" | "review" | "invitation" | "orders";
const msg = (e: unknown, f = "Something went wrong") => (e instanceof Error ? e.message : f);

export function AdminEventPage({ id }: { id: string }) {
  const ev = useAsync(() => api<AdminEventDetail>(`/api/admin/events/${id}`), [id]);
  const [tab, setTab] = useState<Tab>("overview");
  if (ev.loading && !ev.data) return <LoadingBlock rows={6} label="Loading event" />;
  if (ev.error) return <ErrorState error={ev.error} onRetry={() => ev.reload()} title={ev.error instanceof ApiError && ev.error.status === 404 ? "This event isn't in your pipeline" : undefined} />;
  const e = ev.data!;
  const reload = () => ev.reload(true);
  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/admin" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"><IconArrowLeft size={16} />Pipeline</Link>
      <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-h2 leading-tight">{e.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-body-sm text-muted">
            <span>{e.eventDate ? `${formatDate(e.eventDate, { weekday: "short", day: "numeric", month: "long", year: "numeric" })}${e.daysToEvent != null ? ` · in ${e.daysToEvent} days` : ""}` : "No date yet"}</span>
            <span aria-hidden>·</span><span>{e.planCode ? humanize(e.planCode) : "No plan"} · {e.serviceMode === "studio" ? "Studio" : "Self-serve"}</span>
            {e.express && <span className="tag">Rush</span>}
            <StatusChip tone={e.paid ? "attending" : "pending"}>{e.paid ? "Paid" : "Unpaid"}</StatusChip>
          </p>
        </div>
        {e.invitation && <ButtonLink href={e.invitation.status === "published" ? `/i/${e.invitation.slug}` : e.revisions?.draftUrl ? new URL(e.revisions.draftUrl).pathname + new URL(e.revisions.draftUrl).search : `/i/${e.invitation.slug}`} variant="outline" target="_blank"><IconExternal size={16} />Open invitation</ButtonLink>}
      </div>
      <ScrollFade className="mt-5">
        <Segmented label="Event sections" value={tab} onChange={setTab} options={[
          { value: "overview", label: "Overview" }, { value: "brief", label: "Brief" }, { value: "review", label: "Revisions", count: e.revisions?.items.filter((r) => r.status !== "completed").length || undefined },
          { value: "invitation", label: "Invitation" }, { value: "orders", label: "Orders", count: e.orders.length || undefined },
        ]} />
      </ScrollFade>
      <div className="mt-6">
        {tab === "overview" && <OverviewTab e={e} onChange={reload} />}
        {tab === "brief" && <BriefTab id={e.id} />}
        {tab === "review" && <ReviewTab e={e} onChange={reload} />}
        {tab === "invitation" && <InvitationTab e={e} onChange={reload} />}
        {tab === "orders" && <OrdersTab e={e} onChange={reload} />}
      </div>
    </div>
  );
}

/* ───────────── Overview: stage tracker, details, hosts, emails ───────────── */
function OverviewTab({ e, onChange }: { e: AdminEventDetail; onChange: () => void }) {
  const { me } = useSession();
  const isAdmin = me?.role === "admin";
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [confirm, setConfirm] = useState<"access" | "delete" | null>(null);
  const idx = ADMIN_STAGES.findIndex((s) => s.key === e.productionStage);
  async function setStage(body: { stage: Stage } | { advance: true }) {
    setBusy("stage");
    try { await api(`/api/admin/events/${e.id}/stage`, { body }); toast("Stage updated. The host is notified where it matters."); onChange(); } catch (x) { toast(msg(x), "error"); } finally { setBusy(null); }
  }
  async function sendAccess() {
    setBusy("access");
    try { await api(`/api/admin/events/${e.id}/send-access`, { method: "POST" }); toast("Sign-in link emailed to the owner"); setConfirm(null); } catch (x) { toast(msg(x), "error"); } finally { setBusy(null); }
  }
  async function remove() {
    setBusy("delete");
    try { await api(`/api/admin/events/${e.id}`, { method: "DELETE" }); toast("Event deleted"); router.replace("/admin"); } catch (x) { toast(msg(x), "error"); setBusy(null); }
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-5">
        {e.serviceMode === "studio" && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">Production stage</h2>
              <span className="text-caption text-muted">{e.progress}% complete</span>
            </div>
            <ScrollFade className="mt-4">
              <ol className="stepper min-w-[640px]" aria-label="Production stages">
                {ADMIN_STAGES.map((s, i) => (
                  <li key={s.key} aria-current={i === idx ? "step" : undefined} className={cx("step", i < idx ? "done" : i === idx ? "current" : "")}>
                    <span className="dot tabular">{i < idx ? <IconCheck size={16} /> : i + 1}</span>{s.label}
                  </li>
                ))}
              </ol>
            </ScrollFade>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {idx < ADMIN_STAGES.length - 1 && <Button loading={busy === "stage"} onClick={() => setStage({ advance: true })}>Move to {ADMIN_STAGES[idx + 1]?.label}<IconArrowRight size={16} /></Button>}
              <label htmlFor="set-stage" className="sr-only">Set stage</label>
              <select id="set-stage" className={selectCls + " w-auto"} value={e.productionStage ?? ""} onChange={(x) => setStage({ stage: x.target.value as Stage })} disabled={busy === "stage"}>
                {ADMIN_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
          </Card>
        )}
        <DetailsForm e={e} onSaved={onChange} />
      </div>
      <aside className="flex flex-col gap-5">
        <Card>
          <h2 className="font-semibold">Hosts</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {e.members.map((m) => (
              <li key={m.user.id} className="flex items-center gap-3 text-sm">
                <span aria-hidden className="avatar">{(m.user.name ?? m.user.email).slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{m.user.name ?? m.user.email}</span><span className="block truncate text-caption text-muted">{m.user.email} · {humanize(m.role)}</span></span>
              </li>
            ))}
            {e.members.length === 0 && <li className="text-sm text-muted">No hosts linked yet.</li>}
          </ul>
          <div className="mt-4 grid gap-2">
            <Button variant="outline" onClick={() => setConfirm("access")}><IconSend size={16} />Send sign-in link</Button>
            <Button variant="outline" onClick={() => setEmailOpen(true)}><IconMail size={16} />Email the host</Button>
          </div>
          {e.deliveryEmailSentAt && <p className="mt-3 text-caption text-muted">Delivery email sent {relTime(e.deliveryEmailSentAt)} ({e.deliveryEmailSentCount}×)</p>}
        </Card>
        {e.stats && (
          <Card>
            <h2 className="font-semibold">Replies</h2>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {([["attending", e.stats.totalAttendees], ["declined", e.stats.declined], ["pending", e.stats.awaiting]] as const).map(([k, v]) => (
                <div key={k} className="rounded-md bg-surface-2 py-2"><dt className="text-caption text-muted">{{ attending: "Coming", declined: "Can't come", pending: "Waiting" }[k]}</dt><dd className="tabular text-h3 font-bold">{v}</dd></div>
              ))}
            </dl>
          </Card>
        )}
        {e.deletionRequestedAt && <Notice tone="warning">The host asked to delete this event {relTime(e.deletionRequestedAt)}.</Notice>}
        {isAdmin && <Button variant="ghost" className="justify-start text-danger" onClick={() => setConfirm("delete")}><IconTrash size={16} />Delete event</Button>}
      </aside>
      <EmailDialog open={emailOpen} eventId={e.id} onClose={() => setEmailOpen(false)} />
      <Dialog open={confirm === "access"} onClose={() => setConfirm(null)} title="Send a sign-in link?" footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button loading={busy === "access"} onClick={sendAccess}>Send link</Button></>}>
        <p className="text-sm">We&apos;ll email the owner a one-time link to set their password or sign in. No password is ever shown or sent.</p>
      </Dialog>
      <Dialog open={confirm === "delete"} onClose={() => setConfirm(null)} title="Delete this event?" footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" loading={busy === "delete"} onClick={remove}>Delete event</Button></>}>
        <p className="text-sm">{e.title} and its guest list are removed from every dashboard. Orders stay on record.</p>
      </Dialog>
    </div>
  );
}

function DetailsForm({ e, onSaved }: { e: AdminEventDetail; onSaved: () => void }) {
  const { me } = useSession();
  const toast = useToast();
  const staff = useAsync(() => (me?.role === "admin" ? api<{ items: User[] }>("/api/admin/users", { query: { limit: 200 } }) : Promise.resolve(null)), [me?.role]);
  const init = () => ({
    title: e.title, partner1: e.hostNames.partner1 ?? "", partner2: e.hostNames.partner2 ?? "", honoree: e.hostNames.honoree ?? "", eventDate: e.eventDate ?? "",
    venueName: e.venueName ?? "", venueAddress: e.venueAddress ?? "", express: e.express, highSeasonNotice: e.highSeasonNotice, maxRevisionRounds: String(e.maxRevisionRounds),
    assignedStaffId: e.assignedStaffId ?? "", adminNote: e.adminNote ?? "", languages: [...e.languages],
  });
  const cat = useAsync(() => api<Catalogue>("/api/public/catalogue"));
  const [addonMsg, setAddonMsg] = useState<string | null>(null);
  const limit = Math.min(8, e.maxLanguages ?? cat.data?.plans.find((p) => p.code === e.planCode)?.maxLanguages ?? 8);
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setF(init()), [e]);
  const base = init();
  const dirty = JSON.stringify(base) !== JSON.stringify(f);
  const person = !!e.hostNames.honoree;
  async function save() {
    const body: Record<string, unknown> = {};
    if (f.title !== base.title) body.title = f.title.trim();
    if (f.partner1 !== base.partner1 || f.partner2 !== base.partner2 || f.honoree !== base.honoree)
      body.hostNames = person ? { honoree: f.honoree.trim() } : { partner1: f.partner1.trim(), partner2: f.partner2.trim() || undefined };
    if (f.eventDate !== base.eventDate && f.eventDate) body.eventDate = f.eventDate;
    if (f.venueName !== base.venueName) body.venueName = f.venueName.trim();
    if (f.venueAddress !== base.venueAddress) body.venueAddress = f.venueAddress.trim();
    if (f.express !== base.express) body.express = f.express;
    if (f.highSeasonNotice !== base.highSeasonNotice) body.highSeasonNotice = f.highSeasonNotice;
    if (f.maxRevisionRounds !== base.maxRevisionRounds) body.maxRevisionRounds = Number(f.maxRevisionRounds);
    if (f.assignedStaffId !== base.assignedStaffId && f.assignedStaffId) body.assignedStaffId = f.assignedStaffId;
    if (f.adminNote !== base.adminNote) body.adminNote = f.adminNote;
    if (f.languages.join(",") !== base.languages.join(",")) body.languages = f.languages;
    setBusy(true); setErr({}); setAddonMsg(null);
    try { await api(`/api/admin/events/${e.id}`, { method: "PATCH", body }); toast("Saved"); onSaved(); }
    catch (x) {
      if (x instanceof ApiError && x.status === 402) {
        const miss = Array.isArray(x.details?.missing) ? (x.details!.missing as { code: string; qty?: number }[]) : [];
        const n = miss.find((m) => m.code === "extra_language")?.qty;
        const m = `Not saved: this event has paid for ${e.maxLanguages ?? "its"} languages. ${n ? `It needs ${n} more Extra language unit${n === 1 ? "" : "s"}` : "More languages need Extra language units"}, bought by the customer through Add extras (or record a manual order).`;
        setAddonMsg(m); setErr({ languages: "Over the paid language limit" }); toast(m, "error");
      } else { if (x instanceof ApiError && x.fields) setErr(x.fields); toast(msg(x, "Couldn't save"), "error"); }
    } finally { setBusy(false); }
  }
  const designers = staff.data?.items.filter((u) => u.role !== "host" && !u.disabled) ?? [];
  return (
    <Card>
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Event details</h2>{dirty && <span className="status pending">Unsaved changes</span>}</div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Title" error={err.title} className="sm:col-span-2">{(p) => <input {...p} className={inputCls} value={f.title} onChange={(x) => setF({ ...f, title: x.target.value })} />}</Field>
        {person ? <Field label="Honoree" className="sm:col-span-2">{(p) => <input {...p} className={inputCls} value={f.honoree} onChange={(x) => setF({ ...f, honoree: x.target.value })} />}</Field> : <>
          <Field label="Partner 1">{(p) => <input {...p} className={inputCls} value={f.partner1} onChange={(x) => setF({ ...f, partner1: x.target.value })} />}</Field>
          <Field label="Partner 2">{(p) => <input {...p} className={inputCls} value={f.partner2} onChange={(x) => setF({ ...f, partner2: x.target.value })} />}</Field>
        </>}
        <Field label="Event date" error={err.eventDate}>{(p) => <input {...p} type="date" className={inputCls} value={f.eventDate} onChange={(x) => setF({ ...f, eventDate: x.target.value })} />}</Field>
        <Field label="Revision rounds" hint="0 means none; 99 means unlimited.">{(p) => <input {...p} type="number" min={0} max={99} className={inputCls} value={f.maxRevisionRounds} onChange={(x) => setF({ ...f, maxRevisionRounds: x.target.value })} />}</Field>
        <Field label="Venue">{(p) => <input {...p} className={inputCls} value={f.venueName} onChange={(x) => setF({ ...f, venueName: x.target.value })} />}</Field>
        <Field label="Venue address">{(p) => <input {...p} className={inputCls} value={f.venueAddress} onChange={(x) => setF({ ...f, venueAddress: x.target.value })} />}</Field>
        {me?.role === "admin" && (
          <Field label="Designer" className="sm:col-span-2">{(p) => <select {...p} className={selectCls} value={f.assignedStaffId} onChange={(x) => setF({ ...f, assignedStaffId: x.target.value })}><option value="" disabled>Unassigned</option>{designers.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.email} · {u.role === "admin" ? "Admin" : "Designer"}</option>)}</select>}</Field>
        )}
        <div className="space-y-3 sm:col-span-2">
          <Toggle checked={f.express} onChange={(v) => setF({ ...f, express: v })} label="Rush priority" description="Set automatically when the rush design add-on is bought." />
          <Toggle checked={f.highSeasonNotice} onChange={(v) => setF({ ...f, highSeasonNotice: v })} label="High-season notice" description="Tells the host that turnaround may take longer." />
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-semibold">Languages <span className="font-normal text-muted">({f.languages.length} / {limit}: plan limit plus paid Extra language units, 8 at most)</span></legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(cat.data?.languages ?? f.languages.map((c) => ({ code: c, label: c.toUpperCase() }))).map((l) => {
              const on = f.languages.includes(l.code);
              const primary = l.code === e.primaryLanguage;
              return <button key={l.code} type="button" aria-pressed={on} disabled={primary || (!on && f.languages.length >= 8)} title={primary ? "Main language" : undefined} className={cx("chip", on && "is-on")} onClick={() => setF({ ...f, languages: on ? f.languages.filter((x) => x !== l.code) : [...f.languages, l.code] })}>{on && <IconCheck size={16} />}{l.label}</button>;
            })}
          </div>
          {f.languages.length > limit && <p className="mt-1 text-caption font-medium text-warning">Over the paid limit of {limit}. Saving needs Extra language units on a paid event.</p>}
          {err.languages && !addonMsg && <p className="mt-1 text-caption font-medium text-danger">{err.languages}</p>}
          {addonMsg && <Notice tone="danger" className="mt-2">{addonMsg}</Notice>}
        </fieldset>
        <Field label="Internal note" hint="Only the studio team sees this." className="sm:col-span-2">{(p) => <textarea {...p} className={textareaCls} value={f.adminNote} onChange={(x) => setF({ ...f, adminNote: x.target.value })} />}</Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        {dirty && <Button variant="ghost" onClick={() => setF(init())}>Discard</Button>}
        <Button disabled={!dirty} loading={busy} onClick={save}>Save details</Button>
      </div>
    </Card>
  );
}

const TEMPLATES = [
  { value: "draft_ready", label: "Draft is ready to review" },
  { value: "invitation_ready", label: "Invitation is live" },
  { value: "std_ready", label: "Save-the-date is ready" },
  { value: "custom", label: "Custom message" },
] as const;
function EmailDialog({ open, eventId, onClose }: { open: boolean; eventId: string; onClose: () => void }) {
  const toast = useToast();
  const [tpl, setTpl] = useState<(typeof TEMPLATES)[number]["value"]>("draft_ready");
  const [note, setNote] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setTpl("draft_ready"); setNote(""); setSubject(""); setBody(""); setErr({}); } }, [open]);
  async function send() {
    const e: Record<string, string> = {};
    if (tpl === "custom" && !subject.trim()) e.subject = "Add a subject.";
    if (tpl === "custom" && !body.trim()) e.body = "Write the message.";
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await api(`/api/admin/events/${eventId}/emails`, { body: tpl === "custom" ? { template: tpl, subject: subject.trim(), body: body.trim() } : { template: tpl, note: note.trim() || undefined } });
      toast("Email queued for the host"); onClose();
    } catch (x) { if (x instanceof ApiError && x.fields) setErr(x.fields); toast(msg(x), "error"); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Email the host" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={send}><IconSend size={16} />Queue email</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Template">{(p) => <select {...p} className={selectCls} value={tpl} onChange={(x) => setTpl(x.target.value as typeof tpl)}>{TEMPLATES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}</Field>
        {tpl === "custom" ? <>
          <Field label="Subject" error={err.subject} required>{(p) => <input {...p} maxLength={200} className={inputCls} value={subject} onChange={(x) => setSubject(x.target.value)} />}</Field>
          <Field label="Message" error={err.body} required>{(p) => <textarea {...p} rows={6} maxLength={5000} className={textareaCls} value={body} onChange={(x) => setBody(x.target.value)} />}</Field>
        </> : <Field label="Personal note" optional hint="Added above the standard text.">{(p) => <textarea {...p} rows={3} maxLength={2000} className={textareaCls} value={note} onChange={(x) => setNote(x.target.value)} />}</Field>}
      </div>
    </Dialog>
  );
}

/* ───────────── Brief: read every section; edit even when locked; add sections ───────────── */
function BriefTab({ id }: { id: string }) {
  const toast = useToast();
  const b = useAsync(() => api<Brief>(`/api/admin/events/${id}/brief`), [id]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  if (b.loading && !b.data) return <LoadingBlock rows={4} label="Loading brief" />;
  if (b.error) return <ErrorState error={b.error} onRetry={() => b.reload()} />;
  const brief = b.data!;
  async function save(key: string) {
    setBusy(true);
    try {
      await api(`/api/admin/events/${id}/brief`, { method: "PATCH", body: { data: { [key]: normalizeSection(briefDef(key, brief.customBlockNames) ?? undefined, draft) } } });
      toast("Brief updated"); setEditing(null); b.reload(true);
    } catch (x) { toast(msg(x, "Couldn't save"), "error"); } finally { setBusy(false); }
  }
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <StatusChip tone={brief.locked ? "attending" : brief.status === "not_started" ? "neutral" : "pending"}>{brief.locked ? "Submitted" : humanize(brief.status)}</StatusChip>
          <span className="text-muted">{brief.completion.done} of {brief.completion.total} sections complete{brief.submittedAt ? ` · submitted ${formatDate(brief.submittedAt, { dateStyle: "medium" })}` : ""}</span>
        </p>
        <Button variant="outline" onClick={() => setAddOpen(true)}><IconPlus size={16} />Ask for more sections</Button>
      </div>
      {brief.sections.length === 0 ? <EmptyState title="No brief sections" body="This plan doesn't use a brief." /> : (
        <div className="grid gap-3">
          {brief.sections.map((s) => {
            const def = briefDef(s.key, brief.customBlockNames);
            const data = brief.data[s.key] ?? {};
            const missing = brief.completion.missing.includes(s.key);
            const isEdit = editing === s.key;
            return (
              <Card key={s.key} as="article" className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 font-semibold">{s.label}{missing && <span className="status pending">Missing</span>}{brief.newSections.includes(s.key) && <span className="badge-new">New</span>}</h3>
                  {def && !isEdit && <Button size="sm" variant="ghost" onClick={() => { setDraft(data); setEditing(s.key); }}><IconEdit size={16} />Edit</Button>}
                </div>
                {isEdit && def ? (
                  <div className="mt-4 flex flex-col gap-4">
                    {visibleFields(def, draft).map((f) => <FieldEditor key={f.key} f={f} value={draft[f.key]} onChange={(v) => setDraft({ ...draft, [f.key]: v })} />)}
                    <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button loading={busy} onClick={() => save(s.key)}>Save section</Button></div>
                  </div>
                ) : <BriefValue value={data} labels={Object.fromEntries((def?.fields ?? []).map((f) => [f.key, f.label]))} />}
              </Card>
            );
          })}
        </div>
      )}
      <AddSectionsDialog open={addOpen} id={id} existing={brief.sections.map((s) => s.key)} onClose={() => setAddOpen(false)} onDone={() => { setAddOpen(false); b.reload(true); }} />
    </div>
  );
}

/** Read-only rendering of brief JSON: text, lists, rows and asset references. */
function BriefValue({ value, labels = {} }: { value: unknown; labels?: Record<string, string> }) {
  if (value == null || value === "" || (typeof value === "object" && Object.keys(value as object).length === 0)) return <p className="mt-2 text-sm text-muted">Nothing yet.</p>;
  if (typeof value !== "object") return <p className="mt-2 whitespace-pre-line text-sm">{String(value)}</p>;
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== "object")) return <p className="mt-2 text-sm">{value.join(", ")}</p>;
    return (
      <ol className="mt-2 flex flex-col gap-2">
        {value.map((row, i) => <li key={i} className="rounded-md bg-surface-2 px-3 py-2 text-sm">{Object.entries(row as object).filter(([, v]) => v !== "" && v != null).map(([k, v]) => <span key={k} className="mr-3 inline-block"><span className="text-muted">{labels[k] ?? humanize(k)}: </span>{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>)}</li>)}
      </ol>
    );
  }
  return (
    <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[180px_minmax(0,1fr)]">
      {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
        <div key={k} className="contents"><dt className="text-muted">{labels[k] ?? humanize(k)}</dt><dd className="min-w-0 break-words">{typeof v === "object" && v !== null ? <BriefValue value={v} /> : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v ?? "—")}</dd></div>
      ))}
    </dl>
  );
}

function AddSectionsDialog({ open, id, existing, onClose, onDone }: { open: boolean; id: string; existing: string[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const cat = useAsync(() => (open ? api<Catalogue>("/api/public/catalogue") : Promise.resolve(null)), [open]);
  const [pick, setPick] = useState<string[]>([]);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPick([]); setNotify(true); } }, [open]);
  const options = (cat.data?.sections ?? []).filter((s) => !existing.includes(s.key) && s.key !== "rsvp");
  async function submit() {
    setBusy(true);
    try { await api(`/api/admin/events/${id}/brief/sections`, { body: { sections: pick, notify } }); toast(notify ? "Sections added. The host is asked to fill them in." : "Sections added"); onDone(); }
    catch (x) { toast(msg(x), "error"); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Ask for more sections" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!pick.length} loading={busy} onClick={submit}>Add {pick.length || ""} section{pick.length === 1 ? "" : "s"}</Button></>}>
      {cat.loading && !cat.data ? <LoadingBlock rows={2} /> : options.length === 0 ? <p className="text-sm text-muted">Every section is already in this brief.</p> : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">{options.map((s) => { const on = pick.includes(s.key); return <button key={s.key} type="button" aria-pressed={on} className={cx("chip", on && "is-on")} onClick={() => setPick(on ? pick.filter((k) => k !== s.key) : [...pick, s.key])}>{on && <IconCheck size={16} />}{s.label}</button>; })}</div>
          <Toggle checked={notify} onChange={setNotify} label="Email the host" description="They can edit just these sections, even though the brief is submitted." />
        </div>
      )}
    </Dialog>
  );
}

/* ───────────── Revisions: rounds, status, studio note ───────────── */
function ReviewTab({ e, onChange }: { e: AdminEventDetail; onChange: () => void }) {
  const r = e.revisions;
  if (!r) return <EmptyState title="No revisions for this plan" body="Self-serve invitations are edited by the host directly." />;
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm"><span className="font-semibold">{r.unlimited ? `${r.used} rounds used · unlimited` : `${r.used} of ${r.maxRounds} rounds used`}</span><span className="text-muted"> · {r.approvedAt ? `design approved ${formatDate(r.approvedAt, { dateStyle: "medium" })}` : "not approved yet"}</span></p>
        {r.draftUrl && <ButtonLink size="sm" variant="outline" href={new URL(r.draftUrl).pathname + new URL(r.draftUrl).search} target="_blank"><IconEye size={16} />View draft as the host</ButtonLink>}
      </Card>
      {r.items.length === 0 ? <EmptyState title="No change requests yet" body="When the host asks for changes, the round appears here." /> : r.items.map((it) => <RevisionCard key={it.id} it={it} onSaved={onChange} />)}
    </div>
  );
}
function RevisionCard({ it, onSaved }: { it: Revision; onSaved: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState(it.status);
  const [note, setNote] = useState(it.staffNote ?? "");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const dirty = status !== it.status || note !== (it.staffNote ?? "");
  async function save() {
    setBusy(true);
    try { await api(`/api/admin/revisions/${it.id}`, { method: "PATCH", body: { status, staffNote: note.trim() || undefined, notify } }); toast("Round updated"); onSaved(); }
    catch (x) { toast(msg(x), "error"); } finally { setBusy(false); }
  }
  const tone = it.status === "completed" ? "attending" : it.status === "in_progress" ? "info" : "pending";
  return (
    <Card as="article">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Round {it.round}</h3>
        <span className="flex items-center gap-2 text-caption text-muted"><StatusChip tone={tone}>{({ submitted: "New request", in_progress: "In progress", completed: "Done" } as const)[it.status]}</StatusChip>{relTime(it.createdAt)}</span>
      </div>
      <blockquote className="mt-3 rounded-md border-l-4 border-accent bg-surface-2 px-4 py-3 text-sm">{it.request}</blockquote>
      {it.comments.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {it.comments.map((c) => <li key={c.id} className="text-sm"><span className="font-semibold">{c.author.name ?? humanize(c.author.role)}</span> <span className="text-caption text-muted">{relTime(c.createdAt)}</span><p>{c.body}</p></li>)}
        </ul>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
        <Field label="Status">{(p) => <select {...p} className={selectCls} value={status} onChange={(x) => setStatus(x.target.value as Revision["status"])}><option value="submitted">New request</option><option value="in_progress">In progress</option><option value="completed">Done</option></select>}</Field>
        <Field label="Note to the host" optional>{(p) => <textarea {...p} rows={2} maxLength={5000} className={textareaCls} value={note} onChange={(x) => setNote(x.target.value)} placeholder="What changed in this round" />}</Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--brand-primary)]" checked={notify} onChange={(x) => setNotify(x.target.checked)} />Email the host about this update</label>
        <Button disabled={!dirty} loading={busy} onClick={save}>Update round</Button>
      </div>
    </Card>
  );
}

/* ───────────── Invitation: generate, preview link, publish, versions ───────────── */
type Version = { version: number; createdAt: string; publishedAt?: string | null; createdBy?: { name: string | null } | null; note?: string | null };
function InvitationTab({ e, onChange }: { e: AdminEventDetail; onChange: () => void }) {
  const toast = useToast();
  const invId = e.invitation?.id;
  const inv = useAsync(() => (invId ? api<Invitation>(`/api/admin/invitations/${invId}`) : Promise.resolve(null)), [invId]);
  const versions = useAsync(() => (invId ? api<{ items: Version[] } | Version[]>(`/api/admin/invitations/${invId}/versions`) : Promise.resolve(null)), [invId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"generate" | "publish" | "unpublish" | number | null>(null);
  if (!invId) return <EmptyState title="No invitation yet" body="The invitation is created with the order. Refresh once the order is paid." />;
  if (inv.loading && !inv.data) return <LoadingBlock rows={3} label="Loading invitation" />;
  if (inv.error) return <ErrorState error={inv.error} onRetry={() => inv.reload()} />;
  const i = inv.data!;
  const vs = (Array.isArray(versions.data) ? versions.data : versions.data?.items) ?? [];
  async function act(kind: "generate" | "publish" | "unpublish" | "preview" | "rollback", version?: number) {
    setBusy(kind);
    try {
      if (kind === "preview") {
        const r = await api<{ url?: string; previewUrl?: string; token?: string }>(`/api/admin/invitations/${invId}/preview-token`, { method: "POST" });
        setPreview(r.previewUrl ?? r.url ?? (r.token ? `${location.origin}/i/${i.slug}?preview=${r.token}` : null));
      } else {
        const path = kind === "generate" ? "generate-from-brief" : kind;
        await api(`/api/admin/invitations/${invId}/${path}`, { body: kind === "rollback" ? { version } : {} });
        toast({ generate: "Draft filled from the brief", publish: "Published", unpublish: "Unpublished. Guests see a closed page.", rollback: `Restored version ${version}` }[kind]);
        setConfirm(null); inv.reload(true); versions.reload(true); onChange();
      }
    } catch (x) { toast(msg(x), "error"); } finally { setBusy(null); }
  }
  const live = i.status === "published";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-5">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">/{i.slug}</h2>
            <span className="flex items-center gap-2"><StatusChip tone={live ? "attending" : "neutral"}>{live ? "Live" : humanize(i.status)}</StatusChip><span className="text-caption text-muted">v{i.version} · {i.theme ? i.theme.name.en : "No style"}</span></span>
          </div>
          <p className="mt-2 text-sm text-muted">{live ? `Published ${i.publishedAt ? formatDate(i.publishedAt, { dateStyle: "medium" }) : ""}. Guests can open it and reply.` : "Not visible to guests yet."}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setConfirm("generate")}><IconWand size={16} />Fill from brief</Button>
            <Button variant="outline" loading={busy === "preview"} onClick={() => act("preview")}><IconEye size={16} />Preview link</Button>
            {live ? <Button variant="outline" onClick={() => setConfirm("unpublish")}>Unpublish</Button> : <Button variant="accent" onClick={() => setConfirm("publish")}><IconSend size={16} />Publish</Button>}
          </div>
          {preview && <PreviewLink url={preview} />}
          {slugHistory(i.previousSlugs).length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-semibold">Previous links{i.customLinkLocked ? " · custom link in use" : ""}</p>
              <ul className="mt-1 divide-y divide-line text-sm">
                {slugHistory(i.previousSlugs).map((p) => <li key={p.oldSlug} className="flex flex-wrap justify-between gap-2 py-2"><span className="break-all text-muted">/i/{p.oldSlug}</span><span className="text-caption text-muted">Redirects{p.createdAt ? ` · changed ${formatDate(p.createdAt, { dateStyle: "medium" })}` : ""}</span></li>)}
              </ul>
            </div>
          )}
          <Notice className="mt-4">Detailed design work (palette, fonts, sections, music) uses the same editor as hosts. Generate from the brief first, then fine-tune and publish.</Notice>
        </Card>
      </div>
      <Card>
        <div className="flex items-center justify-between"><h2 className="font-semibold">Versions</h2><button className="grid size-11 place-items-center rounded-md text-muted hover:bg-surface-2" aria-label="Refresh versions" onClick={() => versions.reload()}><IconRefresh size={16} /></button></div>
        {versions.loading && !versions.data ? <LoadingBlock rows={2} /> : versions.error ? <ErrorState error={versions.error} onRetry={() => versions.reload()} /> : vs.length === 0 ? <p className="mt-3 text-sm text-muted">No saved versions yet.</p> : (
          <ul className="mt-3 divide-y divide-line">
            {vs.map((v) => (
              <li key={v.version} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span><span className="font-semibold">v{v.version}</span> <span className="text-caption text-muted">{relTime(v.createdAt)}{v.publishedAt ? " · published" : ""}</span></span>
                {v.version !== i.version && <Button size="sm" variant="ghost" onClick={() => setConfirm(v.version)}>Restore</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Dialog open={confirm != null} onClose={() => setConfirm(null)}
        title={confirm === "generate" ? "Fill the draft from the brief?" : confirm === "publish" ? "Publish this invitation?" : confirm === "unpublish" ? "Unpublish?" : `Restore version ${confirm}?`}
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button variant={confirm === "unpublish" ? "danger" : "primary"} loading={!!busy} onClick={() => (typeof confirm === "number" ? act("rollback", confirm) : confirm && act(confirm))}>{confirm === "generate" ? "Fill draft" : confirm === "publish" ? "Publish" : confirm === "unpublish" ? "Unpublish" : "Restore"}</Button></>}>
        <p className="text-sm">{confirm === "generate" ? "The draft's text, cover, monogram, colours and music are replaced with what the host wrote in the brief. The live page doesn't change until you publish." : confirm === "publish" ? "Guests with the link will see this version straight away." : confirm === "unpublish" ? "Guests will see a closed page until it's published again. Replies stay safe." : "The draft is replaced with this version. Publish afterwards to make it live."}</p>
      </Dialog>
    </div>
  );
}
function PreviewLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 flex items-center gap-2 rounded-md bg-surface-2 p-2 pl-3 text-sm">
      <span className="min-w-0 flex-1 truncate font-mono text-caption">{url}</span>
      <button className="grid size-11 place-items-center rounded-md hover:bg-surface" aria-label="Copy preview link" onClick={() => { navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? <IconCheck size={16} /> : <IconCopy size={16} />}</button>
      <a className="grid size-11 place-items-center rounded-md hover:bg-surface" href={url} target="_blank" rel="noopener noreferrer" aria-label="Open preview"><IconExternal size={16} /></a>
    </div>
  );
}

/* ───────────── Orders for this event ───────────── */
function OrdersTab({ e, onChange }: { e: AdminEventDetail; onChange: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const nameOf = useAdminNames();
  if (e.orders.length === 0) return <EmptyState title="No orders" body="Self-serve drafts have no order until the host pays to publish." />;
  return (
    <>
      <ul className="flex flex-col gap-2">
        {e.orders.map((o) => (
          <li key={o.id}><button className="card flex w-full items-center justify-between gap-3 p-4 text-left hover:shadow-raised" onClick={() => setOpen(o.id)}>
            <span><span className="block font-semibold">{o.number}</span><span className="flex flex-wrap items-center gap-2 text-caption text-muted">{o.paidAt ? `Paid ${formatDate(o.paidAt, { dateStyle: "medium" })}` : "Not paid"}<OrderSource o={o} nameOf={nameOf} /></span></span>
            <span className="flex items-center gap-3"><OrderStatus s={o.status} /><span className="tabular font-semibold">{money(o.totalCents, o.currency)}</span></span>
          </button></li>
        ))}
      </ul>
      <OrderDialog id={open} onClose={() => setOpen(null)} onChanged={onChange} />
    </>
  );
}

/** Admin names for "created by" (the users list is admin-only; staff see a generic label). */
export function useAdminNames() {
  const { me } = useSession();
  const users = useAsync(() => (me?.role === "admin" ? api<{ items: User[] }>("/api/admin/users", { query: { limit: 200 } }) : Promise.resolve(null)), [me?.role]);
  return (id?: string | null) => { const u = id ? users.data?.items.find((x) => x.id === id) : null; return u ? (u.name ?? u.email) : id ? "a studio admin" : null; };
}
export function OrderSource({ o, nameOf }: { o: { source?: string; paymentProvider?: string; createdByAdminId?: string | null }; nameOf: (id?: string | null) => string | null }) {
  const src = orderSource(o);
  if (src === "checkout") return <span className="tag">Checkout</span>;
  const who = nameOf(o.createdByAdminId);
  return <span className="inline-flex flex-wrap items-center gap-1"><span className="tag">Manual</span>{who && <span className="text-caption text-muted">by {who}</span>}</span>;
}

export function OrderStatus({ s }: { s: string }) {
  const map: Record<string, [string, "attending" | "pending" | "declined" | "neutral" | "info"]> = { paid: ["Paid", "attending"], pending_payment: ["Awaiting payment", "pending"], draft: ["Draft", "neutral"], refunded: ["Refunded", "info"], canceled: ["Canceled", "declined"] };
  const [l, tone] = map[s] ?? [humanize(s), "neutral"];
  return <StatusChip tone={tone}>{l}</StatusChip>;
}
export function OrderDialog({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged?: () => void }) {
  const o = useAsync(() => (id ? api<Order>(`/api/admin/orders/${id}`) : Promise.resolve(null)), [id]);
  const d = o.data;
  const { me } = useSession();
  const nameOf = useAdminNames();
  const [refund, setRefund] = useState(false);
  const canRefund = !!d && me?.role === "admin" && orderSource(d) === "manual" && d.status === "paid";
  // The refund reason lives in the event's audit trail (order.manual_refunded), not on the order. It is stored raw
  // (HTML included), so it is only ever rendered as a React text node below, never as HTML.
  const audit = useAsync(
    () => (d && d.status === "refunded" && !d.refundReason && d.eventId
      ? api<{ items: { action: string; data: { orderId?: string; reason?: unknown } }[] }>(`/api/events/${d.eventId}/activity`, { query: { limit: 100 } })
      : Promise.resolve(null)),
    [d?.id, d?.status],
  );
  const reasonRaw = d?.refundReason ?? audit.data?.items.find((x) => x.action === "order.manual_refunded" && x.data.orderId === d?.id)?.data.reason;
  const refundReason = typeof reasonRaw === "string" ? reasonRaw : null;
  return (
    <Dialog open={!!id} onClose={onClose} title={d ? `Order ${d.number}` : "Order"} wide>
      {o.loading && !d ? <LoadingBlock rows={3} /> : o.error ? <ErrorState error={o.error} onRetry={() => o.reload()} /> : d && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm"><OrderStatus s={d.status} /><OrderSource o={d} nameOf={nameOf} /><span className="text-muted">{d.email} · {d.paymentProvider === "mock" ? "Test payment" : humanize(d.paymentProvider)} · created {formatDate(d.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span></div>
          {d.status === "refunded" && (
            <Notice>
              Refunded{d.refundedAt ? ` on ${formatDate(d.refundedAt, { dateStyle: "medium" })}` : ""}. Its add-ons no longer count as purchased.
              {refundReason && <span className="mt-1 block break-words"><span className="font-semibold">Reason: </span>{refundReason}</span>}
            </Notice>
          )}
          <table className="w-full text-sm">
            <caption className="sr-only">Line items</caption>
            <thead className="text-left text-caption text-muted"><tr><th scope="col" className="pb-2">Item</th><th scope="col" className="pb-2 text-right">Qty</th><th scope="col" className="pb-2 text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-line border-y border-line">
              {(d.items ?? []).map((it) => <tr key={it.id}><td className="py-2">{it.label}<span className="block text-caption text-muted">{humanize(it.kind)}</span></td><td className="tabular py-2 text-right">{it.qty}</td><td className="tabular py-2 text-right">{money(it.unitPriceCents * it.qty, d.currency)}</td></tr>)}
            </tbody>
            <tfoot className="tabular">
              <tr><th scope="row" className="pt-3 text-left font-normal text-muted" colSpan={2}>Subtotal</th><td className="pt-3 text-right">{money(d.subtotalCents, d.currency)}</td></tr>
              {!!d.discountCents && <tr><th scope="row" className="text-left font-normal text-muted" colSpan={2}>Discount</th><td className="text-right">−{money(d.discountCents, d.currency)}</td></tr>}
              <tr><th scope="row" className="text-left font-normal text-muted" colSpan={2}>Tax</th><td className="text-right">{money(d.taxCents, d.currency)}</td></tr>
              <tr><th scope="row" className="pt-1 text-left" colSpan={2}>Total</th><td className="pt-1 text-right text-lg font-bold">{money(d.totalCents, d.currency)}</td></tr>
            </tfoot>
          </table>
          <div className="flex flex-wrap gap-2">
            {d.eventId && <ButtonLink size="sm" variant="outline" href={`/admin/events/${d.eventId}`}>Open event</ButtonLink>}
            {d.stripeDashboardUrl && <ButtonLink size="sm" variant="ghost" href={d.stripeDashboardUrl} target="_blank"><IconExternal size={16} />Payment record</ButtonLink>}
            {canRefund && <Button size="sm" variant="danger" onClick={() => setRefund(true)}>Refund</Button>}
          </div>
          {orderSource(d) === "checkout" && d.status === "paid" && <p className="text-caption text-muted">Checkout orders are refunded through the payment provider, not here.</p>}
        </div>
      )}
      {d && <RefundDialog order={d} open={refund} onClose={() => setRefund(false)} onDone={() => { setRefund(false); o.reload(true); onChanged?.(); }} />}
    </Dialog>
  );
}

/** Refund a manual order: POST /api/admin/orders/:id/refund {reason} (admin only; checkout or already-refunded orders → 409). */
function RefundDialog({ order, open, onClose, onDone }: { order: Order; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    if (!reason.trim()) { setErr("Add a reason. It's kept in the audit log."); return; }
    setBusy(true); setErr(null);
    try {
      await api(`/api/admin/orders/${order.id}/refund`, { body: { reason: reason.trim() } });
      toast(`Order ${order.number} refunded`);
      setReason("");
      onDone();
    } catch (x) {
      setErr(x instanceof ApiError && x.status === 403 ? "Only admins can refund orders." : x instanceof ApiError && x.status === 409 ? "This order can't be refunded here: it's a checkout order or it's already refunded." : x instanceof ApiError && x.status === 404 ? "Refunds aren't available on this server yet." : msg(x, "Couldn't refund the order"));
    } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title={`Refund order ${order.number}?`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={submit}>Refund {money(order.totalCents, order.currency)}</Button></>}>
      <p className="text-sm">This marks the manual order as refunded and removes its add-ons from the event. Return the money to the customer the same way they paid (for example, an e-Transfer). The invitation stays as it is.</p>
      <Field label="Reason" required error={err && !reason.trim() ? err : undefined} className="mt-4">{(p) => <textarea {...p} className={textareaCls} maxLength={500} value={reason} onChange={(x) => setReason(x.target.value)} placeholder="e.g. Customer cancelled within 14 days" />}</Field>
      {err && reason.trim() && <p role="alert" className="mt-2 text-sm font-medium text-danger">{err}</p>}
    </Dialog>
  );
}
