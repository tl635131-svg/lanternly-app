"use client";
// Add-on pickers shared by the new-draft wizard, the pay-to-publish dialog and the add-ons-only checkout (H-02b).
// Prices always come from the catalogue / server quote; nothing is hard-coded.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useEvent } from "@/lib/event-context";
import { humanize, money, t } from "@/lib/format";
import { REPEATABLE_EXTRAS, countExtras, isOfferedExtra, type Catalogue, type Extra } from "@/lib/types";
import { Button, Dialog, LoadingBlock, Notice, cx } from "@/components/ui/primitives";
import { IconCheck, IconLock, IconMinus, IconPlus } from "@/components/ui/icons";

export type Quote = { lines: { kind: string; code: string; label: string; qty: number; unitPriceCents?: number; totalCents: number }[]; subtotalCents: number; currency: string; taxNote?: string };
export type Lock = { min: number; reason: string };

/** Offered add-ons for a plan, in catalogue order. */
export function offeredFor(cat: Catalogue | undefined, plan: string | null | undefined): Extra[] {
  if (!cat || !plan) return [];
  return (cat.planExtras[plan] ?? []).map((c) => cat.extras.find((e) => e.code === c)).filter(isOfferedExtra);
}

/** Checkbox rows; `extra_language` gets a quantity stepper. Locked rows can't go below their minimum. */
export function ExtraPicker({ extras, value, onChange, locked = {}, owned = [], included = false, note, legend = "Add-ons" }: {
  extras: Extra[]; value: Record<string, number>; onChange: (v: Record<string, number>) => void;
  locked?: Record<string, Lock>; owned?: string[]; included?: boolean; note?: string; legend?: string;
}) {
  const set = (code: string, n: number) => { const v = { ...value }; if (n > 0) v[code] = n; else delete v[code]; onChange(v); };
  return (
    <fieldset>
      <legend className="text-sm font-semibold">{legend}</legend>
      <ul className="mt-2 flex flex-col gap-2">
        {extras.map((x) => {
          const n = value[x.code] ?? 0;
          const lock = locked[x.code];
          const min = lock?.min ?? 0;
          const repeat = REPEATABLE_EXTRAS.has(x.code);
          const have = owned.includes(x.code) && !repeat;
          const on = n > 0 || have;
          const id = `extra-${x.code}`;
          return (
            <li key={x.code} className={cx("rounded-md border p-3 text-sm transition", on ? "border-transparent bg-tint shadow-[inset_0_0_0_2px_var(--brand-primary)]" : "border-line bg-surface")}>
              <div className="flex items-start gap-3">
                {repeat ? (
                  <span className={cx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-sm border", on ? "border-primary bg-primary text-on-primary" : "border-line")} aria-hidden>{on && <IconCheck size={14} />}</span>
                ) : (
                  <input id={id} type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--brand-primary)]" checked={on} disabled={have || min > 0 || included} onChange={(e) => set(x.code, e.target.checked ? 1 : 0)} />
                )}
                <label htmlFor={repeat ? undefined : id} className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-semibold">{t(x.name)}</span>
                    <span className="tabular font-semibold">{included || have ? (have ? "Already yours" : "Included") : repeat ? `+${money(x.priceCents, x.currency)} each` : `+${money(x.priceCents, x.currency)}`}</span>
                  </span>
                  {x.description && <span className="mt-0.5 block text-caption text-muted">{t(x.description)}</span>}
                  {lock && <span className="mt-1 inline-flex items-center gap-1 text-caption font-semibold text-ink"><IconLock size={12} />{lock.reason}</span>}
                </label>
              </div>
              {repeat && !included && (
                <div className="mt-2 flex items-center justify-end gap-2" role="group" aria-label={`${t(x.name)} quantity`}>
                  <button type="button" className="grid size-11 place-items-center rounded-md border border-line bg-surface disabled:opacity-40" disabled={n <= min} onClick={() => set(x.code, n - 1)} aria-label={`One fewer ${t(x.name).toLowerCase()}`}><IconMinus size={16} /></button>
                  <output className="tabular w-8 text-center font-semibold" aria-live="polite">{n}</output>
                  <button type="button" className="grid size-11 place-items-center rounded-md border border-line bg-surface disabled:opacity-40" disabled={n >= 8} onClick={() => set(x.code, n + 1)} aria-label={`One more ${t(x.name).toLowerCase()}`}><IconPlus size={16} /></button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {note && <p className="mt-2 text-caption text-muted">{note}</p>}
    </fieldset>
  );
}

export function QuoteTable({ quote }: { quote: Quote }) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Price breakdown</caption>
      <tbody>
        {quote.lines.map((l) => <tr key={l.kind + l.code} className="border-b border-line"><td className="py-2">{l.label}{l.qty > 1 && ` × ${l.qty}`}</td><td className="tabular py-2 text-right">{money(l.totalCents, quote.currency)}</td></tr>)}
        <tr><th scope="row" className="py-2 text-left">Total before tax</th><td className="tabular py-2 text-right font-bold">{money(quote.subtotalCents, quote.currency)}</td></tr>
      </tbody>
    </table>
  );
}

type AddonState = { eventId: string; plan: string | null; paid: boolean; purchased: { code: string; qty: number }[]; included: string[]; available: { code: string; name: string | Record<string, string>; priceCents: number; currency: string; maxQty?: number }[]; missing: { code: string; qty: number }[] };

/** H-02b: buy add-ons for a paid event (self-serve or studio). The list comes from `GET /api/events/:id/addons`; `missing` (what the draft uses but isn't paid) is pre-ticked and locked. */
export function AddonsDialog({ open, onClose, need = {}, reason, languages }: { open: boolean; onClose: () => void; need?: Record<string, number>; reason?: string; languages?: string[] }) {
  const { event } = useEvent();
  const cat = useAsync(() => api<Catalogue>("/api/public/catalogue"));
  const state = useAsync(() => (open && event ? api<AddonState>(`/api/events/${event.id}/addons`) : Promise.resolve(null)), [open, event?.id]);
  const plan = cat.data?.plans.find((p) => p.code === event?.planCode);
  const extras = useMemo<Extra[]>(() => {
    const avail = state.data?.available;
    if (!avail) return offeredFor(cat.data, event?.planCode);
    return avail.filter((a) => isOfferedExtra(a)).map((a) => {
      const c = cat.data?.extras.find((x) => x.code === a.code);
      return { code: a.code, name: typeof a.name === "string" ? { en: a.name } : a.name, description: c?.description, priceCents: a.priceCents, currency: a.currency, available: true };
    });
  }, [state.data, cat.data, event?.planCode]);
  const required = useMemo(() => {
    const r: Record<string, number> = { ...need };
    // A language added after payment: always send the units the language list needs.
    if (languages && event) { const cap = event.maxLanguages ?? plan?.maxLanguages ?? languages.length; const n = Math.max(0, languages.length - cap); if (n) r.extra_language = Math.max(r.extra_language ?? 0, n); }
    for (const m of state.data?.missing ?? []) r[m.code] = Math.max(r[m.code] ?? 0, m.qty);
    return r;
  }, [state.data, need, languages, event, plan?.maxLanguages]);
  const reqKey = JSON.stringify(required);
  const [sel, setSel] = useState<Record<string, number>>({});
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { if (open) { setSel(JSON.parse(reqKey)); setErr(null); setNotice(null); } }, [open, reqKey]);
  const items = Object.entries(sel).filter(([, n]) => n > 0).map(([code, qty]) => ({ code, qty }));
  const itemsKey = JSON.stringify(items);
  useEffect(() => {
    if (!open || !event || !items.length) { setQuote(null); return; }
    let live = true;
    api<Quote>("/api/checkout/addons/quote", { body: { eventId: event.id, extras: items, ...(languages ? { languages } : {}) } })
      .then((q) => { if (live) { setQuote(q); setErr(null); } })
      .catch((e) => {
        if (!live) return;
        setQuote(null);
        const miss = missingFrom(e);
        if (miss && Object.entries(miss).some(([c, n]) => (sel[c] ?? 0) < n)) {
          setSel((v) => { const m = { ...v }; for (const [c, n] of Object.entries(miss)) m[c] = Math.max(m[c] ?? 0, n); return m; });
          setNotice(Object.entries(miss).map(([c, n]) => `${c === "extra_language" ? "Extra language" : humanize(c)}: ${n} needed for your languages`).join(" · "));
        } else setErr(addonErrorText(e));
      });
    return () => { live = false; };
  }, [open, event?.id, itemsKey, languages?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  async function pay() {
    if (!terms || !privacy) { setErr("Please accept both to continue."); return; }
    setBusy(true);
    setErr(null);
    const attempt = (list: { code: string; qty: number }[]) => api<{ url: string }>("/api/checkout/addons", {
      body: { eventId: event!.id, extras: list, ...(languages ? { languages } : {}), consents: { terms, privacy } },
      headers: { "Idempotency-Key": `addons-${event!.id}-${list.map((x) => `${x.code}x${x.qty}`).sort().join("+")}` },
    });
    try {
      let r: { url: string };
      try {
        r = await attempt(items);
      } catch (e) {
        // The server says more units are needed (402 with `missing`, or 422 on extras.extra_language): rebuild the cart once.
        const missing = missingFrom(e);
        if (!missing || !Object.keys(missing).length) throw e;
        const merged = { ...sel };
        for (const [c, n] of Object.entries(missing)) merged[c] = Math.max(merged[c] ?? 0, n);
        setSel(merged);
        r = await attempt(Object.entries(merged).filter(([, n]) => n > 0).map(([code, qty]) => ({ code, qty })));
      }
      window.location.href = r.url;
    } catch (e) {
      setBusy(false);
      setErr(addonErrorText(e));
    }
  }
  const locked = Object.fromEntries(Object.entries(required).map(([c, n]) => [c, { min: n, reason: "Needed for your changes" }]));
  const unpaid = state.data ? !state.data.paid : event ? !event.paid : false;
  const allIncluded = plan?.includesAllExtras && !extras.length;
  return (
    <Dialog open={open} onClose={onClose} title="Add extras" wide
      footer={<><Button variant="ghost" onClick={onClose}>Not now</Button><Button variant="accent" onClick={pay} loading={busy} disabled={!items.length || unpaid || allIncluded}>Continue to payment{quote ? ` · ${money(quote.subtotalCents, quote.currency)}` : ""}</Button></>}>
      {reason && <Notice tone="warning" className="mb-4">{reason}</Notice>}
      {(cat.loading && !cat.data) || (state.loading && !state.data) ? <LoadingBlock rows={3} label="Loading add-ons" /> : unpaid ? (
        <Notice>Add-ons are paid together with your plan. Pick them when you publish.</Notice>
      ) : allIncluded ? (
        <Notice>Your plan already includes every add-on. Nothing to buy.</Notice>
      ) : extras.length === 0 ? (
        <Notice>You already have every add-on available for your plan.</Notice>
      ) : (
        <>
          {notice && <Notice tone="warning" className="mb-3">{notice}</Notice>}
          <ExtraPicker extras={extras} value={sel} onChange={setSel} locked={locked} owned={(state.data?.purchased ?? []).map((p) => p.code)} legend="Choose what to add" />
          {quote && <div className="mt-4"><QuoteTable quote={quote} />{items.some((it) => (quote.lines.find((l) => l.code === it.code)?.qty ?? 0) < it.qty) && <p className="mt-1 text-caption text-muted">We adjusted the quantity to what you need.</p>}<p className="mt-1 text-caption text-muted">{quote.taxNote ?? "Tax calculated at checkout."}</p></div>}
          <div className="mt-4 space-y-1">
            <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-5 accent-[var(--brand-primary)]" checked={terms} onChange={(e) => setTerms(e.target.checked)} />I accept the terms of service</label>
            <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-5 accent-[var(--brand-primary)]" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />I accept the privacy policy</label>
          </div>
        </>
      )}
      {err && <p role="alert" className="mt-3 text-sm font-medium text-danger">{err}</p>}
      <Notice className="mt-4">Test mode: no card is charged. Your invitation stays live while you pay.</Notice>
    </Dialog>
  );
}

function addonErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "PLAN_NOT_PAID") return "Pay for your plan first. Add-ons can then be added at any time.";
    if (e.status === 409 && e.code === "CONFLICT") return "You already have one of these add-ons. Untick it and try again.";
    if (e.code === "FEATURE_DISABLED") return "Your own songs aren't available right now. Untick it to continue.";
    if (e.code === "INVALID_SELECTION") return `${e.message}. Check your choices and try again.`;
    if (e.status === 400 && /empty|nothing|extras/i.test(e.message)) return "Nothing left to buy: you already have what these changes need.";
  }
  return e instanceof Error ? e.message : "Checkout failed";
}

/** `details.missing[{code,qty}]` from 402 ADDON_PAYMENT_REQUIRED or 422 INVALID_SELECTION (too few add-on units). */
export function missingFrom(e: unknown): Record<string, number> | null {
  const a = addonNeed(e);
  if (a && Object.keys(a).length) return a;
  if (e instanceof ApiError && e.status === 422 && Array.isArray(e.details?.missing)) {
    const out: Record<string, number> = {};
    for (const m of e.details!.missing as { code: string; qty?: number }[]) out[m.code] = Math.max(out[m.code] ?? 0, m.qty ?? 1);
    return Object.keys(out).length ? out : null;
  }
  return null;
}

/** Parse `402 ADDON_PAYMENT_REQUIRED` (`details.missing[{code,qty}]`; older builds used `ADDON_REQUIRED` + `details.addon`). */
export function addonNeed(e: unknown): Record<string, number> | null {
  if (!(e instanceof ApiError) || e.status !== 402 || (e.code !== "ADDON_PAYMENT_REQUIRED" && e.code !== "ADDON_REQUIRED")) return null;
  const d = e.details ?? {};
  const out: Record<string, number> = {};
  if (Array.isArray(d.missing)) for (const m of d.missing as { code: string; qty?: number }[]) out[m.code] = Math.max(out[m.code] ?? 0, m.qty ?? 1);
  else if (typeof d.addon === "string") Object.assign(out, countExtras([d.addon]));
  return out;
}
