"use client";
import { useEffect, useState } from "react";
import { api, ApiError, proxied } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { usePaged, type AdminReview, type AdminTrack, type CheckoutDraft, type Message, type Order } from "@/lib/admin";
import type { Theme, User } from "@/lib/types";
import { formatDate, humanize, money, relTime, t } from "@/lib/format";
import { Button, Dialog, EmptyState, ErrorState, Field, LoadingBlock, Notice, PageHeader, ScrollFade, Segmented, StatusChip, Toggle, cx, inputCls, selectCls } from "@/components/ui/primitives";
import { IconInbox, IconMail, IconMusic, IconPlus, IconSearch, IconSend, IconSparkle, IconUsers } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { OrderDialog, OrderSource, useAdminNames, OrderStatus } from "./event-detail";

const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
function useDebounced(v: string, ms = 300) { const [d, setD] = useState(v); useEffect(() => { const h = setTimeout(() => setD(v), ms); return () => clearTimeout(h); }, [v, ms]); return d; }
function Table({ label, head, children, min = 720 }: { label: string; head: string[]; children: React.ReactNode; min?: number }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card" tabIndex={0} role="region" aria-label={label}>
      <table className="w-full text-sm" style={{ minWidth: min }}>
        <thead className="bg-surface-2 text-left text-caption font-semibold text-muted"><tr>{head.map((h, i) => <th key={i} scope="col" className="px-4 py-3">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}
function More({ p }: { p: { hasMore: boolean; loadingMore: boolean; loadMore: () => void } }) {
  return p.hasMore ? <div className="mt-4 text-center"><Button variant="outline" loading={p.loadingMore} onClick={p.loadMore}>Load more</Button></div> : null;
}

/* ───────────── Orders + abandoned carts (A-05) ───────────── */
export function OrdersPage() {
  const [tab, setTab] = useState<"orders" | "drafts">("orders");
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Orders" subtitle="Payments, line items and tax, plus checkouts that were started but not finished." />
      <Segmented label="Orders view" value={tab} onChange={setTab} options={[{ value: "orders", label: "Orders" }, { value: "drafts", label: "Checkout drafts" }]} className="mb-5" />
      {tab === "orders" ? <OrdersList /> : <DraftsList />}
    </div>
  );
}
function OrdersList() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [open, setOpen] = useState<string | null>(null);
  const p = usePaged<Order>("/api/admin/orders", { status: status || undefined, q: dq || undefined });
  const nameOf = useAdminNames();
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="os">Status</label>
        <select id="os" className={selectCls + " sm:w-56"} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option><option value="paid">Paid</option><option value="pending_payment">Awaiting payment</option><option value="refunded">Refunded</option><option value="canceled">Canceled</option><option value="draft">Draft</option>
        </select>
        <div className="relative flex-1 sm:max-w-sm"><IconSearch size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><label htmlFor="oq" className="sr-only">Search orders</label><input id="oq" type="search" className={inputCls + " pl-10"} placeholder="Order number or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {p.loading && !p.items.length ? <LoadingBlock rows={4} /> : p.error ? <ErrorState error={p.error} onRetry={p.reload} /> : p.items.length === 0 ? <EmptyState icon={<IconInbox />} title="No orders here" body={dq || status ? "Try a different filter." : "Paid orders show up here the moment checkout completes."} /> : (
        <Table label="Orders" head={["Order", "Customer", "Plan", "Source", "Status", "Total", "Date"]}>
          {p.items.map((o) => (
            <tr key={o.id} className="cursor-pointer hover:bg-surface-2/50" onClick={() => setOpen(o.id)}>
              <td className="px-4 py-3"><button className="font-semibold underline-offset-2 hover:underline" onClick={(e) => { e.stopPropagation(); setOpen(o.id); }}>{o.number}</button></td>
              <td className="max-w-[240px] truncate px-4 py-3">{o.email}</td>
              <td className="px-4 py-3">{humanize(o.plan ?? o.planCode ?? "") || "Add-ons"}</td>
              <td className="px-4 py-3"><OrderSource o={o} nameOf={nameOf} /></td>
              <td className="px-4 py-3"><OrderStatus s={o.status} /></td>
              <td className="tabular px-4 py-3 font-semibold">{money(o.totalCents, o.currency)}<span className="block text-caption font-normal text-muted">incl. {money(o.taxCents, o.currency)} tax</span></td>
              <td className="tabular px-4 py-3">{formatDate(o.paidAt ?? o.createdAt, { dateStyle: "medium" })}</td>
            </tr>
          ))}
        </Table>
      )}
      <More p={p} />
      <OrderDialog id={open} onClose={() => setOpen(null)} onChanged={p.reload} />
    </>
  );
}
function DraftsList() {
  const [abandoned, setAbandoned] = useState<"all" | "1" | "0">("1");
  const p = usePaged<CheckoutDraft>("/api/admin/checkout-drafts", { abandoned: abandoned === "all" ? undefined : abandoned });
  return (
    <>
      <Segmented label="Draft filter" value={abandoned} onChange={setAbandoned} options={[{ value: "1", label: "Abandoned" }, { value: "0", label: "In progress" }, { value: "all", label: "All" }]} className="mb-4" />
      {p.loading && !p.items.length ? <LoadingBlock rows={4} /> : p.error ? <ErrorState error={p.error} onRetry={p.reload} /> : p.items.length === 0 ? <EmptyState title="No checkout drafts" body="Drafts are saved at each step of checkout and marked abandoned after a while without activity." /> : (
        <Table label="Checkout drafts" head={["Started", "Plan", "Last step", "Contact", "Choices", "Outcome"]}>
          {p.items.map((d) => (
            <tr key={d.id}>
              <td className="tabular px-4 py-3">{formatDate(d.createdAt, { dateStyle: "medium" })}<span className="block text-caption text-muted">active {relTime(d.updatedAt)}</span></td>
              <td className="px-4 py-3">{humanize(d.planCode)}</td>
              <td className="px-4 py-3">{d.lastStep ? humanize(d.lastStep) : "—"}</td>
              <td className="max-w-[220px] truncate px-4 py-3">{d.email ?? <span className="text-muted">Not given yet</span>}</td>
              <td className="px-4 py-3 text-caption">{d.themeKey ? humanize(d.themeKey) : "No style"} · {d.sections.length} sections · {d.extras.length} add-ons · {d.languages.join(", ").toUpperCase()}</td>
              <td className="px-4 py-3">{d.convertedOrderId ? <StatusChip tone="attending">Ordered</StatusChip> : d.abandoned ? <StatusChip tone="declined">Abandoned</StatusChip> : <StatusChip tone="pending">In progress</StatusChip>}</td>
            </tr>
          ))}
        </Table>
      )}
      <More p={p} />
    </>
  );
}

/* ───────────── Catalogue: themes (A-06), music (A-07), reviews (A-10) ───────────── */
export function CataloguePage() {
  const { me } = useSession();
  const canEdit = me?.role === "admin";
  const [tab, setTab] = useState<"themes" | "music" | "reviews">("themes");
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Catalogue" subtitle="Starting styles, the music library and the reviews shown on the home page." />
      <Segmented label="Catalogue view" value={tab} onChange={setTab} options={[{ value: "themes", label: "Styles" }, { value: "music", label: "Music" }, { value: "reviews", label: "Reviews" }]} className="mb-5" />
      {!canEdit && <Notice className="mb-4">Only studio admins can change the catalogue. You can browse everything here.</Notice>}
      {tab === "themes" && <ThemesList canEdit={canEdit} />}
      {tab === "music" && <MusicList canEdit={canEdit} />}
      {tab === "reviews" && <ReviewsList canEdit={canEdit} />}
    </div>
  );
}
function ThemesList({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const r = useAsync(() => api<{ items: Theme[] }>("/api/admin/themes"));
  async function patch(th: Theme, body: Record<string, unknown>) {
    try { await api(`/api/admin/themes/${th.id}`, { method: "PATCH", body }); toast("Style updated"); r.reload(true); } catch (e) { toast(msg(e), "error"); }
  }
  if (r.loading && !r.data) return <LoadingBlock rows={4} />;
  if (r.error) return <ErrorState error={r.error} onRetry={() => r.reload()} />;
  const items = [...r.data!.items].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  if (!items.length) return <EmptyState icon={<IconSparkle />} title="No styles yet" />;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((th) => {
        const pal = th.defaultConfig?.palette ?? {};
        return (
          <li key={th.id} className="card flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div><p className="font-semibold">{t(th.name)}</p><p className="font-mono text-caption text-muted">{th.key}</p></div>
              <StatusChip tone={th.status === "active" ? "attending" : th.status === "retired" ? "neutral" : "pending"}>{th.status === "coming_soon" ? "Coming soon" : humanize(th.status)}</StatusChip>
            </div>
            <div className="flex h-10 overflow-hidden rounded-md ring-1 ring-line" aria-label="Palette">
              {(["background", "surface", "primary", "accent", "glow", "text"] as const).map((k) => pal[k] ? <span key={k} className="flex-1" style={{ background: pal[k] }} title={`${k} ${pal[k]}`} /> : null)}
            </div>
            <p className="line-clamp-3 text-body-sm text-muted">{t(th.description)}</p>
            <p className="flex flex-wrap gap-1.5">{(th.products ?? (th.product ? [th.product] : [])).map((p) => <span key={p} className="tag">{humanize(p)}</span>)}{th.isPopular && <span className="tag">Popular</span>}{th.isNew && <span className="badge-new">New</span>}</p>
            {canEdit && (
              <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <label className="sr-only" htmlFor={`ts-${th.id}`}>Status of {t(th.name)}</label>
                <select id={`ts-${th.id}`} className={selectCls + " h-11 w-auto flex-1"} value={th.status} onChange={(e) => patch(th, { status: e.target.value })}>
                  <option value="active">Active</option><option value="coming_soon">Coming soon</option><option value="retired">Retired</option>
                </select>
                <Button size="sm" variant="ghost" aria-pressed={!!th.isPopular} onClick={() => patch(th, { isPopular: !th.isPopular })}>{th.isPopular ? "Unmark popular" : "Mark popular"}</Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
function MusicList({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const r = useAsync(() => api<{ items: AdminTrack[] }>("/api/admin/music"));
  async function toggle(tr: AdminTrack) {
    try { await api(`/api/admin/music/${tr.id}`, { method: "PATCH", body: { active: !tr.active } }); toast(tr.active ? "Hidden from hosts" : "Available to hosts"); r.reload(true); } catch (e) { toast(msg(e), "error"); }
  }
  if (r.loading && !r.data) return <LoadingBlock rows={4} />;
  if (r.error) return <ErrorState error={r.error} onRetry={() => r.reload()} />;
  if (!r.data!.items.length) return <EmptyState icon={<IconMusic />} title="No tracks yet" />;
  return (
    <ul className="flex flex-col gap-2">
      {r.data!.items.map((tr) => (
        <li key={tr.id} className="card flex flex-col gap-3 p-4 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{tr.title} <span className="font-normal text-muted">· {tr.artist}</span></p>
            <p className="text-caption text-muted">{Math.floor(tr.durationS / 60)}:{String(tr.durationS % 60).padStart(2, "0")} · {tr.moodTags.join(", ")}</p>
            <p className="mt-1 line-clamp-2 text-caption text-muted">Licence: {tr.license}</p>
          </div>
          {tr.url ? <audio controls preload="none" src={proxied(tr.url)} className="h-11 w-full md:w-64" aria-label={`Preview ${tr.title}`} /> : <span className="text-caption text-muted">No file</span>}
          <div className="flex items-center gap-2">
            <StatusChip tone={tr.active ? "attending" : "neutral"}>{tr.active ? "Active" : "Hidden"}</StatusChip>
            {canEdit && <Button size="sm" variant="outline" onClick={() => toggle(tr)}>{tr.active ? "Hide" : "Make active"}</Button>}
          </div>
        </li>
      ))}
    </ul>
  );
}
function ReviewsList({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const r = useAsync(() => api<{ items: AdminReview[] }>("/api/admin/reviews"));
  async function patch(rv: AdminReview, body: Partial<AdminReview>) {
    try { await api(`/api/admin/reviews/${rv.id}`, { method: "PATCH", body }); toast("Review updated"); r.reload(true); } catch (e) { toast(msg(e), "error"); }
  }
  if (r.loading && !r.data) return <LoadingBlock rows={3} />;
  if (r.error) return <ErrorState error={r.error} onRetry={() => r.reload()} />;
  return (
    <>
      <Notice className="mb-4">Publish real reviews only with the customer&apos;s consent. Placeholder copy must stay marked as a sample, and it&apos;s labelled that way on the site.</Notice>
      {!r.data!.items.length ? <EmptyState title="No reviews" body="The reviews section on the home page stays hidden until one is published." /> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {r.data!.items.map((rv) => (
            <li key={rv.id} className="card flex flex-col gap-3 p-4">
              <p className="flex flex-wrap items-center gap-2">
                <StatusChip tone={rv.published ? "attending" : "neutral"}>{rv.published ? "Published" : "Hidden"}</StatusChip>
                {rv.isSample && <span className="status info">Sample review</span>}
              </p>
              <blockquote className="text-body-sm">“{rv.text}”</blockquote>
              <p className="text-caption text-muted">{rv.displayName}{rv.location ? ` · ${rv.location}` : ""} · {formatDate(rv.createdAt, { dateStyle: "medium" })}</p>
              {canEdit && (
                <div className="mt-auto flex flex-col gap-3 border-t border-line pt-3">
                  <Toggle checked={rv.published} onChange={(v) => patch(rv, { published: v })} label="Show on the home page" />
                  <Toggle checked={rv.isSample} onChange={(v) => patch(rv, { isSample: v })} label="Sample review (placeholder copy)" />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ───────────── Team (A-08, admin only) ───────────── */
export function TeamPage() {
  const { me } = useSession();
  const toast = useToast();
  const [role, setRole] = useState<"" | "staff" | "admin" | "host">("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [invite, setInvite] = useState(false);
  const [reset, setReset] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const p = usePaged<User>("/api/admin/users", { role: role || undefined, q: dq || undefined });
  if (me && me.role !== "admin") return <EmptyState icon={<IconUsers />} title="Admins only" body="Ask a studio admin to change team members or roles." />;
  async function patch(u: User, body: Partial<User>) {
    try { await api(`/api/admin/users/${u.id}`, { method: "PATCH", body }); toast("Saved"); p.reload(); } catch (e) { toast(msg(e), "error"); }
  }
  async function sendReset() {
    if (!reset) return;
    setBusy(true);
    try { await api(`/api/admin/users/${reset.id}/send-reset`, { method: "POST" }); toast(`Reset link emailed to ${reset.email}`); setReset(null); } catch (e) { toast(msg(e), "error"); } finally { setBusy(false); }
  }
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Team" subtitle="Designers and admins. Passwords are never visible here; people set their own from an emailed link." actions={<Button onClick={() => setInvite(true)}><IconPlus size={18} />Invite</Button>} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <ScrollFade><Segmented label="Role" value={role} onChange={setRole} options={[{ value: "", label: "Everyone" }, { value: "staff", label: "Designers" }, { value: "admin", label: "Admins" }, { value: "host", label: "Hosts" }]} /></ScrollFade>
        <div className="relative flex-1 sm:max-w-sm"><IconSearch size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><label htmlFor="uq" className="sr-only">Search people</label><input id="uq" type="search" className={inputCls + " pl-10"} placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {p.loading && !p.items.length ? <LoadingBlock rows={3} /> : p.error ? <ErrorState error={p.error} onRetry={p.reload} /> : p.items.length === 0 ? <EmptyState icon={<IconUsers />} title="Nobody here" body="Invite a designer to get started." /> : (
        <Table label="People" head={["Person", "Role", "Last sign-in", "Status", ""]} min={760}>
          {p.items.map((u) => {
            const self = u.id === me?.user.id;
            return (
              <tr key={u.id} className={cx(u.disabled && "opacity-70")}>
                <td className="px-4 py-3"><span className="block font-semibold">{u.name ?? "—"}{self && <span className="text-muted"> (you)</span>}</span><span className="text-caption text-muted">{u.email}</span></td>
                <td className="px-4 py-3">
                  <label className="sr-only" htmlFor={`r-${u.id}`}>Role for {u.email}</label>
                  <select id={`r-${u.id}`} className={selectCls + " h-11 w-40"} value={u.role} disabled={self} onChange={(e) => patch(u, { role: e.target.value as User["role"] })}>
                    <option value="staff">Designer</option><option value="admin">Admin</option><option value="host">Host</option>
                  </select>
                </td>
                <td className="px-4 py-3">{u.lastLoginAt ? relTime(u.lastLoginAt) : <span className="text-muted">{u.hasPassword ? "Never" : "Hasn't set a password"}</span>}</td>
                <td className="px-4 py-3"><StatusChip tone={u.disabled ? "declined" : "attending"}>{u.disabled ? "Disabled" : "Active"}</StatusChip></td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setReset(u)}><IconSend size={16} />Reset link</Button>
                    {!self && <Button size="sm" variant="ghost" className={u.disabled ? "" : "text-danger"} onClick={() => patch(u, { disabled: !u.disabled })}>{u.disabled ? "Enable" : "Disable"}</Button>}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
      <More p={p} />
      <InviteDialog open={invite} onClose={() => setInvite(false)} onDone={() => { setInvite(false); p.reload(); }} />
      <Dialog open={!!reset} onClose={() => setReset(null)} title="Send a password reset link?" footer={<><Button variant="ghost" onClick={() => setReset(null)}>Cancel</Button><Button loading={busy} onClick={sendReset}>Send link</Button></>}>
        <p className="text-sm">We&apos;ll email {reset?.email} a one-time link to choose a new password. You never see or set it.</p>
      </Dialog>
    </div>
  );
}
function InviteDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ email: "", name: "", role: "staff" as "staff" | "admin" });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF({ email: "", name: "", role: "staff" }); setErr({}); } }, [open]);
  async function submit() {
    if (!/^\S+@\S+\.\S+$/.test(f.email)) { setErr({ email: "Enter a work email." }); return; }
    setBusy(true);
    try { await api("/api/admin/users", { body: { email: f.email.trim(), name: f.name.trim() || undefined, role: f.role } }); toast(`Invite sent to ${f.email}`); onDone(); }
    catch (e) { if (e instanceof ApiError && e.fields) setErr(e.fields); toast(msg(e), "error"); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Invite to the studio" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}><IconMail size={16} />Send invite</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Email" error={err.email} required>{(p) => <input {...p} type="email" className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="Name" optional>{(p) => <input {...p} className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Role" hint="Designers see only the events assigned to them.">{(p) => <select {...p} className={selectCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as "staff" | "admin" })}><option value="staff">Designer</option><option value="admin">Admin</option></select>}</Field>
      </div>
    </Dialog>
  );
}

/* ───────────── Email log (A-09) ───────────── */
export function MessagesPage() {
  const [status, setStatus] = useState("");
  const [template, setTemplate] = useState("");
  const dt = useDebounced(template);
  const p = usePaged<Message>("/api/admin/messages", { status: status || undefined, template: dt || undefined });
  const tone = (s: string) => (["sent", "delivered", "opened"].includes(s) ? "attending" : ["failed", "bounced"].includes(s) ? "declined" : "pending") as "attending" | "declined" | "pending";
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Emails" subtitle="Everything the platform sent, newest first. Links and tokens are never stored here." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="ms">Status</label>
        <select id="ms" className={selectCls + " sm:w-48"} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{["queued", "sending", "sent", "delivered", "opened", "failed", "bounced"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
        <label className="sr-only" htmlFor="mt">Template</label>
        <input id="mt" className={inputCls + " sm:max-w-xs"} placeholder="Template, e.g. draft_ready" value={template} onChange={(e) => setTemplate(e.target.value)} />
      </div>
      {p.loading && !p.items.length ? <LoadingBlock rows={4} /> : p.error ? <ErrorState error={p.error} onRetry={p.reload} /> : p.items.length === 0 ? <EmptyState icon={<IconMail />} title="No emails match" /> : (
        <Table label="Emails" head={["When", "To", "Template", "Status", "Provider"]}>
          {p.items.map((m) => (
            <tr key={m.id}>
              <td className="tabular whitespace-nowrap px-4 py-3">{formatDate(m.sentAt ?? m.createdAt, { dateStyle: "medium", timeStyle: "short" })}</td>
              <td className="max-w-[260px] truncate px-4 py-3">{m.to}</td>
              <td className="px-4 py-3">{humanize(m.template)}</td>
              <td className="px-4 py-3"><StatusChip tone={tone(m.status)}>{humanize(m.status)}</StatusChip>{m.error && <span className="mt-1 block text-caption text-danger">{m.error}</span>}</td>
              <td className="px-4 py-3">{m.provider === "console" ? "Dev console (not sent)" : humanize(m.provider)}</td>
            </tr>
          ))}
        </Table>
      )}
      <More p={p} />
    </div>
  );
}
