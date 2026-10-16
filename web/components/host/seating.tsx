"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useEvent } from "@/lib/event-context";
import { useAsync } from "@/lib/hooks";
import type { Assignment, LayoutItem, Party, PartyMember, Seating, SeatTable, TableShape } from "@/lib/types";
import { humanize, uuid } from "@/lib/format";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, LoadingBlock, Notice, PageHeader, Segmented, cx, inputCls, selectCls } from "@/components/ui/primitives";
import { IconEdit, IconGrip, IconPlus, IconRestore, IconSearch, IconTable, IconTrash, IconWand, IconX } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

type Local = { version: number; layout: LayoutItem[]; tables: SeatTable[]; assignments: Assignment[] };
type MemberRef = { kind: "guest" | "companion"; id: string };
const W = 1000, H = 680;
const SHAPES: { value: TableShape; label: string }[] = [
  { value: "round", label: "Round" }, { value: "rect", label: "Long" }, { value: "square", label: "Square" }, { value: "head", label: "Head table" }, { value: "u_shape", label: "U-shape" }, { value: "serpentine", label: "Serpentine" },
];
const tableSize = (t: SeatTable) => {
  const s = Math.max(4, t.seats);
  if (t.shape === "round") { const d = 70 + s * 4; return { w: d, h: d }; }
  if (t.shape === "square") { const d = 80 + s * 3; return { w: d, h: d }; }
  if (t.shape === "head") return { w: 90 + s * 18, h: 54 };
  if (t.shape === "u_shape") return { w: 150 + s * 6, h: 120 };
  return { w: 90 + s * 13, h: 66 };
};
const keyOf = (m: MemberRef) => `${m.kind}:${m.id}`;
const asRef = (a: Assignment): MemberRef => (a.guestId ? { kind: "guest", id: a.guestId } : { kind: "companion", id: a.companionId! });

export function SeatingPage() {
  const { event, canWrite, subscribe } = useEvent();
  const toast = useToast();
  const remote = useAsync(() => api<Seating>(`/api/events/${event!.id}/seating`), [event?.id]);
  const [local, setLocal] = useState<Local | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [view, setView] = useState<"floor" | "grid">("floor");
  const [selected, setSelected] = useState<string | null>(null);
  const [editTable, setEditTable] = useState<SeatTable | "new" | null>(null);
  const [q, setQ] = useState("");
  const [arranging, setArranging] = useState(false);
  /** H-02: auto-arrange is a preview first. `before` is restored on Undo; nothing is saved until "Keep these seats". */
  const [proposal, setProposal] = useState<{ before: Local; added: number; unseated: number } | null>(null);

  useEffect(() => {
    if (remote.data && !dirty) setLocal({ version: remote.data.version, layout: remote.data.layout, tables: remote.data.tables, assignments: remote.data.assignments });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote.data]);
  useEffect(() => { if (window.matchMedia("(max-width: 767px)").matches) setView("grid"); }, []);
  // A declined guest is unseated server-side; refresh parties when replies change (keeps local edits).
  useEffect(() => subscribe((m) => { if (m.type.startsWith("guest.")) remote.reload(true); }), [subscribe, remote]);

  const parties = useMemo(() => remote.data?.parties ?? [], [remote.data]);
  const memberIndex = useMemo(() => {
    const m = new Map<string, PartyMember & { party: Party }>();
    for (const p of parties) for (const mem of p.members) m.set(`${mem.kind}:${mem.id}`, { ...mem, party: p });
    return m;
  }, [parties]);
  const seatedKeys = useMemo(() => new Set((local?.assignments ?? []).map((a) => keyOf(asRef(a)))), [local]);
  const byTable = useMemo(() => {
    const m = new Map<string, (PartyMember & { party: Party })[]>();
    for (const a of local?.assignments ?? []) {
      const mem = memberIndex.get(keyOf(asRef(a)));
      if (!mem) continue;
      if (!m.has(a.tableId)) m.set(a.tableId, []);
      m.get(a.tableId)!.push(mem);
    }
    return m;
  }, [local, memberIndex]);

  const mutate = useCallback((fn: (l: Local) => Local) => { setLocal((l) => (l ? fn(l) : l)); setDirty(true); }, []);

  const seat = useCallback((refs: MemberRef[], tableId: string | null) => {
    mutate((l) => {
      const keys = new Set(refs.map(keyOf));
      const rest = l.assignments.filter((a) => !keys.has(keyOf(asRef(a))));
      if (!tableId) return { ...l, assignments: rest };
      return { ...l, assignments: [...rest, ...refs.map((r) => ({ tableId, guestId: r.kind === "guest" ? r.id : null, companionId: r.kind === "companion" ? r.id : null, seatIndex: null }))] };
    });
  }, [mutate]);

  async function save() {
    if (!local) return;
    setSaving(true);
    try {
      const res = await api<Seating>(`/api/events/${event!.id}/seating`, {
        method: "PUT",
        body: {
          version: local.version,
          layout: local.layout,
          tables: local.tables.map(({ id, label, shape, seats, note, x, y, rotation }) => ({ id, label, shape, seats, note, x: Math.round(x), y: Math.round(y), rotation })),
          assignments: local.assignments.map(({ tableId, guestId, companionId, seatIndex }) => ({ tableId, guestId, companionId, seatIndex })),
        },
      });
      remote.setData(res);
      setLocal({ version: res.version, layout: res.layout, tables: res.tables, assignments: res.assignments });
      setDirty(false);
      setProposal(null);
      toast("Seating saved");
    } catch (e) {
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") setConflict(true);
      else toast(e instanceof Error ? e.message : "Couldn't save", "error");
    } finally { setSaving(false); }
  }
  async function reloadRemote() {
    setDirty(false); setConflict(false); setProposal(null);
    const d = await remote.reload();
    if (d) setLocal({ version: d.version, layout: d.layout, tables: d.tables, assignments: d.assignments });
  }
  async function autoArrange() {
    if (dirty) { toast("Save your changes first, then try a suggested plan.", "error"); return; }
    if (!local) return;
    setArranging(true);
    try {
      // apply:false only proposes. The host reviews it on the plan, then keeps (PUT) or undoes it.
      const r = await api<{ applied: boolean; version: number; assignments: Assignment[]; unseated: unknown[] }>(`/api/events/${event!.id}/seating/auto-arrange`, { body: { keepPartiesTogether: true, apply: false } });
      const added = r.assignments.length - local.assignments.length;
      if (added <= 0) { toast(r.unseated.length ? "No free seats to suggest. Add a table first." : "Everyone already has a seat"); return; }
      setProposal({ before: local, added, unseated: r.unseated.length });
      setLocal({ ...local, version: r.version, assignments: r.assignments });
      setDirty(true);
    } catch (e) { toast(e instanceof Error ? e.message : "Couldn't suggest seats", "error"); } finally { setArranging(false); }
  }
  function undoProposal() {
    if (!proposal) return;
    setLocal(proposal.before);
    setDirty(false);
    setProposal(null);
    toast("Suggestion discarded. Nothing was saved.");
  }

  if (remote.loading && !remote.data) return <LoadingBlock rows={5} label="Loading seating" />;
  if (remote.error) return <ErrorState error={remote.error} onRetry={() => remote.reload()} />;
  if (!local) return null;

  const stats = {
    confirmed: remote.data!.stats.confirmedPeople,
    seated: seatedKeys.size,
    tables: local.tables.length,
    seats: local.tables.reduce((s, t) => s + t.seats, 0),
  };
  const unseatedParties = parties
    .map((p) => ({ ...p, members: p.members.filter((m) => !seatedKeys.has(`${m.kind}:${m.id}`)) }))
    .filter((p) => p.members.length > 0 && (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.members.some((m) => m.fullName.toLowerCase().includes(q.toLowerCase()))));

  return (
    <div>
      <PageHeader title="Seating" subtitle="Drag parties onto tables. Only guests who said yes appear here."
        actions={canWrite && <>
          <Button variant="outline" onClick={() => setEditTable("new")}><IconPlus size={18} />Add table</Button>
          <Button variant="outline" onClick={autoArrange} loading={arranging} disabled={!!proposal}><IconWand size={18} />Suggest seats</Button>
          <Button onClick={save} loading={saving} disabled={!dirty}>{dirty ? "Save changes" : "Saved"}</Button>
        </>} />
      <ul className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5" aria-label="Seating summary">
        {[["Coming", stats.confirmed], ["Seated", stats.seated], ["Need a seat", Math.max(0, stats.confirmed - stats.seated)], ["Tables", stats.tables], ["Seats", stats.seats]].map(([l, n]) => (
          <li key={l} className="rounded-card border border-line bg-surface p-3 shadow-card"><p className="text-xs font-semibold text-muted">{l}</p><p className="tabular font-display text-2xl">{n}</p></li>
        ))}
      </ul>
      {proposal && (
        <div role="status" className="card mb-4 flex flex-col gap-3 border-l-4 !border-l-accent p-4 sm:flex-row sm:items-center">
          <IconWand size={20} className="shrink-0 text-accent-strong" />
          <p className="flex-1 text-body-sm"><strong>Preview: {proposal.added} {proposal.added === 1 ? "person" : "people"} placed, parties kept together.</strong> {proposal.unseated > 0 ? `${proposal.unseated} still need a seat. ` : ""}Look over the plan and move anyone you like. Nothing is saved yet.</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={undoProposal}><IconRestore size={18} />Undo</Button>
            <Button onClick={save} loading={saving}>Keep these seats</Button>
          </div>
        </div>
      )}
      {conflict && <Notice tone="warning" className="mb-4">Someone else saved the seating while you were editing. <button className="font-semibold underline" onClick={reloadRemote}>Load their version</button> and re-apply your changes.</Notice>}

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside aria-label="Guests without a seat" className="lg:sticky lg:top-20 lg:self-start">
          <Card className="p-4">
            <h2 className="font-semibold">Needs a seat</h2>
            <div className="relative mt-3">
              <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <label htmlFor="seat-q" className="sr-only">Search guests</label>
              <input id="seat-q" type="search" className={inputCls + " h-10 pl-9 text-sm"} placeholder="Search guests" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="mt-3 max-h-[60vh] overflow-y-auto pr-1" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const d = parseDrag(e); if (d) seat(d, null); }}>
              {unseatedParties.length === 0 ? (
                <p className="rounded-md bg-success-soft px-3 py-4 text-center text-sm text-success">{q ? "No one matches." : "Everyone has a seat 🎉"}</p>
              ) : (
                <ul className="space-y-2">
                  {unseatedParties.map((p) => (
                    <li key={p.guestId} draggable={canWrite} onDragStart={(e) => startDrag(e, p.members.map((m) => ({ kind: m.kind, id: m.id })))} className="rounded-md border border-line bg-surface p-2.5">
                      <div className="flex items-center gap-2">
                        {canWrite && <IconGrip size={16} className="shrink-0 cursor-grab text-muted" />}
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{p.name}</span><span className="text-xs text-muted">{p.members.length === p.partySize ? `Party of ${p.partySize}` : `${p.members.length} of ${p.partySize} unseated`}</span></span>
                      </div>
                      {canWrite && (
                        <>
                          <label htmlFor={`seat-${p.guestId}`} className="sr-only">Seat {p.name} at</label>
                          <select id={`seat-${p.guestId}`} className={selectCls + " mt-2 h-9 text-xs"} value="" onChange={(e) => e.target.value && seat(p.members.map((m) => ({ kind: m.kind, id: m.id })), e.target.value)}>
                            <option value="">Seat at…</option>
                            {local.tables.map((t) => <option key={t.id} value={t.id}>{t.label} ({(byTable.get(t.id)?.length ?? 0)}/{t.seats})</option>)}
                          </select>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </aside>

        <section aria-label="Tables" className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Segmented label="View" value={view} onChange={setView} options={[{ value: "floor", label: "Floor plan" }, { value: "grid", label: "Tables" }]} />
            {dirty && <span className="text-sm text-warning" aria-live="polite">Unsaved changes</span>}
          </div>
          {local.tables.length === 0 ? (
            <EmptyState icon={<IconTable />} title="No tables yet" body="Draw your room, or we'll suggest a layout from your guest list." action={canWrite && <Button onClick={() => setEditTable("new")}>Add a table</Button>} />
          ) : view === "floor" ? (
            <FloorPlan local={local} byTable={byTable} selected={selected} setSelected={setSelected} canWrite={canWrite} onMove={(id, x, y, isLayout) => mutate((l) => isLayout ? { ...l, layout: l.layout.map((i) => (i.id === id ? { ...i, x, y } : i)) } : { ...l, tables: l.tables.map((t) => (t.id === id ? { ...t, x, y } : t)) })} onDropOn={(tid, refs) => seat(refs, tid)} onEdit={(t) => setEditTable(t)} />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {local.tables.map((t) => {
                const people = byTable.get(t.id) ?? [];
                const over = people.length - t.seats;
                return (
                  <li key={t.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const d = parseDrag(e); if (d) seat(d, t.id); }}
                    className={cx("rounded-card border bg-surface p-4 shadow-card", over > 0 ? "border-danger" : "border-line")}>
                    <div className="flex items-start justify-between gap-2">
                      <div><h3 className="font-semibold">{t.label}</h3><p className="text-xs text-muted">{SHAPES.find((s) => s.value === t.shape)?.label}</p></div>
                      <Badge tone={over > 0 ? "danger" : people.length === t.seats ? "success" : "neutral"}>{people.length}/{t.seats}</Badge>
                    </div>
                    {over > 0 && <p className="mt-2 text-xs font-semibold text-danger">{over} over capacity</p>}
                    <p className="mt-1 text-xs text-muted">{people.filter((p) => p.type === "child").length} children · {people.filter((p) => p.dietary).length} dietary notes</p>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {people.map((p) => (
                        <li key={p.id} draggable={canWrite} onDragStart={(e) => startDrag(e, [{ kind: p.kind, id: p.id }])} className="flex items-center gap-1 rounded-sm bg-tint py-1 pl-2 pr-1 text-xs">
                          {p.fullName}{p.type === "child" && " (child)"}
                          {canWrite && <button className="tap-44 grid size-7 place-items-center rounded hover:bg-surface" aria-label={`Unseat ${p.fullName}`} onClick={() => seat([{ kind: p.kind, id: p.id }], null)}><IconX size={14} /></button>}
                        </li>
                      ))}
                      {people.length === 0 && <li className="text-xs text-muted">Drop guests here</li>}
                    </ul>
                    {canWrite && <div className="mt-3 flex gap-1"><Button size="sm" variant="ghost" onClick={() => setEditTable(t)}><IconEdit size={14} />Edit</Button></div>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <TableDialog
        table={editTable}
        onClose={() => setEditTable(null)}
        onSave={(t) => {
          mutate((l) => l.tables.some((x) => x.id === t.id) ? { ...l, tables: l.tables.map((x) => (x.id === t.id ? t : x)) } : { ...l, tables: [...l.tables, t] });
          setEditTable(null);
        }}
        onDelete={(id) => { mutate((l) => ({ ...l, tables: l.tables.filter((t) => t.id !== id), assignments: l.assignments.filter((a) => a.tableId !== id) })); setEditTable(null); }}
        count={local.tables.length}
      />
    </div>
  );
}

function startDrag(e: React.DragEvent, refs: MemberRef[]) {
  e.dataTransfer.setData("application/x-seat", JSON.stringify(refs));
  e.dataTransfer.effectAllowed = "move";
}
function parseDrag(e: React.DragEvent): MemberRef[] | null {
  try { return JSON.parse(e.dataTransfer.getData("application/x-seat")); } catch { return null; }
}

function FloorPlan({ local, byTable, selected, setSelected, canWrite, onMove, onDropOn, onEdit }: {
  local: Local; byTable: Map<string, (PartyMember & { party: Party })[]>; selected: string | null; setSelected: (id: string | null) => void; canWrite: boolean;
  onMove: (id: string, x: number, y: number, isLayout: boolean) => void; onDropOn: (tableId: string, refs: MemberRef[]) => void; onEdit: (t: SeatTable) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const drag = useRef<{ id: string; isLayout: boolean; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const onPointerDown = (e: React.PointerEvent, id: string, x: number, y: number, isLayout: boolean) => {
    setSelected(id);
    if (!canWrite) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id, isLayout, sx: e.clientX, sy: e.clientY, ox: x, oy: y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    onMove(d.id, clamp(d.ox + (e.clientX - d.sx) / scale, W - 40), clamp(d.oy + (e.clientY - d.sy) / scale, H - 30), d.isLayout);
  };
  const onKey = (e: React.KeyboardEvent, id: string, x: number, y: number, isLayout: boolean, t?: SeatTable) => {
    const step = e.shiftKey ? 40 : 10;
    const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (map[e.key] && canWrite) { e.preventDefault(); onMove(id, clamp(x + map[e.key][0], W - 40), clamp(y + map[e.key][1], H - 30), isLayout); }
    if (e.key === "Enter" && t && canWrite) onEdit(t);
  };
  return (
    <div ref={wrap} className="w-full overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="relative origin-top-left" style={{ width: W, height: H, transform: `scale(${scale})`, marginBottom: -(H * (1 - scale)), backgroundImage: "radial-gradient(var(--brand-line) 1px, transparent 1px)", backgroundSize: "24px 24px" }} onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)} onPointerDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
        {local.layout.map((i) => (
          <div key={i.id} role="button" tabIndex={0} aria-label={`${i.label ?? humanize(i.kind)}. Use arrow keys to move.`}
            onPointerDown={(e) => onPointerDown(e, i.id, i.x, i.y, true)} onKeyDown={(e) => onKey(e, i.id, i.x, i.y, true)}
            className={cx("absolute grid touch-none select-none place-items-center rounded-md border border-dashed text-xs font-semibold text-muted", canWrite && "cursor-move", selected === i.id ? "border-primary bg-tint" : "border-line bg-surface-2/70")}
            style={{ left: i.x, top: i.y, width: i.w, height: i.h, transform: `rotate(${i.rotation}deg)` }}>
            {i.label ?? humanize(i.kind)}
          </div>
        ))}
        {local.tables.map((t) => {
          const { w, h } = tableSize(t);
          const people = byTable.get(t.id) ?? [];
          const over = people.length > t.seats;
          return (
            <div key={t.id} role="button" tabIndex={0}
              aria-label={`${t.label}, ${people.length} of ${t.seats} seats. Drop guests here. Arrow keys move, Enter edits.`}
              onPointerDown={(e) => onPointerDown(e, t.id, t.x, t.y, false)} onKeyDown={(e) => onKey(e, t.id, t.x, t.y, false, t)} onDoubleClick={() => canWrite && onEdit(t)}
              onDragOver={(e) => { e.preventDefault(); setHover(t.id); }} onDragLeave={() => setHover(null)} onDrop={(e) => { e.preventDefault(); setHover(null); const d = parseDrag(e); if (d) onDropOn(t.id, d); }}
              className={cx("absolute flex touch-none select-none flex-col items-center justify-center border-2 p-1 text-center transition-shadow", canWrite && "cursor-move",
                t.shape === "round" ? "rounded-full" : t.shape === "u_shape" ? "rounded-b-[40px] rounded-t-md" : "rounded-md",
                over ? "border-danger bg-danger-soft" : hover === t.id ? "border-accent bg-warning-soft shadow-glow" : selected === t.id ? "border-primary bg-tint" : "border-line bg-surface")}
              style={{ left: t.x, top: t.y, width: w, height: h, transform: `rotate(${t.rotation}deg)` }}>
              <span className="line-clamp-2 text-xs font-bold leading-tight">{t.label}</span>
              <span className={cx("tabular text-overline", over ? "font-bold text-danger" : "text-muted")}>{people.length}/{t.seats}</span>
              {/* seat dots */}
              {t.shape === "round" && Array.from({ length: t.seats }).map((_, k) => {
                const a = (k / t.seats) * Math.PI * 2 - Math.PI / 2;
                return <span key={k} aria-hidden className={cx("absolute size-3 rounded-full border", k < people.length ? "border-primary bg-primary" : "border-line bg-surface")} style={{ left: w / 2 + Math.cos(a) * (w / 2 + 8) - 6 - 2, top: h / 2 + Math.sin(a) * (h / 2 + 8) - 6 - 2 }} />;
              })}
            </div>
          );
        })}
      </div>
      <p className="border-t border-line px-4 py-2 text-xs text-muted">Drag tables to arrange the room. Drop guests from the list onto a table. Keyboard: Tab to a table, arrows to move, Enter to edit.</p>
    </div>
  );
}

function TableDialog({ table, onClose, onSave, onDelete, count }: { table: SeatTable | "new" | null; onClose: () => void; onSave: (t: SeatTable) => void; onDelete: (id: string) => void; count: number }) {
  const [f, setF] = useState<SeatTable | null>(null);
  useEffect(() => {
    if (table === "new") setF({ id: uuid(), label: `Table ${count + 1}`, shape: "round", seats: 8, note: null, x: 60 + ((count * 160) % 800), y: 420 + Math.floor((count * 160) / 800) * 140, rotation: 0 });
    else setF(table);
  }, [table, count]);
  return (
    <Dialog open={!!table} onClose={onClose} title={table === "new" ? "Add a table" : "Edit table"}
      footer={f && <>{table !== "new" && <Button variant="ghost" className="mr-auto text-danger" onClick={() => onDelete(f.id)}><IconTrash size={16} />Delete table</Button>}<Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => f.label.trim() && onSave({ ...f, label: f.label.trim() })}>{table === "new" ? "Add table" : "Done"}</Button></>}>
      {f && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2">{(p) => <input {...p} className={inputCls} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />}</Field>
          <Field label="Shape">{(p) => <select {...p} className={selectCls} value={f.shape} onChange={(e) => setF({ ...f, shape: e.target.value as TableShape })}>{SHAPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>}</Field>
          <Field label="Seats">{(p) => <input {...p} type="number" min={1} max={40} className={inputCls} value={f.seats} onChange={(e) => setF({ ...f, seats: Math.max(1, Math.min(40, parseInt(e.target.value, 10) || 1)) })} />}</Field>
          <Field label="Rotation" hint="Degrees">{(p) => <input {...p} type="number" step={15} min={-180} max={180} className={inputCls} value={f.rotation} onChange={(e) => setF({ ...f, rotation: parseInt(e.target.value, 10) || 0 })} />}</Field>
          <Field label="Note" optional>{(p) => <input {...p} className={inputCls} value={f.note ?? ""} onChange={(e) => setF({ ...f, note: e.target.value || null })} />}</Field>
          {table !== "new" && <p className="text-xs text-muted sm:col-span-2">Deleting a table moves its guests back to “Needs a seat”.</p>}
        </div>
      )}
    </Dialog>
  );
}
