"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useEvent } from "@/lib/event-context";
import { useAsync, useCopy } from "@/lib/hooks";
import type { Invitee, InviteeLink } from "@/lib/types";
import { formatDate, humanize, initials, relTime } from "@/lib/format";
import { StatusChip, Button, ButtonLink, Card, Dialog, EmptyState, ErrorState, Field, LoadingBlock, Notice, PageHeader, cx, inputCls, selectCls } from "@/components/ui/primitives";
import { IconCheck, IconCopy, IconDownload, IconEdit, IconMail, IconPlus, IconQr, IconRefresh, IconSearch, IconTrash, IconUpload, IconUsers } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { ShareActions, langName } from "./share";

/** Delivery state uses the shared .status chips: neutral/info for delivery, attending for replied, declined for problems. */
const STATUS: Record<Invitee["status"], { label: string; tone: "neutral" | "info" | "attending" | "declined" }> = {
  not_sent: { label: "Not sent", tone: "neutral" }, sent: { label: "Sent", tone: "info" }, opened: { label: "Opened", tone: "info" },
  responded: { label: "Replied", tone: "attending" }, bounced: { label: "Bounced", tone: "declined" }, opted_out: { label: "Opted out", tone: "declined" },
};

export function GuestsPage() {
  const { event, canWrite } = useEvent();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(t); }, [q]);
  const list = useAsync(() => api<{ items: Invitee[]; nextCursor: string | null; counts: Record<string, number> }>(`/api/events/${event!.id}/invitees`, { query: { q: debounced, status, limit: 200 } }), [debounced, status, event?.id]);
  const [editing, setEditing] = useState<Invitee | "new" | null>(null);
  const [sharing, setSharing] = useState<Invitee | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Invitee | null>(null);
  const live = event!.invitation?.status === "published";
  const total = Object.values(list.data?.counts ?? {}).reduce((a, b) => a + b, 0);

  async function del(i: Invitee) {
    try {
      await api(`/api/events/${event!.id}/invitees/${i.id}`, { method: "DELETE" });
      toast(`${i.householdName ?? i.firstName} removed. Their link no longer works.`);
      setConfirmDel(null);
      list.reload(true);
    } catch (e) { toast(e instanceof Error ? e.message : "Failed", "error"); }
  }

  return (
    <div>
      <PageHeader
        title="Guest list"
        subtitle="Add households and send each one a personal link. We'll track who opened it and who replied."
        actions={canWrite && (
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}><IconUpload size={18} />Import</Button>
            <Button variant="outline" onClick={() => setEmailOpen(true)} disabled={!live} title={live ? undefined : "Publish your invitation first"}><IconMail size={18} />Email invites</Button>
            <Button onClick={() => setEditing("new")}><IconPlus size={18} />Add household</Button>
          </>
        )}
      />
      {event!.invitation && (
        <Card className="mb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">General link</h2>
              <p className="text-sm text-muted">One link for everyone, for group chats or a QR on a welcome sign. Replies won&apos;t be matched to a household.</p>
              <div className="mt-3 max-w-xl">{live ? <ShareActions url={event!.invitation.url} title={event!.title} qrBase={`/api/events/${event!.id}/qr`} /> : <Notice>Your links start working once the invitation is published.</Notice>}</div>
            </div>
          </div>
        </Card>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <IconSearch size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <label htmlFor="inv-q" className="sr-only">Search households</label>
          <input id="inv-q" type="search" placeholder="Search by name, household or email" className={inputCls + " pl-10"} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label htmlFor="inv-status" className="sr-only">Filter by status</label>
        <select id="inv-status" className={selectCls + " sm:w-48"} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses ({total})</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}{list.data?.counts[k] ? ` (${list.data.counts[k]})` : ""}</option>)}
        </select>
      </div>

      {list.loading && !list.data ? <LoadingBlock rows={5} /> : list.error ? <ErrorState error={list.error} onRetry={() => list.reload()} /> : list.data!.items.length === 0 ? (
        debounced || status ? <EmptyState title="No matches" body="Try a different search or status." /> :
          <EmptyState icon={<IconUsers />} title="Your guest list is empty" body="Add households one by one or import a spreadsheet. Each gets a personal link." action={canWrite && <div className="flex gap-2"><Button onClick={() => setEditing("new")}>Add household</Button><Button variant="outline" onClick={() => setImportOpen(true)}>Import</Button></div>} />
      ) : (
        <>
          {/* Table on desktop */}
          <div className="hidden overflow-hidden rounded-card border border-line bg-surface shadow-card md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Households</caption>
              <thead className="bg-surface-2 text-left text-caption font-semibold text-muted">
                <tr><th scope="col" className="px-4 py-3">Household</th><th scope="col" className="px-4 py-3">Contact</th><th scope="col" className="px-4 py-3">Seats</th><th scope="col" className="px-4 py-3">Status</th><th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.data!.items.map((i) => (
                  <tr key={i.id} className="hover:bg-surface-2/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span aria-hidden className="avatar">{initials(i.householdName ?? `${i.firstName} ${i.lastName ?? ""}`)}</span>
                        <span><span className="block font-semibold">{i.householdName ?? [i.firstName, i.lastName].filter(Boolean).join(" ")}</span>{i.householdName && <span className="text-caption text-muted">{[i.firstName, i.lastName].filter(Boolean).join(" ")}</span>}{i.groupLabel && <span className="tag ml-2">{humanize(i.groupLabel)}</span>}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{i.email || i.phone ? <><span className="block">{i.email}</span><span className="text-caption">{i.phone ?? ""}</span></> : <span className="text-caption italic text-ink-subtle">No contact</span>}</td>
                    <td className="tabular px-4 py-3">{i.maxPartySize}</td>
                    <td className="px-4 py-3"><StatusChip tone={STATUS[i.status].tone}>{STATUS[i.status].label}</StatusChip>{i.lastOpenedAt && <span className="mt-1 block text-caption text-muted">opened {relTime(i.lastOpenedAt)}</span>}</td>
                    <td className="px-4 py-3"><RowActions i={i} canWrite={canWrite} onShare={() => setSharing(i)} onEdit={() => setEditing(i)} onDelete={() => setConfirmDel(i)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Cards on mobile */}
          <ul className="flex flex-col gap-3 md:hidden">
            {list.data!.items.map((i) => (
              <li key={i.id} className="rounded-card border border-line bg-surface p-4 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-semibold">{i.householdName ?? [i.firstName, i.lastName].filter(Boolean).join(" ")}</p><p className="text-caption text-muted">{i.maxPartySize} seat{i.maxPartySize === 1 ? "" : "s"}{i.email ? ` · ${i.email}` : ""}</p></div>
                  <StatusChip tone={STATUS[i.status].tone}>{STATUS[i.status].label}</StatusChip>
                </div>
                <div className="mt-3"><RowActions i={i} canWrite={canWrite} onShare={() => setSharing(i)} onEdit={() => setEditing(i)} onDelete={() => setConfirmDel(i)} /></div>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-4 text-sm text-muted">Looking for who&apos;s coming? See <Link href={`/app/${event!.id}/replies`} className="font-semibold underline">Replies</Link>.</p>

      <InviteeDialog open={!!editing} invitee={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(true); }} />
      <ShareDialog invitee={sharing} onClose={() => setSharing(null)} onChanged={() => list.reload(true)} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); list.reload(true); }} />
      <EmailDialog open={emailOpen} onClose={() => setEmailOpen(false)} />
      <Dialog open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Remove household?" footer={<><Button variant="ghost" onClick={() => setConfirmDel(null)}>Cancel</Button><Button variant="danger" onClick={() => confirmDel && del(confirmDel)}>Remove</Button></>}>
        <p className="text-sm">Their personal link will stop working. Replies they already sent stay in your replies list.</p>
      </Dialog>
    </div>
  );
}

function RowActions({ i, canWrite, onShare, onEdit, onDelete }: { i: Invitee; canWrite: boolean; onShare: () => void; onEdit: () => void; onDelete: () => void }) {
  const { copied, copy } = useCopy();
  const name = i.householdName ?? i.firstName;
  return (
    <div className="flex items-center justify-end gap-1">
      <Button size="sm" variant="ghost" onClick={() => copy(i.personalUrl, i.id)} aria-label={`Copy personal link for ${name}`}>{copied === i.id ? <IconCheck size={16} className="text-success" /> : <IconCopy size={16} />}<span className="md:hidden lg:inline">{copied === i.id ? "Copied" : "Link"}</span></Button>
      <Button size="sm" variant="ghost" onClick={onShare} aria-label={`Share or QR for ${name}`}><IconQr size={16} /><span className="md:hidden lg:inline">Share</span></Button>
      {canWrite && <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${name}`}><IconEdit size={16} /></Button>}
      {canWrite && <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Remove ${name}`} className="text-danger"><IconTrash size={16} /></Button>}
    </div>
  );
}

function InviteeDialog({ open, invitee, onClose, onSaved }: { open: boolean; invitee: Invitee | null; onClose: () => void; onSaved: () => void }) {
  const { event } = useEvent();
  const toast = useToast();
  const blank = { firstName: "", lastName: "", householdName: "", email: "", phone: "", maxPartySize: 1, groupLabel: "", language: "", notes: "", knownCompanions: "" };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErr({});
    setF(invitee ? { firstName: invitee.firstName, lastName: invitee.lastName ?? "", householdName: invitee.householdName ?? "", email: invitee.email ?? "", phone: invitee.phone ?? "", maxPartySize: invitee.maxPartySize, groupLabel: invitee.groupLabel ?? "", language: invitee.language ?? "", notes: invitee.notes ?? "", knownCompanions: invitee.knownCompanions.map((c) => c.fullName).join(", ") } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invitee]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (!f.firstName.trim()) er.firstName = "Enter a first name.";
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) er.email = "That email doesn't look right.";
    if (f.maxPartySize < 1 || f.maxPartySize > 20) er.maxPartySize = "Between 1 and 20.";
    setErr(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    const body = {
      firstName: f.firstName.trim(), lastName: f.lastName.trim() || null, householdName: f.householdName.trim() || null, email: f.email.trim() || null, phone: f.phone.trim() || null,
      maxPartySize: Number(f.maxPartySize), groupLabel: f.groupLabel.trim() || null, language: f.language || null, notes: f.notes.trim() || null,
      knownCompanions: f.knownCompanions.split(",").map((s) => s.trim()).filter(Boolean).map((fullName) => ({ fullName })),
    };
    try {
      if (invitee) await api(`/api/events/${event!.id}/invitees/${invitee.id}`, { method: "PATCH", body });
      else await api(`/api/events/${event!.id}/invitees`, { body });
      toast(invitee ? "Household updated" : "Household added with a personal link");
      onSaved();
    } catch (e2) {
      if (e2 instanceof ApiError && e2.fields) setErr(e2.fields);
      toast(e2 instanceof Error ? e2.message : "Couldn't save", "error");
    } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title={invitee ? "Edit household" : "Add a household"} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="invitee-form" loading={busy}>{invitee ? "Save" : "Add household"}</Button></>}>
      <form id="invitee-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" required error={err.firstName}>{(p) => <input {...p} className={inputCls} value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />}</Field>
        <Field label="Last name" optional>{(p) => <input {...p} className={inputCls} value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />}</Field>
        <Field label="Household name" optional hint="Shown on the invitation, e.g. The Okafor family">{(p) => <input {...p} className={inputCls} value={f.householdName} onChange={(e) => setF({ ...f, householdName: e.target.value })} />}</Field>
        <Field label="Seats for this household" required error={err.maxPartySize} hint="Including the main guest">{(p) => <input {...p} type="number" min={1} max={20} className={inputCls} value={f.maxPartySize} onChange={(e) => setF({ ...f, maxPartySize: parseInt(e.target.value, 10) || 1 })} />}</Field>
        <Field label="Email" optional error={err.email}>{(p) => <input {...p} type="email" className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="Mobile" optional error={err.phone} hint="Used to pre-fill WhatsApp and text messages">{(p) => <input {...p} type="tel" className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
        <Field label="Group" optional hint="e.g. family, friends, work">{(p) => <input {...p} className={inputCls} value={f.groupLabel} onChange={(e) => setF({ ...f, groupLabel: e.target.value })} />}</Field>
        <Field label="Language" optional>{(p) => (
          <select {...p} className={selectCls} value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
            <option value="">Invitation default</option>
            {event!.languages.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        )}</Field>
        <Field label="Known companions" optional className="sm:col-span-2" hint="Comma-separated names, pre-filled on their reply form">{(p) => <input {...p} className={inputCls} value={f.knownCompanions} onChange={(e) => setF({ ...f, knownCompanions: e.target.value })} />}</Field>
        <Field label="Private notes" optional className="sm:col-span-2">{(p) => <input {...p} className={inputCls} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
      </form>
    </Dialog>
  );
}

function ShareDialog({ invitee, onClose, onChanged }: { invitee: Invitee | null; onClose: () => void; onChanged: () => void }) {
  const { event, canWrite } = useEvent();
  const toast = useToast();
  const [link, setLink] = useState<InviteeLink | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (!invitee) return;
    setLink(null); setErr(null);
    api<InviteeLink>(`/api/events/${event!.id}/invitees/${invitee.id}/link`).then(setLink).catch(setErr);
  }, [invitee, event]);
  async function markSent(channel: string) {
    if (!invitee || !canWrite) return;
    await api(`/api/events/${event!.id}/invitees/${invitee.id}/mark-sent`, { body: { channel } }).catch(() => {});
    onChanged();
  }
  async function rotate() {
    if (!invitee) return;
    try {
      await api(`/api/events/${event!.id}/invitees/${invitee.id}/rotate-token`, { method: "POST" });
      setLink(await api<InviteeLink>(`/api/events/${event!.id}/invitees/${invitee.id}/link`));
      toast("New link created. The old one no longer works.");
      onChanged();
    } catch (e) { toast(e instanceof Error ? e.message : "Failed", "error"); }
  }
  const name = invitee?.householdName ?? invitee?.firstName ?? "";
  return (
    <Dialog open={!!invitee} onClose={onClose} title={`Personal link · ${name}`} wide>
      {err ? <ErrorState error={err} /> : !link ? <LoadingBlock rows={2} /> : (
        <div className="grid gap-5 sm:grid-cols-[1fr_200px]">
          <div className="flex flex-col gap-4">
            <ShareActions url={link.url} title={event!.title} qrBase={`/api/events/${event!.id}/qr?inviteeId=${invitee!.id}`} />
            <Field label={`Message (${langName(link.language)})`} hint={invitee!.language && langName(invitee!.language) !== langName(link.language) ? `There's no ready-made ${langName(invitee!.language)} message yet, so this one is in ${langName(link.language)}. Feel free to rewrite it before sending.` : undefined}>{(p) => <textarea {...p} readOnly rows={3} className={inputCls + " h-auto py-2"} value={link.text} />}</Field>
            <div className="flex flex-wrap gap-2">
              {link.whatsappUrl && <ButtonLink href={link.whatsappUrl} target="_blank" rel="noopener noreferrer" variant="outline" size="sm" onClick={() => markSent("whatsapp")}>WhatsApp</ButtonLink>}
              {link.smsUrl && <ButtonLink href={link.smsUrl} variant="outline" size="sm" onClick={() => markSent("sms")}>Text message</ButtonLink>}
              {link.mailto && <ButtonLink href={link.mailto} variant="outline" size="sm" onClick={() => markSent("email")}>Email</ButtonLink>}
              {canWrite && <Button variant="ghost" size="sm" onClick={() => { markSent("link"); toast("Marked as sent"); }}><IconCheck size={16} />Mark as sent</Button>}
            </div>
            {canWrite && <button className="flex items-center gap-1.5 self-start text-sm text-muted underline hover:text-ink" onClick={rotate}><IconRefresh size={14} />Replace this link (the old one stops working)</button>}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/events/${event!.id}/qr?inviteeId=${invitee!.id}&format=svg`} alt={`QR code for ${name}'s personal link`} width={200} height={200} className="hidden rounded-md border border-line bg-white p-2 sm:block" />
        </div>
      )}
    </Dialog>
  );
}

type Preview = { rows: Record<string, unknown>[]; errors: { row: number; message: string; fields?: Record<string, string> }[]; valid: number; invalid: number };
function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { event } = useEvent();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setFile(null); setPreview(null); setErr(null); } }, [open]);
  async function check(f: File) {
    setFile(f); setBusy(true); setErr(null);
    const fd = new FormData(); fd.append("file", f);
    try {
      // Preview only: nothing is saved until commit=true.
      setPreview(await api<Preview>(`/api/events/${event!.id}/invitees/import`, { body: fd, query: { commit: false } }));
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't read that file"); } finally { setBusy(false); }
  }
  async function commit() {
    if (!file) return;
    setBusy(true);
    const fd = new FormData(); fd.append("file", file);
    try {
      const r = await api<{ created: number; errors: unknown[] }>(`/api/events/${event!.id}/invitees/import`, { body: fd, query: { commit: true } });
      toast(`${r.created} households added`);
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : "Import failed"); } finally { setBusy(false); }
  }
  const template = "data:text/csv;charset=utf-8," + encodeURIComponent("first name,last name,household,email,phone,language,party size,group,notes\nNadia,Rahman,,nadia@example.com,+14165550100,en,2,friends,\n");
  return (
    <Dialog open={open} onClose={onClose} title="Import households" wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={commit} loading={busy} disabled={!preview || preview.valid === 0}>Add {preview?.valid ?? 0} households</Button></>}>
      <p className="text-sm text-muted">Upload a CSV or Excel file. We recognise columns like first name, last name, household, email, phone, language, party size, group and notes.</p>
      <a href={template} download="guest-list-template.csv" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary underline"><IconDownload size={14} />Download a template</a>
      <div
        className="mt-4 flex flex-col items-center gap-2 rounded-card border-2 border-dashed border-line bg-surface-2/50 px-4 py-8 text-center"
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) check(f); }}
      >
        <IconUpload className="text-muted" />
        <p className="text-sm">{file ? file.name : "Drop a file here, or"}</p>
        <Button variant="outline" size="sm" onClick={() => input.current?.click()}>Choose file</Button>
        <input ref={input} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" aria-label="Choose a guest list file" onChange={(e) => { const f = e.target.files?.[0]; if (f) check(f); }} />
      </div>
      {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
      {preview && (
        <div className="mt-4">
          <p className="text-sm"><strong className="text-success">{preview.valid} ready</strong>{preview.invalid > 0 && <> · <strong className="text-danger">{preview.invalid} with problems</strong> (skipped)</>}</p>
          {preview.errors.length > 0 && (
            <ul className="mt-2 max-h-32 overflow-auto rounded-md bg-danger-soft p-3 text-xs text-danger">
              {preview.errors.map((e) => <li key={e.row}>Row {e.row}: {e.fields ? Object.entries(e.fields).map(([k, v]) => `${humanize(k)}: ${v}`).join("; ") : e.message}</li>)}
            </ul>
          )}
          {preview.rows.length > 0 && (
            <div className="mt-3 max-h-56 overflow-auto rounded-md border border-line">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-2 text-left"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Household</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Seats</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {preview.rows.slice(0, 50).map((r, i) => <tr key={i}><td className="px-3 py-1.5">{String(r.firstName ?? "")} {String(r.lastName ?? "")}</td><td className="px-3 py-1.5">{String(r.householdName ?? "")}</td><td className="px-3 py-1.5">{String(r.email ?? "")}</td><td className="px-3 py-1.5">{String(r.maxPartySize ?? 1)}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function EmailDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { event, canWrite } = useEvent();
  const toast = useToast();
  const [kind, setKind] = useState<"invite" | "reminder">("invite");
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const segment = kind === "invite" ? { statuses: ["not_sent"] } : { notResponded: true };
  useEffect(() => {
    if (!open) return;
    setCount(null);
    api<{ count: number }>(`/api/events/${event!.id}/campaigns/preview`, { body: { channel: "email", segment } }).then((r) => setCount(r.count)).catch(() => setCount(0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);
  const campaigns = useAsync(() => (open ? api<{ items: { id: string; kind: string; status: string; createdAt: string; scheduledAt?: string | null }[] }>(`/api/events/${event!.id}/campaigns`) : Promise.resolve({ items: [] })), [open]);
  async function send() {
    setBusy(true);
    try {
      await api(`/api/events/${event!.id}/campaigns`, { body: { kind, channel: "email", segment } });
      toast("Queued. Emails go out between 9 am and 9 pm in your time zone.");
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : "Couldn't queue emails", "error"); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Email your guests"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={send} loading={busy} disabled={!count}>Queue {count ?? "…"} email{count === 1 ? "" : "s"}</Button></>}>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">What to send</legend>
        {([["invite", "Invitation", "Households you haven't sent their link to yet"], ["reminder", "Gentle reminder", "Households who haven't replied"]] as const).map(([v, l, d]) => (
          <label key={v} className={cx("flex cursor-pointer gap-3 rounded-md border p-3", kind === v ? "border-primary bg-tint" : "border-line")}>
            <input type="radio" name="kind" checked={kind === v} onChange={() => setKind(v)} className="mt-1 accent-[var(--brand-primary)]" />
            <span><span className="block font-semibold">{l}</span><span className="text-sm text-muted">{d}</span></span>
          </label>
        ))}
      </fieldset>
      <p className="mt-3 text-sm text-muted">Only households with an email address who haven&apos;t opted out are included. Each email carries their personal link.</p>
      <Notice className="mt-3">Development mode: emails are logged by the server and never actually delivered.</Notice>
      {!!campaigns.data?.items.length && (
        <div className="mt-4">
          <p className="text-sm font-semibold">History</p>
          <ul className="mt-1 text-sm text-muted">{campaigns.data.items.slice(0, 5).map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-0.5">
              <span>{humanize(c.kind)} · {humanize(c.status)} · {formatDate(c.createdAt, { dateStyle: "medium" })}</span>
              {c.status === "scheduled" && canWrite && <Button type="button" size="sm" variant="ghost" onClick={async () => { try { await api(`/api/events/${event!.id}/campaigns/${c.id}/cancel`, { method: "POST" }); toast("Scheduled send canceled"); campaigns.reload(true); } catch (e) { toast(e instanceof Error ? e.message : "Couldn't cancel", "error"); } }}>Cancel</Button>}
            </li>
          ))}</ul>
        </div>
      )}
    </Dialog>
  );
}
