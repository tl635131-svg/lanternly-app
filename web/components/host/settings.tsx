"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useEvent } from "@/lib/event-context";
import { useAsync } from "@/lib/hooks";
import type { Me, Member, RsvpSettings } from "@/lib/types";
import { useSession } from "@/lib/session";
import { formatDate, humanize } from "@/lib/format";
import { Badge, Button, Card, Dialog, ErrorState, Field, LoadingBlock, Notice, PageHeader, Toggle, cx, inputCls, selectCls } from "@/components/ui/primitives";
import { IconDownload, IconPlus, IconTrash } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { passwordIssue } from "@/components/auth/token";

export function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" subtitle="Reply form, notifications, people and your data." />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <RsvpSettingsCard />
        </div>
        <div className="flex flex-col gap-5">
          <NotificationsCard />
          <MembersCard />
          <AccountCard />
          <PasswordCard />
          <DataCard />
        </div>
      </div>
    </div>
  );
}

function RsvpSettingsCard() {
  const { event, canWrite } = useEvent();
  const toast = useToast();
  const s = useAsync(() => api<RsvpSettings>(`/api/events/${event!.id}/rsvp-settings`), [event?.id]);
  const [f, setF] = useState<RsvpSettings | null>(null);
  const [meal, setMeal] = useState("");
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  useEffect(() => { if (s.data) setF(s.data); }, [s.data]);
  if (s.loading && !f) return <Card><LoadingBlock rows={4} /></Card>;
  if (s.error) return <ErrorState error={s.error} onRetry={() => s.reload()} />;
  if (!f) return null;
  function validate(v: RsvpSettings) {
    const e: Record<string, string> = {};
    v.customQuestions.forEach((q, i) => { if (!q.label.trim()) e[`customQuestions.${i}.label`] = "Write the question, or remove it."; else if (q.label.length > 200) e[`customQuestions.${i}.label`] = "Keep it under 200 characters."; });
    if (v.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(v.deadline)) e.deadline = "Use a valid date.";
    return e;
  }
  async function save() {
    const v = validate(f!);
    if (Object.keys(v).length) { setErr(v); toast("Check the highlighted fields", "error"); return; }
    setBusy(true); setErr({});
    try {
      const res = await api<RsvpSettings>(`/api/events/${event!.id}/rsvp-settings`, { method: "PATCH", body: f });
      setF(res); toast("Reply form saved");
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErr(e.fields);
      toast(e instanceof Error ? e.message : "Couldn't save", "error");
    } finally { setBusy(false); }
  }
  const slug = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  return (
    <Card>
      <h2 className="font-semibold">Reply form</h2>
      <p className="text-sm text-muted">What guests are asked when they reply.</p>
      <fieldset disabled={!canWrite} className="mt-4 flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Replies are" error={err.mode}>{(p) => (
            <select {...p} className={selectCls} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as RsvpSettings["mode"] })}>
              <option value="auto">Open until the deadline</option><option value="open">Always open</option><option value="closed">Closed</option>
            </select>
          )}</Field>
          <Field label="Reply deadline" optional error={err.deadline}>{(p) => <input {...p} type="date" className={inputCls} value={f.deadline ?? ""} onChange={(e) => setF({ ...f, deadline: e.target.value || null })} />}</Field>
          <Field label="Max companions per reply" error={err.maxCompanions} hint="Personal links use each household's own seat count.">{(p) => <input {...p} type="number" min={0} max={19} className={inputCls} value={f.maxCompanions} onChange={(e) => setF({ ...f, maxCompanions: Math.max(0, Math.min(19, parseInt(e.target.value, 10) || 0)) })} />}</Field>
        </div>
        <Toggle checked={f.requireEmail} onChange={(v) => setF({ ...f, requireEmail: v })} label="Ask for an email when someone says yes" description="Guests get a confirmation with a link to change their reply." />
        <Toggle checked={f.allowChildren} onChange={(v) => setF({ ...f, allowChildren: v })} label="Children are welcome" />
        <Toggle checked={f.allergyChecklist} onChange={(v) => setF({ ...f, allergyChecklist: v })} label="Show a dietary checklist" />

        <ChipList label="Meal choices" hint="Leave empty if you're not asking about meals." items={f.mealOptions} onRemove={(m) => setF({ ...f, mealOptions: f.mealOptions.filter((x) => x !== m) })}
          input={meal} setInput={setMeal} onAdd={() => { const v = meal.trim(); if (v && v.length <= 40 && !f.mealOptions.includes(v) && f.mealOptions.length < 10) setF({ ...f, mealOptions: [...f.mealOptions, v] }); setMeal(""); }} placeholder="e.g. vegetarian" />
        <ChipList label="Other events to ask about" hint="e.g. welcome drinks, farewell brunch" items={f.extraEvents} format={humanize} onRemove={(m) => setF({ ...f, extraEvents: f.extraEvents.filter((x) => x !== m) })}
          input={extra} setInput={setExtra} onAdd={() => { const v = slug(extra); if (v && !f.extraEvents.includes(v)) setF({ ...f, extraEvents: [...f.extraEvents, v] }); setExtra(""); }} placeholder="Welcome drinks" />

        <fieldset>
          <legend className="text-sm font-semibold">Your own questions</legend>
          <ul className="mt-2 space-y-2">
            {f.customQuestions.map((q, i) => (
              <li key={q.id} className="grid items-end gap-2 rounded-md bg-surface-2 p-3 sm:grid-cols-[1fr_130px_auto]">
                <div className="sm:col-span-3 -mb-1 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--brand-primary)]" checked={!!q.required} onChange={(e) => setF({ ...f, customQuestions: f.customQuestions.map((x) => (x.id === q.id ? { ...x, required: e.target.checked } : x)) })} />Guests who say yes must answer</label>
                </div>
                <Field label={`Question ${i + 1}`} error={err[`customQuestions.${i}.label`]}>{(p) => <input {...p} className={inputCls} value={q.label} onChange={(e) => setF({ ...f, customQuestions: f.customQuestions.map((x) => (x.id === q.id ? { ...x, label: e.target.value } : x)) })} />}</Field>
                <Field label="Answer type">{(p) => <select {...p} className={selectCls} value={q.type} onChange={(e) => setF({ ...f, customQuestions: f.customQuestions.map((x) => (x.id === q.id ? { ...x, type: e.target.value as "text" | "yes_no" } : x)) })}><option value="text">Short text</option><option value="yes_no">Yes / no</option></select>}</Field>
                <Button variant="ghost" aria-label={`Remove question ${i + 1}`} onClick={() => setF({ ...f, customQuestions: f.customQuestions.filter((x) => x.id !== q.id) })}><IconTrash size={16} /></Button>
              </li>
            ))}
          </ul>
          {f.customQuestions.length < 10 && <Button variant="outline" size="sm" className="mt-2" onClick={() => setF({ ...f, customQuestions: [...f.customQuestions, { id: `q${Date.now().toString(36)}`, label: "", type: "text" }] })}><IconPlus size={16} />Add a question</Button>}
        </fieldset>
        <div><Button onClick={save} loading={busy}>Save reply form</Button></div>
      </fieldset>
    </Card>
  );
}

function ChipList({ label, hint, items, onRemove, input, setInput, onAdd, placeholder, format = (x: string) => x }: { label: string; hint?: string; items: string[]; onRemove: (v: string) => void; input: string; setInput: (v: string) => void; onAdd: () => void; placeholder: string; format?: (s: string) => string }) {
  const id = label.replace(/\W+/g, "-").toLowerCase();
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {items.map((m) => <li key={m} className="flex items-center gap-1 rounded-sm bg-tint py-1 pl-2.5 pr-1 text-sm">{format(m)}<button type="button" className="grid size-6 place-items-center rounded hover:bg-surface" aria-label={`Remove ${format(m)}`} onClick={() => onRemove(m)}><IconTrash size={12} /></button></li>)}
      </ul>
      <div className="mt-2 flex gap-2">
        <input id={id} className={inputCls} placeholder={placeholder} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }} />
        <Button type="button" variant="outline" onClick={onAdd} disabled={!input.trim()}>Add</Button>
      </div>
    </div>
  );
}

function NotificationsCard() {
  const { event, reload, canWrite } = useEvent();
  const toast = useToast();
  const [f, setF] = useState({ notifyOnRsvp: event!.notifyOnRsvp, remindersEnabled: event!.remindersEnabled, reminderDaysBefore: event!.reminderDaysBefore });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api(`/api/events/${event!.id}`, { method: "PATCH", body: f }); toast("Notifications saved"); reload(); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "error"); } finally { setBusy(false); }
  }
  return (
    <Card>
      <h2 className="font-semibold">Notifications &amp; reminders</h2>
      <fieldset disabled={!canWrite} className="mt-4 flex flex-col gap-4">
        <Toggle checked={f.notifyOnRsvp} onChange={(v) => setF({ ...f, notifyOnRsvp: v })} label="Email me when someone replies" />
        <Toggle checked={f.remindersEnabled} onChange={(v) => setF({ ...f, remindersEnabled: v })} label="Remind guests who haven't replied" description="One gentle email before your reply deadline." />
        {f.remindersEnabled && <Field label="Days before the deadline" className="max-w-56">{(p) => <input {...p} type="number" min={1} max={60} className={inputCls} value={f.reminderDaysBefore} onChange={(e) => setF({ ...f, reminderDaysBefore: parseInt(e.target.value, 10) || 7 })} />}</Field>}
        <div><Button variant="outline" onClick={save} loading={busy}>Save</Button></div>
      </fieldset>
    </Card>
  );
}

function MembersCard() {
  const { event, isOwner } = useEvent();
  const toast = useToast();
  const m = useAsync(() => api<{ items: Member[]; pendingInvites: { email: string; role: string; expiresAt: string }[] }>(`/api/events/${event!.id}/members`), [event?.id]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"cohost" | "viewer">("cohost");
  const [busy, setBusy] = useState(false);
  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) { toast("Enter a valid email", "error"); return; }
    setBusy(true);
    try { await api(`/api/events/${event!.id}/members`, { body: { email, role } }); toast(`Invitation link sent to ${email}`); setEmail(""); m.reload(true); } catch (err) { toast(err instanceof Error ? err.message : "Failed", "error"); } finally { setBusy(false); }
  }
  async function changeRole(userId: string, r: string) {
    try { await api(`/api/events/${event!.id}/members/${userId}`, { method: "PATCH", body: { role: r } }); m.reload(true); toast("Role updated"); } catch (err) { toast(err instanceof Error ? err.message : "Failed", "error"); }
  }
  async function remove(userId: string) {
    try { await api(`/api/events/${event!.id}/members/${userId}`, { method: "DELETE" }); m.reload(true); toast("Removed"); } catch (err) { toast(err instanceof Error ? err.message : "Failed", "error"); }
  }
  return (
    <Card>
      <h2 className="font-semibold">People who can manage this</h2>
      <p className="text-sm text-muted">Co-hosts can edit everything except this list. Viewers can only look.</p>
      {m.loading && !m.data ? <LoadingBlock rows={2} /> : m.error ? <ErrorState error={m.error} /> : (
        <ul className="mt-3 divide-y divide-line">
          {m.data!.items.map((x) => (
            <li key={x.userId} className="flex flex-wrap items-center gap-2 py-2.5">
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{x.user.name ?? x.user.email}</span><span className="block truncate text-xs text-muted">{x.user.email}</span></span>
              {x.role === "owner" || !isOwner ? <Badge>{humanize(x.role)}</Badge> : (
                <>
                  <label htmlFor={`role-${x.userId}`} className="sr-only">Role for {x.user.email}</label>
                  <select id={`role-${x.userId}`} className={cx(selectCls, "h-9 w-32 text-sm")} value={x.role} onChange={(e) => changeRole(x.userId, e.target.value)}><option value="cohost">Co-host</option><option value="viewer">Viewer</option></select>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${x.user.email}`} onClick={() => remove(x.userId)}><IconTrash size={16} /></Button>
                </>
              )}
            </li>
          ))}
          {m.data!.pendingInvites.map((p) => <li key={p.email} className="flex items-center gap-2 py-2.5 text-sm"><span className="flex-1 truncate">{p.email}</span><Badge tone="warning">Invited · {humanize(p.role)}</Badge></li>)}
        </ul>
      )}
      {isOwner && (
        <form onSubmit={invite} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <label htmlFor="mem-email" className="sr-only">Email to invite</label>
          <input id="mem-email" type="email" className={inputCls} placeholder="partner@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="mem-role" className="sr-only">Role</label>
          <select id="mem-role" className={cx(selectCls, "sm:w-36")} value={role} onChange={(e) => setRole(e.target.value as "cohost" | "viewer")}><option value="cohost">Co-host</option><option value="viewer">Viewer</option></select>
          <Button type="submit" loading={busy}>Invite</Button>
        </form>
      )}
    </Card>
  );
}

function AccountCard() {
  const { me, setMe } = useSession();
  const toast = useToast();
  const [name, setName] = useState(me?.user.name ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Enter your name."); return; }
    setErr(null); setBusy(true);
    try { const m = await api<Me>("/api/auth/me", { method: "PATCH", body: { name: name.trim() } }); setMe(m); toast("Name updated"); }
    catch (e2) { toast(e2 instanceof Error ? e2.message : "Couldn't save", "error"); } finally { setBusy(false); }
  }
  return (
    <Card>
      <h2 className="font-semibold">Your account</h2>
      <p className="text-sm text-muted">Signed in as {me.user.email}</p>
      <form onSubmit={save} noValidate className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Your name" error={err ?? undefined} className="flex-1">{(p) => <input {...p} autoComplete="name" maxLength={100} className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Button type="submit" variant="outline" loading={busy} disabled={name.trim() === (me.user.name ?? "")}>Save</Button>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const toast = useToast();
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const issue = passwordIssue(nw);
    const er: Record<string, string> = {};
    if (!cur) er.cur = "Enter your current password.";
    if (issue) er.nw = issue;
    setErr(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    try { await api("/api/auth/password/change", { body: { currentPassword: cur, newPassword: nw } }); toast("Password changed. Other devices were signed out."); setCur(""); setNw(""); }
    catch (e2) { if (e2 instanceof ApiError && e2.code === "INVALID_CREDENTIALS") setErr({ cur: "That's not your current password." }); else toast(e2 instanceof Error ? e2.message : "Failed", "error"); }
    finally { setBusy(false); }
  }
  return (
    <Card>
      <h2 className="font-semibold">Your password</h2>
      <form onSubmit={submit} noValidate className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Current password" error={err.cur}>{(p) => <input {...p} type="password" autoComplete="current-password" className={inputCls} value={cur} onChange={(e) => setCur(e.target.value)} />}</Field>
        <Field label="New password" error={err.nw} hint="10+ characters, letters and a number or symbol">{(p) => <input {...p} type="password" autoComplete="new-password" className={inputCls} value={nw} onChange={(e) => setNw(e.target.value)} />}</Field>
        <div><Button type="submit" variant="outline" loading={busy}>Change password</Button></div>
      </form>
    </Card>
  );
}

function DataCard() {
  const { event, isOwner } = useEvent();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  async function requestDelete() {
    try { await api(`/api/events/${event!.id}/delete-request`, { method: "POST" }); toast("Request sent. Our team will be in touch."); setConfirm(false); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "error"); }
  }
  if (!isOwner) return null;
  return (
    <Card>
      <h2 className="font-semibold">Your data</h2>
      <p className="text-sm text-muted">Your invitation stays live until {event!.archiveAfter ? formatDate(event!.archiveAfter) : "60 days after your date"}, then becomes read-only.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href={`/api/events/${event!.id}/export-all`} download className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-semibold hover:bg-surface-2"><IconDownload size={16} />Download everything (JSON)</a>
        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setConfirm(true)}>Ask us to delete this event</Button>
      </div>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Delete this event?" footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" onClick={requestDelete}>Send request</Button></>}>
        <p className="text-sm">We&apos;ll confirm with you before removing your invitation, guest list and replies. Download a copy first if you&apos;d like to keep them.</p>
        <Notice tone="warning" className="mt-3">This sends a request to our team. Nothing is deleted right away.</Notice>
      </Dialog>
    </Card>
  );
}
