"use client";
// H-01b: self-serve "New invitation" mini wizard. Steps come from the catalogue (`plans.diy.steps`:
// theme → extras → languages → info → summary). Nothing is charged here; add-ons are paid when publishing.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { humanize, money, t } from "@/lib/format";
import { countExtras, expandExtras, themeFits, type Catalogue, type EventT } from "@/lib/types";
import { Button, Dialog, Field, LoadingBlock, ErrorState, Notice, cx, inputCls } from "@/components/ui/primitives";
import { IconCheck } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { ThemeCard } from "@/components/marketing/theme-card";
import { ExtraPicker, QuoteTable, offeredFor, type Quote } from "./addons";

const PRODUCTS = [
  { value: "wedding_invite", label: "Wedding invitation" },
  { value: "save_the_date", label: "Save the date" },
  { value: "birthday", label: "Birthday" },
] as const;
type Product = (typeof PRODUCTS)[number]["value"];
const LABEL: Record<string, string> = { theme: "Style", extras: "Extras", languages: "Languages", info: "Details", summary: "Review" };
const SUGGESTED: Record<Product, string[]> = {
  wedding_invite: ["our_story", "timeline", "faq", "countdown"],
  save_the_date: ["countdown", "accommodation"],
  birthday: ["timeline", "countdown"],
};

export function NewDraftDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const cat = useAsync(() => api<Catalogue>("/api/public/catalogue"));
  const plan = cat.data?.plans.find((p) => p.code === "diy");
  const steps = plan?.steps?.length ? plan.steps : ["theme", "extras", "languages", "info", "summary"];
  const [step, setStep] = useState(0);
  const [product, setProduct] = useState<Product>("wedding_invite");
  const [themeKey, setThemeKey] = useState("");
  const [extras, setExtras] = useState<Record<string, number>>({});
  const [languages, setLanguages] = useState<string[]>(["en"]);
  const [f, setF] = useState({ partner1: "", partner2: "", honoree: "", eventDate: "", venueName: "", timezone: "America/Toronto" });
  const [sections, setSections] = useState<string[]>(SUGGESTED.wedding_invite);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);

  useEffect(() => { if (open) { setStep(0); setErr({}); } }, [open]);
  const themes = useMemo(() => (cat.data?.themes ?? []).filter((x) => themeFits(x, product) && x.status === "active"), [cat.data, product]);
  useEffect(() => { if (!themeKey && themes.length) setThemeKey((themes.find((x) => x.key === "meadow") ?? themes[0]).key); }, [themes, themeKey]);
  const offered = offeredFor(cat.data, "diy");
  const included = plan?.maxLanguages ?? 2;
  const extraLang = cat.data?.extras.find((x) => x.code === "extra_language");
  const canExtraLang = offered.some((x) => x.code === "extra_language");
  const neededExtraLangs = Math.max(0, languages.length - included);
  const limit = included + (extras.extra_language ?? 0);
  const list = expandExtras(extras);
  const person = product === "birthday";

  // The Extras stepper and the Languages tiles stay in sync: the stepper can't go below the languages in use.
  const setExtrasSynced = (v: Record<string, number>) => setExtras(v);
  const toggleLang = (code: string) => {
    const on = languages.includes(code);
    const next = on ? languages.filter((l) => l !== code) : [...languages, code];
    if (!on && next.length > limit && !canExtraLang) return;
    setLanguages(next);
    const need = Math.max(0, next.length - included);
    setExtras((x) => { const v = { ...x }; const cur = v.extra_language ?? 0; const n = on ? Math.min(cur, Math.max(need, cur - 1)) : Math.max(cur, need); if (n > 0) v.extra_language = n; else delete v.extra_language; return v; });
  };

  const current = steps[step];
  useEffect(() => {
    if (!open || current !== "summary") return;
    let live = true;
    api<Quote>("/api/checkout/quote", { body: { plan: "diy", themeKey: themeKey || undefined, extras: list, languages } }).then((q) => live && setQuote(q)).catch(() => live && setQuote(null));
    return () => { live = false; };
  }, [open, current, themeKey, list.join(","), languages.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (current === "languages" && !languages.length) e.languages = "Choose at least one language.";
    if (current === "info") {
      if (person) { if (!f.honoree.trim()) e.honoree = "Enter a name."; }
      else { if (!f.partner1.trim()) e.partner1 = "Enter a name."; if (!f.partner2.trim()) e.partner2 = "Enter a name."; }
    }
    setErr(e);
    return !Object.keys(e).length;
  }
  async function create() {
    setBusy(true);
    try {
      const ev = await api<EventT>("/api/events", {
        body: {
          product,
          hostNames: person ? { honoree: f.honoree.trim() } : { partner1: f.partner1.trim(), partner2: f.partner2.trim() },
          eventDate: f.eventDate || undefined, venueName: f.venueName || undefined, timezone: f.timezone || undefined,
          themeKey: themeKey || undefined, languages, extras: list, sections,
        },
      });
      toast("Your draft is ready");
      router.push(`/app/${ev.id}/invitation`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.fields) setErr(Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k.split(".").pop()!, v])));
      toast(e instanceof Error ? e.message : "Couldn't create the draft", "error");
    }
  }
  const next = () => { if (!validate()) return; if (current === "summary") create(); else setStep((s) => Math.min(s + 1, steps.length - 1)); };
  const nameOf = (code: string) => cat.data?.languages.find((l) => l.code === code)?.label ?? code.toUpperCase();

  return (
    <Dialog open={open} onClose={onClose} title="New invitation" wide
      footer={<>
        <Button variant="ghost" onClick={step === 0 ? onClose : () => setStep(step - 1)}>{step === 0 ? "Cancel" : "Back"}</Button>
        <Button onClick={next} loading={busy} disabled={!cat.data}>{current === "summary" ? "Create draft" : "Continue"}</Button>
      </>}>
      {cat.loading && !cat.data ? <LoadingBlock rows={3} label="Loading styles" /> : cat.error ? <ErrorState error={cat.error} onRetry={() => cat.reload()} /> : (
        <div>
          <ol className="stepper mb-5 overflow-x-auto" aria-label="New invitation steps">
            {steps.map((s, i) => (
              <li key={s} aria-current={i === step ? "step" : undefined} className={cx("step", i < step ? "done" : i === step ? "current" : "")}>
                <span className="dot tabular">{i < step ? <IconCheck size={14} /> : i + 1}</span>{LABEL[s] ?? humanize(s)}
              </li>
            ))}
          </ol>

          {current === "theme" && (
            <div className="flex flex-col gap-5">
              <fieldset>
                <legend className="text-sm font-semibold">What are you making?</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PRODUCTS.map((p) => (
                    <button key={p.value} type="button" aria-pressed={product === p.value} onClick={() => { setProduct(p.value); setSections(SUGGESTED[p.value]); }} className={cx("chip", product === p.value && "is-on")}>{product === p.value && <IconCheck size={16} />}{p.label}</button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-sm font-semibold">Pick a starting style <span className="font-normal text-muted">(you can change it any time)</span></legend>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {themes.map((th, i) => <ThemeCard key={th.key} theme={th} index={i} selected={themeKey === th.key} onSelect={() => setThemeKey(th.key)} />)}
                </div>
              </fieldset>
            </div>
          )}

          {current === "extras" && (
            <div>
              <p className="mb-3 text-sm text-muted">All optional. Nothing is charged now: add-ons are paid when you publish.</p>
              <ExtraPicker extras={offered} value={extras} onChange={setExtrasSynced} legend="Add a little extra"
                locked={neededExtraLangs ? { extra_language: { min: neededExtraLangs, reason: `You chose ${languages.length} languages` } } : {}}
                note={canExtraLang ? `Your plan includes ${included} languages. Each Extra language adds one more; it stays in step with the next screen.` : undefined} />
            </div>
          )}

          {current === "languages" && (
            <fieldset>
              <legend className="text-sm font-semibold">Which languages will your guests read?</legend>
              <p className="mt-1 text-sm text-muted"><span className="tabular font-semibold text-ink">{languages.length} / {included}</span> included{extraLang && canExtraLang ? ` · each extra language +${money(extraLang.priceCents, extraLang.currency)}` : ""}</p>
              {err.languages && <p role="alert" className="mt-2 text-sm font-medium text-danger">{err.languages}</p>}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {cat.data!.languages.map((l) => {
                  const on = languages.includes(l.code);
                  const over = !on && languages.length >= included;
                  const disabled = !on && languages.length >= limit && !canExtraLang;
                  return (
                    <button key={l.code} type="button" aria-pressed={on} disabled={disabled} onClick={() => toggleLang(l.code)}
                      className={cx("flex min-h-11 flex-col items-start rounded-md border px-3 py-2 text-left text-sm font-medium disabled:opacity-45", on ? "border-primary bg-primary text-on-primary" : "border-line bg-surface hover:bg-surface-2")}>
                      <span><span className="mr-1.5 font-mono text-xs uppercase opacity-75">{l.code}</span>{l.label}</span>
                      {over && extraLang && canExtraLang && <span className="text-caption opacity-80">+{money(extraLang.priceCents, extraLang.currency)}</span>}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {current === "info" && (
            <div className="grid gap-4 sm:grid-cols-2">
              {person ? (
                <Field label="Whose birthday?" required error={err.honoree} className="sm:col-span-2">{(p) => <input {...p} className={inputCls} value={f.honoree} onChange={(e) => setF({ ...f, honoree: e.target.value })} />}</Field>
              ) : (
                <>
                  <Field label="First name" required error={err.partner1}>{(p) => <input {...p} className={inputCls} value={f.partner1} onChange={(e) => setF({ ...f, partner1: e.target.value })} />}</Field>
                  <Field label="Second name" required error={err.partner2}>{(p) => <input {...p} className={inputCls} value={f.partner2} onChange={(e) => setF({ ...f, partner2: e.target.value })} />}</Field>
                </>
              )}
              <Field label="Date" optional error={err.eventDate}>{(p) => <input {...p} type="date" className={inputCls} value={f.eventDate} onChange={(e) => setF({ ...f, eventDate: e.target.value })} />}</Field>
              <Field label="Time zone" optional>{(p) => <input {...p} className={inputCls} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} />}</Field>
              <Field label="Venue" optional className="sm:col-span-2">{(p) => <input {...p} className={inputCls} value={f.venueName} onChange={(e) => setF({ ...f, venueName: e.target.value })} />}</Field>
              <fieldset className="sm:col-span-2">
                <legend className="text-sm font-semibold">Start with these sections <span className="font-normal text-muted">(optional)</span></legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {cat.data!.sections.map((s) => {
                    const on = sections.includes(s.key);
                    return <button key={s.key} type="button" aria-pressed={on} onClick={() => setSections((v) => (on ? v.filter((x) => x !== s.key) : [...v, s.key]))} className={cx("chip", on && "is-on")}>{on && <IconCheck size={16} />}{s.label}</button>;
                  })}
                </div>
              </fieldset>
            </div>
          )}

          {current === "summary" && (
            <div className="flex flex-col gap-4">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted">Making</dt><dd>{PRODUCTS.find((p) => p.value === product)?.label}</dd>
                <dt className="text-muted">Style</dt><dd>{t(themes.find((x) => x.key === themeKey)?.name) || "Choose later"}</dd>
                <dt className="text-muted">For</dt><dd>{person ? f.honoree : `${f.partner1} & ${f.partner2}`}</dd>
                <dt className="text-muted">Languages</dt><dd>{languages.map(nameOf).join(", ")}</dd>
                <dt className="text-muted">Add-ons</dt><dd>{list.length ? Object.entries(countExtras(list)).map(([c, n]) => `${t(cat.data!.extras.find((x) => x.code === c)?.name) || c}${n > 1 ? ` × ${n}` : ""}`).join(", ") : "None"}</dd>
              </dl>
              {quote && <div><QuoteTable quote={quote} /><p className="mt-1 text-caption text-muted">{quote.taxNote ?? "Tax calculated at checkout."}</p></div>}
              <Notice><strong className="font-semibold">Free to design.</strong> {plan ? money(plan.basePriceCents, plan.currency) : "The plan price"}{list.length ? " + selected add-ons" : ""} + tax when you publish.</Notice>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
