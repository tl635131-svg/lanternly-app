"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, downloadPost } from "@/lib/api";
import { useEvent } from "@/lib/event-context";
import { useAsync, useInterval } from "@/lib/hooks";
import type { Attendance, Companion, Guest, GuestList, RsvpSettings, Stats } from "@/lib/types";
import { formatDate, humanize, initials, pct, relTime, uuid } from "@/lib/format";
import { Button, Dialog, EmptyState, ErrorState, Field, LoadingBlock, PageHeader, Segmented, StatusChip, Toggle, cx, inputCls, selectCls, textareaCls, toneForAttendance, REPLY_LABEL } from "@/components/ui/primitives";
import { IconAlert, IconChevronDown, IconDownload, IconEdit, IconInbox, IconPlus, IconRestore, IconSearch, IconTrash, IconUtensils } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { DIETARY_LABEL } from "@/components/invite/rsvp";
import { replySummary, useReplyCounts, type ReplyCounts } from "@/lib/reply-counts";

const ATT: Record<Attendance, { label: string }> = { yes: { label: REPLY_LABEL.attending }, no: { label: REPLY_LABEL.declined }, pending: { label: REPLY_LABEL.pending } };
type Filter = "all" | "yes" | "no" | "pending";

export function RepliesPage() {
  const { event, subscribe, live, canWrite } = useEvent();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const list = useAsync(() => api<GuestList>(`/api/events/${event!.id}/guests`, { query: { status: filter, q: dq, trash: false, limit: 200 } }), [filter, dq, event?.id]);
  const trash = useAsync(() => api<GuestList>(`/api/events/${event!.id}/guests`, { query: { trash: true, limit: 200 } }), [event?.id]);
  const settings = useAsync(() => api<RsvpSettings>(`/api/events/${event!.id}/rsvp-settings`), [event?.id]);
  const stats = useAsync(() => api<Stats>(`/api/events/${event!.id}/stats`), [event?.id]);
  const all = useAsync(() => api<GuestList>(`/api/events/${event!.id}/guests`, { query: { status: "all", trash: false, limit: 200 } }), [event?.id]);
  // N-37: one Waiting number for the summary tile and the filter tab (sent households with no reply + pending rows).
  const rc = useReplyCounts(event?.id, event?.invitesSentManual ?? 0, [all.data]);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Guest | null>(null);
  const [editing, setEditing] = useState<Guest | "new" | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState<Guest | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const listRef = useRef(list);
  useEffect(() => {
    listRef.current = list;
  });

  // Live updates over SSE, with a polling fallback when the stream drops.
  useEffect(() => subscribe((m) => {
    if (!m.type.startsWith("guest.")) return;
    const g = (m.data as { guest?: Guest })?.guest;
    if (g) setFlash((s) => new Set(s).add(g.id));
    listRef.current.reload(true);
    trash.reload(true);
    stats.reload(true);
    all.reload(true);
    setUpdatedAt(new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [subscribe]);
  useInterval(() => { list.reload(true); setUpdatedAt(new Date()); }, live ? null : 30000);
  useEffect(() => { if (list.data) setUpdatedAt((d) => d ?? new Date()); }, [list.data]);

  async function remove(g: Guest) {
    try {
      await api(`/api/events/${event!.id}/guests/${g.id}`, { method: "DELETE" });
      toast(`${g.fullName} moved to trash`);
      setDetail(null);
      list.reload(true); trash.reload(true);
    } catch (e) { toast(e instanceof Error ? e.message : "Failed", "error"); }
  }
  async function restore(g: Guest) {
    try { await api(`/api/events/${event!.id}/guests/${g.id}/restore`, { method: "POST" }); toast(`${g.fullName} restored`); list.reload(true); trash.reload(true); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "error"); }
  }
  async function purge(g: Guest) {
    try { await api(`/api/events/${event!.id}/guests/${g.id}`, { method: "DELETE", query: { permanent: true } }); toast("Deleted for good"); setConfirmPurge(null); trash.reload(true); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "error"); }
  }

  const counts = list.data?.counts;
  return (
    <div>
      <PageHeader
        title="Replies"
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><span className={cx("size-2 rounded-full", live ? "bg-success" : "bg-border-strong")} />{live ? "Live" : "Reconnecting"}{updatedAt && <> · updated {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</>}{settings.data?.deadline && <> · reply by {formatDate(settings.data.deadline, { weekday: "short", day: "numeric", month: "short" })}</>}</span>}
        actions={<>
          <Button variant="outline" onClick={() => setExportOpen(true)}><IconDownload size={18} />Export</Button>
          {canWrite && <Button onClick={() => setEditing("new")}><IconPlus size={18} />Add a reply</Button>}
        </>}
      />
      <SummaryTiles stats={stats.data} guests={all.data?.items} settings={settings.data} counts={rc.data} />
      <div className="mb-4 mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented label="Filter replies" value={filter} onChange={setFilter} options={[
          { value: "all", label: "All", count: counts?.all }, { value: "yes", label: REPLY_LABEL.attending, count: counts?.yes },
          { value: "no", label: REPLY_LABEL.declined, count: counts?.no }, { value: "pending", label: REPLY_LABEL.pending, count: replySummary(stats.data, rc.data)?.waiting ?? counts?.pending },
        ]} />
        <div className="relative lg:w-80">
          <IconSearch size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <label htmlFor="g-q" className="sr-only">Search replies</label>
          <input id="g-q" type="search" placeholder="Search names or emails" className={inputCls + " pl-10"} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {filter === "pending" && !dq && (rc.data?.waitingHouseholds.length ?? 0) > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 text-sm font-semibold">Invited, no reply yet <span className="font-normal text-muted">({rc.data!.waitingHouseholds.length} {rc.data!.waitingHouseholds.length === 1 ? "household" : "households"})</span></h2>
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
            {rc.data!.waitingHouseholds.map((i) => {
              const name = i.householdName || [i.firstName, i.lastName].filter(Boolean).join(" ");
              return (
                <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                  <span aria-hidden className="avatar">{initials(name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{name}</span>
                    <span className="block truncate text-caption text-muted">{i.sentAt ? `Sent ${formatDate(i.sentAt, { dateStyle: "medium" })}` : "Link not sent yet"} · {i.openCount > 0 ? `opened ${i.openCount === 1 ? "once" : `${i.openCount} times`}` : "not opened yet"}</span>
                  </span>
                  <StatusChip tone={toneForAttendance("pending")} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {list.loading && !list.data ? <LoadingBlock rows={6} /> : list.error ? <ErrorState error={list.error} onRetry={() => list.reload()} /> : list.data!.items.length === 0 ? (
        filter === "pending" && !dq && (rc.data?.waitingHouseholds.length ?? 0) > 0 ? null :
        dq || filter !== "all" ? <EmptyState title="Nothing here" body="No replies match this filter yet." /> :
          <EmptyState icon={<IconInbox />} title="No replies yet" body="Share your invitation. Replies appear here in real time, and you can add phone replies by hand." />
      ) : (
        <>
        {filter === "pending" && !dq && <h2 className="mb-2 text-sm font-semibold">Reply forms marked waiting <span className="font-normal text-muted">(not counted in Waiting unless they belong to a household above)</span></h2>}
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card" aria-live="polite">
          {list.data!.items.map((g) => (
            <li key={g.id} className={cx(flash.has(g.id) && "flash")} onAnimationEnd={() => setFlash((s) => { const n = new Set(s); n.delete(g.id); return n; })}>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60" onClick={() => setDetail(g)}>
                <span aria-hidden className="avatar">{initials(g.fullName)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{g.fullName}</span>
                  <span className="block truncate text-caption text-muted">
                    {g.attendance === "yes" ? (g.partySize > 1 ? `Party of ${g.partySize}` : "Just them") : g.attendance === "no" ? "Sends regrets" : "No answer yet"}
                    {g.primaryMeal ? ` · ${humanize(g.primaryMeal)}` : ""}
                    {g.dietaryTags.length ? ` · ${g.dietaryTags.map((d) => DIETARY_LABEL[d] ?? d).join(", ")}` : ""}
                    {g.companions.some((c) => c.type === "child") ? ` · ${g.companions.filter((c) => c.type === "child").length} child` : ""}
                  </span>
                </span>
                <span className="hidden text-right text-caption text-muted sm:block">{g.source === "manual" ? "Added by host" : "Online"}<br />{g.submittedAt ? relTime(g.submittedAt) : ""}</span>
                <StatusChip tone={toneForAttendance(g.attendance)} />
              </button>
            </li>
          ))}
        </ul>
        </>
      )}

      {(trash.data?.items.length ?? 0) > 0 && (
        <details className="group mt-6 rounded-card border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold marker:hidden">
            <span className="flex items-center gap-2"><IconTrash size={16} />Trash ({trash.data!.items.length})</span><IconChevronDown size={16} className="transition group-open:rotate-180" />
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {trash.data!.items.map((g) => (
              <li key={g.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="flex-1">{g.fullName} <span className="text-xs text-muted">· removed {g.deletedAt ? relTime(g.deletedAt) : ""}</span></span>
                {canWrite && <><Button size="sm" variant="ghost" onClick={() => restore(g)}><IconRestore size={16} />Restore</Button><Button size="sm" variant="ghost" className="text-danger" onClick={() => setConfirmPurge(g)}>Delete forever</Button></>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Dialog open={!!detail} onClose={() => setDetail(null)} title={detail?.fullName ?? ""}
        footer={canWrite && detail && <><Button variant="ghost" className="mr-auto text-danger" onClick={() => remove(detail)}><IconTrash size={16} />Move to trash</Button><Button variant="outline" onClick={() => { setEditing(detail); setDetail(null); }}><IconEdit size={16} />Edit</Button></>}>
        {detail && <GuestDetail g={detail} settings={settings.data} />}
      </Dialog>
      <GuestDialog open={!!editing} guest={editing === "new" ? null : editing} settings={settings.data} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(true); }} />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <Dialog open={!!confirmPurge} onClose={() => setConfirmPurge(null)} title="Delete for good?" footer={<><Button variant="ghost" onClick={() => setConfirmPurge(null)}>Cancel</Button><Button variant="danger" onClick={() => confirmPurge && purge(confirmPurge)}>Delete forever</Button></>}>
        <p className="text-sm">This permanently removes {confirmPurge?.fullName}&apos;s reply. It can&apos;t be undone.</p>
      </Dialog>
    </div>
  );
}

/** B10: response-rate tile (night) + Coming / Can't come / Waiting tiles, dinner choices and a needs-attention card. */
function SummaryTiles({ stats, guests, settings, counts }: { stats?: Stats; guests?: Guest[]; settings?: RsvpSettings; counts?: ReplyCounts }) {
  if (!stats) return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[104px]" />)}</div>;
  const coming = (guests ?? []).filter((g) => g.attendance === "yes");
  const people = coming.flatMap((g) => [{ meal: g.primaryMeal, tags: g.dietaryTags, diet: g.primaryDietary }, ...g.companions.map((c) => ({ meal: c.meal ?? null, tags: [] as string[], diet: c.dietary ?? null }))]);
  const mealCounts = new Map<string, number>();
  for (const m of settings?.mealOptions ?? []) mealCounts.set(m, 0);
  for (const p of people) if (p.meal) mealCounts.set(p.meal, (mealCounts.get(p.meal) ?? 0) + 1);
  const meals = [...mealCounts.entries()].sort((a, b) => b[1] - a[1]);
  const mealMax = Math.max(1, ...meals.map(([, n]) => n));
  const tagCounts = new Map<string, number>();
  for (const p of people) for (const t of p.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const notes = people.filter((p) => p.diet).length;
  const children = coming.reduce((n, g) => n + g.companions.filter((c) => c.type === "child").length, 0);
  // N-40: rate = replied / invited (guest list only); null without a guest list. General-link replies are listed apart.
  const sum = replySummary(stats, counts)!;
  const total = Math.max(1, stats.confirmed + stats.declined + stats.pending);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card-night stat col-span-2 lg:col-span-1">
          <div aria-hidden className="glow-bloom" style={{ width: 300, height: 300, right: -120, top: -150 }} />
          <div className="relative">
            <p className="k text-on-night-muted">Response rate</p>
            {sum.rate != null ? (
              <>
                <p className="v">{pct(sum.rate)}</p>
                <p className="d text-on-night-muted">{sum.replied} of {sum.invited} on your guest list replied</p>
              </>
            ) : (
              <>
                <p className="v">—</p>
                <p className="d text-on-night-muted">No guest list yet. Add households on Guests to track who replied.</p>
              </>
            )}
            {sum.generalLinkReplies != null && sum.generalLinkReplies > 0 && <p className="d text-on-night-muted">+{sum.generalLinkReplies} {sum.generalLinkReplies === 1 ? "reply" : "replies"} via the general link (not in the rate)</p>}
            <div className="bar mt-3 !bg-white/15" aria-hidden><span style={{ width: `${(stats.confirmed / total) * 100}%`, background: "#3DDC97" }} /><span style={{ width: `${(stats.declined / total) * 100}%`, background: "#FF8A95" }} /></div>
          </div>
        </div>
        {([["attending", stats.totalAttendees, `guests · ${stats.confirmed} replies`], ["declined", stats.declined, "replies"], ["pending", sum.waiting, sum.hasGuestList ? "on your guest list" : "no guest list yet"]] as const).map(([tone, v, d]) => (
          <div key={tone} className="card stat">
            <p className="k"><span className="size-2 rounded-full" style={{ background: `var(--brand-rsvp-${tone})` }} />{REPLY_LABEL[tone]}</p>
            <p className="v">{v}</p>
            <p className="d">{d}</p>
          </div>
        ))}
      </div>
      {guests && coming.length > 0 && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="card p-5">
            <h2 className="font-semibold">Dinner choices</h2>
            <p className="text-caption text-muted">{people.length} coming guests</p>
            {meals.length === 0 ? <p className="mt-3 text-body-sm text-muted">No meal options yet. Add them in Settings → Reply form.</p> : (
              <ul className="mt-3 space-y-3">
                {meals.map(([m, n]) => (
                  <li key={m}>
                    <div className="flex items-center justify-between text-body-sm"><span className="flex items-center gap-2"><IconUtensils size={16} className="text-muted" />{humanize(m)}</span><span className="tabular font-semibold">{n}</span></div>
                    <div className="bar mt-1.5" aria-hidden><span style={{ width: `${(n / mealMax) * 100}%`, background: "var(--brand-primary)" }} /></div>
                  </li>
                ))}
                {people.some((p) => !p.meal) && <li className="text-caption text-muted">{people.filter((p) => !p.meal).length} without a choice yet</li>}
              </ul>
            )}
          </div>
          <div className="card p-5">
            <h2 className="font-semibold">Needs attention</h2>
            <p className="text-caption text-muted">For your caterer and planner</p>
            <ul className="mt-3 divide-y divide-line text-body-sm">
              {[...tagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                <li key={t} className="flex items-center justify-between py-2"><span className="flex items-center gap-2"><IconAlert size={16} className="text-warning" />{DIETARY_LABEL[t] ?? humanize(t)}</span><span className="tabular font-semibold">{n} guest{n === 1 ? "" : "s"}</span></li>
              ))}
              {notes > 0 && <li className="flex items-center justify-between py-2"><span>Allergy notes to read</span><span className="tabular font-semibold">{notes}</span></li>}
              {children > 0 && <li className="flex items-center justify-between py-2"><span>Children</span><span className="tabular font-semibold">{children}</span></li>}
              {tagCounts.size === 0 && notes === 0 && children === 0 && <li className="py-2 text-muted">Nothing flagged yet.</li>}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

function GuestDetail({ g, settings }: { g: Guest; settings?: RsvpSettings }) {
  const rows: [string, string | null | undefined][] = [
    ["Status", ATT[g.attendance].label], ["Email", g.email], ["Phone", g.phone], ["Party size", String(g.partySize)],
    ["Meal", g.primaryMeal && humanize(g.primaryMeal)], ["Dietary", [...g.dietaryTags.map((d) => DIETARY_LABEL[d] ?? d), g.primaryDietary].filter(Boolean).join(", ") || null],
    ["Household", g.invitee?.householdName ?? null], ["Replied", g.submittedAt ? formatDate(g.submittedAt, { dateStyle: "medium", timeStyle: "short" }) : null],
    ["Source", g.source === "manual" ? "Added by a host" : "Reply form"],
  ];
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">{rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="col-span-2 font-medium">{v}</dd></div>)}</dl>
      {g.companions.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Coming with</h3>
          <ul className="mt-2 space-y-2">{g.companions.map((c, i) => <li key={c.id ?? i} className="rounded-md bg-surface-2 px-3 py-2 text-sm"><span className="font-medium">{c.fullName}</span> <span className="text-muted">· {c.type === "child" ? "child" : "adult"}{c.meal ? ` · ${humanize(c.meal)}` : ""}{c.dietary ? ` · ${c.dietary}` : ""}</span></li>)}</ul>
        </div>
      )}
      {Object.keys(g.extraEvents ?? {}).length > 0 && <p className="text-sm"><span className="text-muted">Other events: </span>{Object.entries(g.extraEvents).map(([k, v]) => `${humanize(k)}: ${v}`).join(" · ")}</p>}
      {Object.keys(g.answers ?? {}).length > 0 && (
        <div className="text-sm">{Object.entries(g.answers).map(([k, v]) => <p key={k}><span className="text-muted">{settings?.customQuestions.find((q) => q.id === k)?.label ?? humanize(k)}: </span>{typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}</p>)}</div>
      )}
      {g.message && <blockquote className="rounded-md border-l-4 border-accent bg-surface-2 px-4 py-3 text-sm">“{g.message}”</blockquote>}
      {g.notes && <p className="text-sm"><span className="text-muted">Your notes: </span>{g.notes}</p>}
    </div>
  );
}

function GuestDialog({ open, guest, settings, onClose, onSaved }: { open: boolean; guest: Guest | null; settings?: RsvpSettings; onClose: () => void; onSaved: () => void }) {
  const { event } = useEvent();
  const toast = useToast();
  type F = { fullName: string; email: string; phone: string; attendance: Attendance; primaryMeal: string; primaryDietary: string; companions: (Companion & { key: string })[]; message: string; notes: string };
  const blank: F = { fullName: "", email: "", phone: "", attendance: "yes", primaryMeal: "", primaryDietary: "", companions: [], message: "", notes: "" };
  const [f, setF] = useState<F>(blank);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const meals = settings?.mealOptions ?? [];
  useEffect(() => {
    if (!open) return;
    setErr({});
    setF(guest ? { fullName: guest.fullName, email: guest.email ?? "", phone: guest.phone ?? "", attendance: guest.attendance, primaryMeal: guest.primaryMeal ?? "", primaryDietary: guest.primaryDietary ?? "", companions: guest.companions.map((c) => ({ ...c, key: c.id ?? uuid() })), message: guest.message ?? "", notes: guest.notes ?? "" } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, guest]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (!f.fullName.trim()) er.fullName = "Enter a name.";
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) er.email = "That email doesn't look right.";
    f.companions.forEach((c, i) => { if (!c.fullName.trim()) er[`companions.${i}.fullName`] = "Add a name."; });
    setErr(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    const body = {
      fullName: f.fullName.trim(), email: f.email.trim() || null, phone: f.phone.trim() || null, attendance: f.attendance,
      primaryMeal: f.primaryMeal || null, primaryDietary: f.primaryDietary.trim() || null,
      companions: f.attendance === "yes" ? f.companions.map((c) => ({ type: c.type ?? "adult", fullName: c.fullName.trim(), meal: c.meal || null, dietary: c.dietary || null })) : [],
      message: f.message.trim() || null, notes: f.notes.trim() || null,
    };
    try {
      if (guest) await api(`/api/events/${event!.id}/guests/${guest.id}`, { method: "PATCH", body });
      else await api(`/api/events/${event!.id}/guests`, { body });
      toast(guest ? "Reply updated" : "Reply added");
      onSaved();
    } catch (e2) {
      if (e2 instanceof ApiError && e2.fields) setErr(e2.fields);
      toast(e2 instanceof Error ? e2.message : "Couldn't save", "error");
    } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title={guest ? `Edit ${guest.fullName}` : "Add a reply"} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="guest-form" loading={busy}>Save</Button></>}>
      <form id="guest-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required error={err.fullName}>{(p) => <input {...p} className={inputCls} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />}</Field>
        <Field label="Attendance">{(p) => <select {...p} className={selectCls} value={f.attendance} onChange={(e) => setF({ ...f, attendance: e.target.value as Attendance })}><option value="yes">Coming</option><option value="no">Can&apos;t come</option><option value="pending">Waiting</option></select>}</Field>
        <Field label="Email" optional error={err.email}>{(p) => <input {...p} type="email" className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="Phone" optional>{(p) => <input {...p} type="tel" className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
        {f.attendance === "yes" && (
          <>
            {meals.length > 0 && <Field label="Meal" optional error={err.primaryMeal}>{(p) => <select {...p} className={selectCls} value={f.primaryMeal} onChange={(e) => setF({ ...f, primaryMeal: e.target.value })}><option value="">Not chosen</option>{meals.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}</select>}</Field>}
            <Field label="Allergies / dietary" optional>{(p) => <input {...p} className={inputCls} value={f.primaryDietary} onChange={(e) => setF({ ...f, primaryDietary: e.target.value })} />}</Field>
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm font-semibold">Companions</legend>
              <div className="space-y-2">
                {f.companions.map((c, i) => (
                  <div key={c.key} className="grid items-end gap-2 rounded-md bg-surface-2 p-3 sm:grid-cols-[1fr_110px_140px_auto]">
                    <Field label="Name" error={err[`companions.${i}.fullName`]}>{(p) => <input {...p} className={inputCls} value={c.fullName} onChange={(e) => setF({ ...f, companions: f.companions.map((x) => (x.key === c.key ? { ...x, fullName: e.target.value } : x)) })} />}</Field>
                    <Field label="Age">{(p) => <select {...p} className={selectCls} value={c.type ?? "adult"} onChange={(e) => setF({ ...f, companions: f.companions.map((x) => (x.key === c.key ? { ...x, type: e.target.value as "adult" | "child" } : x)) })}><option value="adult">Adult</option><option value="child">Child</option></select>}</Field>
                    {meals.length > 0 ? <Field label="Meal" error={err[`companions.${i}.meal`]}>{(p) => <select {...p} className={selectCls} value={c.meal ?? ""} onChange={(e) => setF({ ...f, companions: f.companions.map((x) => (x.key === c.key ? { ...x, meal: e.target.value } : x)) })}><option value="">—</option>{meals.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}</select>}</Field> : <span />}
                    <Button type="button" variant="ghost" aria-label={`Remove ${c.fullName || "companion"}`} onClick={() => setF({ ...f, companions: f.companions.filter((x) => x.key !== c.key) })}><IconTrash size={16} /></Button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setF({ ...f, companions: [...f.companions, { key: uuid(), type: "adult", fullName: "", meal: "" }] })}><IconPlus size={16} />Add companion</Button>
            </fieldset>
          </>
        )}
        <Field label="Message from guest" optional className="sm:col-span-2">{(p) => <textarea {...p} rows={2} className={textareaCls + " min-h-16"} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />}</Field>
        <Field label="Private notes" optional className="sm:col-span-2">{(p) => <input {...p} className={inputCls} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
      </form>
    </Dialog>
  );
}

const ALL_COLS = ["fullName", "email", "phone", "attendance", "partySize", "primaryMeal", "primaryDietary", "dietaryTags", "companionsCount", "extraEvents", "answers", "message", "notes", "source", "submittedAt"];
const DEFAULT_COLS = ["fullName", "email", "attendance", "partySize", "primaryMeal", "primaryDietary", "companionsCount", "message", "submittedAt"];
function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { event } = useEvent();
  const toast = useToast();
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [status, setStatus] = useState<Filter>("all");
  const [header, setHeader] = useState(true);
  const [cols, setCols] = useState<string[]>(DEFAULT_COLS);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await downloadPost(`/api/events/${event!.id}/guests/export`, { format, status, includeHeader: header, columns: ALL_COLS.filter((c) => cols.includes(c)) }, `guests.${format}`);
      toast("Your file is downloading");
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : "Export failed", "error"); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Export replies" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={go} loading={busy} disabled={!cols.length}><IconDownload size={16} />Download</Button></>}>
      <div className="space-y-4">
        <Segmented label="File format" value={format} onChange={setFormat} options={[{ value: "xlsx", label: "Excel (.xlsx)" }, { value: "csv", label: "CSV" }]} />
        <Field label="Which replies">{(p) => <select {...p} className={selectCls} value={status} onChange={(e) => setStatus(e.target.value as Filter)}><option value="all">Everyone</option><option value="yes">Coming</option><option value="no">Can&apos;t come</option><option value="pending">Waiting</option></select>}</Field>
        <Toggle checked={header} onChange={setHeader} label="Include a header row" />
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Columns</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {ALL_COLS.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--brand-primary)]" checked={cols.includes(c)} onChange={() => setCols(cols.includes(c) ? cols.filter((x) => x !== c) : [...cols, c])} />{humanize(c.replace(/([A-Z])/g, " $1"))}</label>
            ))}
          </div>
        </fieldset>
        <p className="text-xs text-muted">{format === "xlsx" ? "Excel files include a second sheet listing every companion with their meal and allergies." : "CSV lists main guests only. Choose Excel to get companions too."}</p>
      </div>
    </Dialog>
  );
}
