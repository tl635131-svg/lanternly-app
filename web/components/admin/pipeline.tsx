"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { adminExtras, ADMIN_STAGES, stageLabel, usePaged, type AdminEvent, type Metrics , type Order } from "@/lib/admin";
import { isOfferedExtra, type Catalogue, type Stage } from "@/lib/types";
import { formatDate, humanize, money, t } from "@/lib/format";
import { Button, Dialog, EmptyState, ErrorState, Field, LoadingBlock, PageHeader, ScrollFade, Segmented, StatusChip, Toggle, cx, inputCls, selectCls, textareaCls } from "@/components/ui/primitives";
import { IconCalendar, IconMinus, IconPlus, IconSearch, IconUsers } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

const briefTone = (s: string | null) => (s === "submitted" ? "attending" : s === "in_progress" ? "pending" : "neutral") as "attending" | "pending" | "neutral";
const briefText = (s: string | null) => (s ? ({ not_started: "Brief not started", in_progress: "Brief in progress", submitted: "Brief in", archived: "Archived" } as Record<string, string>)[s] ?? humanize(s) : "No brief");

export function PipelinePage() {
  const { me } = useSession();
  const isAdmin = me?.role === "admin";
  const [view, setView] = useState<"board" | "list">("board");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [stage, setStage] = useState<"" | Stage>("");
  const [mode, setMode] = useState<"studio" | "self_serve" | "">("studio");
  const [sort, setSort] = useState<"eventDate" | "createdAt">("eventDate");
  const [newOrder, setNewOrder] = useState(false);
  useEffect(() => { const h = setTimeout(() => setDq(q), 300); return () => clearTimeout(h); }, [q]);
  const board = useAsync(() => api<{ columns: { stage: Stage; count: number }[] }>("/api/admin/board"));
  const metrics = useAsync(() => (isAdmin ? api<Metrics>("/api/admin/metrics") : Promise.resolve(null)), [isAdmin]);
  const list = usePaged<AdminEvent>("/api/admin/events", { q: dq || undefined, stage: view === "list" ? stage || undefined : undefined, serviceMode: mode || undefined, sort }, 200);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Pipeline" subtitle={me?.role === "staff" ? "Events assigned to you, by production stage." : "Every studio event, by production stage."}
        actions={isAdmin && <Button onClick={() => setNewOrder(true)}><IconPlus size={18} />Manual order</Button>} />

      {isAdmin && metrics.data && <MetricTiles m={metrics.data} />}

      <div className="mb-4 mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented label="View" value={view} onChange={setView} options={[{ value: "board", label: "Board" }, { value: "list", label: "List" }]} />
          <label className="sr-only" htmlFor="pm">Service</label>
          <select id="pm" className={selectCls + " h-11 w-auto"} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="studio">Studio</option><option value="self_serve">Self-serve</option><option value="">All services</option>
          </select>
          {view === "list" && <>
            <label className="sr-only" htmlFor="ps">Stage</label>
            <select id="ps" className={selectCls + " h-11 w-auto"} value={stage} onChange={(e) => setStage(e.target.value as Stage | "")}>
              <option value="">All stages</option>{ADMIN_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <label className="sr-only" htmlFor="pso">Sort</label>
            <select id="pso" className={selectCls + " h-11 w-auto"} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="eventDate">Soonest event</option><option value="createdAt">Newest order</option>
            </select>
          </>}
        </div>
        <div className="relative lg:w-80">
          <IconSearch size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <label htmlFor="pq" className="sr-only">Search events</label>
          <input id="pq" type="search" className={inputCls + " pl-10"} placeholder="Search names, emails, venues" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {list.loading && !list.items.length ? <LoadingBlock rows={4} label="Loading events" /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> :
        list.items.length === 0 ? <EmptyState icon={<IconCalendar />} title={dq ? "No events match" : "Nothing in the pipeline"} body={dq ? "Try another name or email." : me?.role === "staff" ? "When an admin assigns you an event, it shows up here." : "New studio orders appear here as soon as they're paid."} /> :
        view === "board" ? <Board items={list.items} counts={board.data?.columns} /> : <EventTable items={list.items} />}
      {list.hasMore && <div className="mt-4 text-center"><Button variant="outline" loading={list.loadingMore} onClick={list.loadMore}>Load more</Button></div>}
      {isAdmin && <ManualOrderDialog open={newOrder} onClose={() => setNewOrder(false)} />}
    </div>
  );
}

function MetricTiles({ m }: { m: Metrics }) {
  const tiles: [string, string, string][] = [
    ["Revenue, 30 days", money(m.revenueLast30Days.totalCents, m.currency), `${m.revenueLast30Days.orders} orders${m.revenueLast30Days.taxCents != null ? ` · ${money(m.revenueLast30Days.taxCents, m.currency)} tax` : ""}`],
    ["Revenue, all time", money(m.revenueAllTime.totalCents, m.currency), `${m.revenueAllTime.orders} orders · incl. tax`],
    ["Events", String(m.events.studio + m.events.self_serve), `${m.events.studio} studio · ${m.events.self_serve} self-serve`],
    ["Replies, 30 days", String(m.rsvpsLast30Days), "across all invitations"],
  ];
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0" aria-label="Studio metrics">
      {tiles.map(([k, v, d], i) => (
        <li key={k} className={cx("stat", i === 0 ? "card-night relative overflow-hidden" : "card")}>
          {i === 0 && <div aria-hidden className="glow-bloom" style={{ width: 260, height: 260, right: -110, top: -130 }} />}
          <div className="relative"><p className={cx("k", i === 0 && "text-on-night-muted")}>{k}</p><p className="v">{v}</p><p className={cx("d", i === 0 && "text-on-night-muted")}>{d}</p></div>
        </li>
      ))}
    </ul>
  );
}

function Board({ items, counts }: { items: AdminEvent[]; counts?: { stage: Stage; count: number }[] }) {
  return (
    <ScrollFade className="-mx-4 px-4 pb-2 sm:mx-0 sm:px-0">
      <div className="grid min-w-[1100px] grid-cols-6 gap-3">
        {ADMIN_STAGES.map((s) => {
          const col = items.filter((e) => e.productionStage === s.key);
          const n = counts?.find((c) => c.stage === s.key)?.count ?? col.length;
          return (
            <section key={s.key} aria-labelledby={`col-${s.key}`} className="flex flex-col rounded-card bg-surface-2/70 p-2">
              <h2 id={`col-${s.key}`} className="flex items-center justify-between px-2 py-2 text-sm font-semibold">{s.label}<span className="tabular rounded-full bg-surface px-2 py-0.5 text-caption text-muted">{n}</span></h2>
              <ul className="flex flex-col gap-2">
                {col.map((e) => <li key={e.id}><EventCard e={e} /></li>)}
                {col.length === 0 && <li className="rounded-md border border-dashed border-line px-3 py-6 text-center text-caption text-muted">Nothing here</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </ScrollFade>
  );
}

function EventCard({ e }: { e: AdminEvent }) {
  const soon = e.daysToEvent != null && e.daysToEvent <= 30;
  return (
    <Link href={`/admin/events/${e.id}`} className="card block p-3 transition hover:shadow-raised">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold leading-snug">{e.title}</p>
        {e.express && <span className="tag !bg-accent/15 !text-accent-strong">Rush</span>}
      </div>
      <p className={cx("mt-1 text-caption", soon ? "font-semibold text-danger" : "text-muted")}>{e.eventDate ? `${formatDate(e.eventDate, { day: "numeric", month: "short", year: "numeric" })} · ${e.daysToEvent} days` : "No date yet"}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusChip tone={briefTone(e.briefStatus)}>{briefText(e.briefStatus)}</StatusChip>
        {e.planCode && <span className="tag">{humanize(e.planCode)}</span>}
      </div>
      <p className="mt-2 flex items-center justify-between text-caption text-muted">
        <span className="tabular" title="Coming / can't come / waiting">{e.rsvp.confirmed} · {e.rsvp.declined} · {e.rsvp.pending}</span>
        <span className="flex items-center gap-1 truncate"><IconUsers size={14} />{e.assignedStaff?.name ?? "Unassigned"}</span>
      </p>
    </Link>
  );
}

function EventTable({ items }: { items: AdminEvent[] }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card" tabIndex={0} role="region" aria-label="Events">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="bg-surface-2 text-left text-caption font-semibold text-muted">
          <tr>{["Event", "Date", "Stage", "Brief", "Replies", "Plan", "Designer"].map((h) => <th key={h} scope="col" className="px-4 py-3">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((e) => (
            <tr key={e.id} className="hover:bg-surface-2/50">
              <td className="px-4 py-3"><Link href={`/admin/events/${e.id}`} className="font-semibold text-ink underline-offset-2 hover:underline">{e.title}</Link>{e.express && <span className="tag ml-2">Rush</span>}<span className="block text-caption text-muted">{e.serviceMode === "studio" ? "Studio" : "Self-serve"}</span></td>
              <td className="tabular px-4 py-3">{e.eventDate ? formatDate(e.eventDate, { dateStyle: "medium" }) : "—"}{e.daysToEvent != null && <span className="block text-caption text-muted">{e.daysToEvent} days</span>}</td>
              <td className="px-4 py-3">{stageLabel(e.productionStage)}</td>
              <td className="px-4 py-3"><StatusChip tone={briefTone(e.briefStatus)}>{briefText(e.briefStatus)}</StatusChip></td>
              <td className="tabular px-4 py-3">{e.rsvp.confirmed} / {e.rsvp.declined} / {e.rsvp.pending}</td>
              <td className="px-4 py-3">{e.planCode ? humanize(e.planCode) : "—"}</td>
              <td className="px-4 py-3">{e.assignedStaff?.name ?? <span className="text-muted">Unassigned</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A-03: phone / bank-transfer order. The API emails a set-password link; no password is ever shown. */
function ManualOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const cat = useAsync(() => (open ? api<Catalogue>("/api/public/catalogue") : Promise.resolve(null)), [open]);
  const blank = { email: "", plan: "", partner1: "", partner2: "", honoree: "", eventDate: "", venueName: "", themeKey: "", languages: ["en"] as string[], extras: [] as string[], langUnits: 0, adminNote: "", markPaid: true, sendAccessEmail: true };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF(blank); setErr({}); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const plan = cat.data?.plans.find((p) => p.code === f.plan);
  const person = plan && (plan.product === "birthday" || plan.product === "bridesmaid");
  const offered = plan ? (cat.data?.planExtras[plan.code] ?? []).map((c) => cat.data!.extras.find((x) => x.code === c)).filter(isOfferedExtra) : [];
  // Languages: plan limit plus paid extra_language units, up to 8. Units are derived from the language count.
  const canExtraLang = offered.some((x) => x.code === "extra_language");
  const extras = offered.filter((x) => x.code !== "extra_language");
  const overCap = plan ? Math.max(0, f.languages.length - plan.maxLanguages) : 0;
  const langCap = plan ? (canExtraLang ? 8 : plan.maxLanguages) : 8;
  const extraLang = cat.data?.extras.find((e) => e.code === "extra_language");
  async function submit() {
    const e: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(f.email)) e.email = "Enter the customer's email.";
    if (!f.plan) e.plan = "Choose a plan.";
    if (person ? !f.honoree.trim() : !f.partner1.trim()) e.names = "Add at least one name.";
    if (plan && f.languages.length > langCap) e.languages = canExtraLang ? "Up to 8 languages." : `This plan includes up to ${plan.maxLanguages} languages.`;
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await api<{ id?: string; event?: { id: string } }>("/api/admin/events", {
        body: {
          email: f.email.trim(), plan: f.plan, hostNames: person ? { honoree: f.honoree.trim() } : { partner1: f.partner1.trim(), partner2: f.partner2.trim() || undefined },
          eventDate: f.eventDate || undefined, venueName: f.venueName.trim() || undefined, themeKey: f.themeKey || undefined, languages: f.languages,
          // Send exactly the units the admin chose; the server prices the order (and may add units it needs).
          extras: adminExtras(f.extras, f.langUnits), adminNote: f.adminNote.trim() || undefined, markPaid: f.markPaid, sendAccessEmail: f.sendAccessEmail,
        },
      });
      const id = r.event?.id ?? r.id;
      // Manual orders trim extra_language units like checkout: report what the server actually charged.
      let unitsNote = "";
      if (id && f.markPaid && (f.langUnits > 0 || overCap > 0)) {
        try {
          const ev = await api<{ orders: { id: string }[] }>(`/api/admin/events/${id}`);
          const ord = ev.orders[0] ? await api<Order>(`/api/admin/orders/${ev.orders[0].id}`) : null;
          const kept = ord?.items?.find((it) => it.code === "extra_language")?.qty ?? 0;
          const units = (n: number) => `${n} Extra language unit${n === 1 ? "" : "s"}`;
          if (kept < f.langUnits) unitsNote = kept === 0
            ? ` You entered ${f.langUnits}; no Extra language units were charged, because the plan already covers these languages.`
            : ` You entered ${f.langUnits}; charged for ${units(kept)}, which is all the languages need.`;
          else if (kept > f.langUnits) unitsNote = ` You entered ${f.langUnits}; charged for ${units(kept)}, because ${f.languages.length} languages need ${kept}.`;
        } catch { /* the order is still visible on the event page */ }
      }
      toast((f.sendAccessEmail ? "Order created. The customer gets a set-password link by email." : "Order created.") + unitsNote);
      onClose();
      if (id) router.push(`/admin/events/${id}`);
    } catch (x) {
      const miss = x instanceof ApiError && Array.isArray(x.details?.missing) ? (x.details!.missing as { code: string; qty?: number }[]) : [];
      const short = miss.find((m) => m.code === "extra_language")?.qty;
      if (short) setErr({ ...(x instanceof ApiError ? x.fields ?? {} : {}), languages: `${short} more Extra language unit${short === 1 ? "" : "s"} needed for ${f.languages.length} languages on this plan.` });
      else if (x instanceof ApiError && x.fields) setErr(x.fields);
      toast(x instanceof Error ? x.message : "Couldn't create the order", "error");
    } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Manual order" wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Create order</Button></>}>
      {cat.loading && !cat.data ? <LoadingBlock rows={3} /> : cat.error ? <ErrorState error={cat.error} onRetry={() => cat.reload()} /> : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer email" error={err.email} required className="sm:col-span-2">{(p) => <input {...p} type="email" className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          <Field label="Plan" error={err.plan} required>{(p) => <select {...p} className={selectCls} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value, extras: [] })}><option value="">Choose…</option>{cat.data?.plans.map((pl) => <option key={pl.code} value={pl.code}>{t(pl.name)} · {money(pl.basePriceCents, cat.data!.currency)}</option>)}</select>}</Field>
          <Field label="Style" optional>{(p) => <select {...p} className={selectCls} value={f.themeKey} onChange={(e) => setF({ ...f, themeKey: e.target.value })}><option value="">Decide later</option>{cat.data?.themes.map((th) => <option key={th.key} value={th.key}>{t(th.name)}</option>)}</select>}</Field>
          {person ? (
            <Field label="Honoree" error={err.names} required className="sm:col-span-2">{(p) => <input {...p} className={inputCls} value={f.honoree} onChange={(e) => setF({ ...f, honoree: e.target.value })} />}</Field>
          ) : <>
            <Field label="Partner 1" error={err.names} required>{(p) => <input {...p} className={inputCls} value={f.partner1} onChange={(e) => setF({ ...f, partner1: e.target.value })} />}</Field>
            <Field label="Partner 2" optional>{(p) => <input {...p} className={inputCls} value={f.partner2} onChange={(e) => setF({ ...f, partner2: e.target.value })} />}</Field>
          </>}
          <Field label="Event date" optional>{(p) => <input {...p} type="date" className={inputCls} value={f.eventDate} onChange={(e) => setF({ ...f, eventDate: e.target.value })} />}</Field>
          <Field label="Venue" optional>{(p) => <input {...p} className={inputCls} value={f.venueName} onChange={(e) => setF({ ...f, venueName: e.target.value })} />}</Field>
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-semibold">Languages {plan && <span className="font-normal text-muted">({plan.maxLanguages} included{canExtraLang ? `, up to 8 with Extra language` : ""})</span>}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {cat.data?.languages.map((l) => { const on = f.languages.includes(l.code); return <button key={l.code} type="button" aria-pressed={on} className={cx("chip", on && "is-on")} onClick={() => setF({ ...f, languages: on ? f.languages.filter((x) => x !== l.code) : [...f.languages, l.code] })}>{l.label}</button>; })}
            </div>
            {canExtraLang && extraLang && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="text-sm">Extra language units <span className="text-muted">({money(extraLang.priceCents, cat.data!.currency)} each)</span></span>
                <span className="flex items-center gap-2" role="group" aria-label="Extra language units">
                  <button type="button" className="grid size-11 place-items-center rounded-md border border-line disabled:opacity-40" disabled={f.langUnits <= 0} onClick={() => setF({ ...f, langUnits: f.langUnits - 1 })} aria-label="One fewer unit"><IconMinus size={16} /></button>
                  <output className="tabular w-8 text-center font-semibold" aria-live="polite">{f.langUnits}</output>
                  <button type="button" className="grid size-11 place-items-center rounded-md border border-line disabled:opacity-40" disabled={f.langUnits >= 8} onClick={() => setF({ ...f, langUnits: f.langUnits + 1 })} aria-label="One more unit"><IconPlus size={16} /></button>
                </span>
                {overCap > 0 && <span className="text-caption text-muted">{f.languages.length} languages is {overCap} over the plan&apos;s {plan!.maxLanguages}. The order shows the units the server charges.</span>}
              </div>
            )}
            {err.languages && <p className="mt-1 text-caption font-medium text-danger">{err.languages}</p>}
          </fieldset>
          {extras.length > 0 && (
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-semibold">Add-ons</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {extras.map((x) => { const on = f.extras.includes(x!.code); return <button key={x!.code} type="button" aria-pressed={on} className={cx("chip", on && "is-on")} onClick={() => setF({ ...f, extras: on ? f.extras.filter((c) => c !== x!.code) : [...f.extras, x!.code] })}>{t(x!.name)}<span className="price">{money(x!.priceCents, cat.data!.currency)}</span></button>; })}
              </div>
            </fieldset>
          )}
          <Field label="Internal note" optional className="sm:col-span-2">{(p) => <textarea {...p} className={textareaCls} value={f.adminNote} onChange={(e) => setF({ ...f, adminNote: e.target.value })} placeholder="e.g. Paid by e-Transfer on Oct 12" />}</Field>
          <div className="space-y-3 sm:col-span-2">
            <Toggle checked={f.markPaid} onChange={(v) => setF({ ...f, markPaid: v })} label="Mark as paid" description="Records a paid manual order at the server's catalogue price (plan and add-ons), with you as the creator. Use when payment arrived by phone or bank transfer." />
            <Toggle checked={f.sendAccessEmail} onChange={(v) => setF({ ...f, sendAccessEmail: v })} label="Email a set-password link" description="The customer chooses their own password. We never send one." />
          </div>
        </div>
      )}
    </Dialog>
  );
}
