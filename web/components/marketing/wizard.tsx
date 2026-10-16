"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { countExtras, isOfferedExtra, themeFits, type Catalogue } from "@/lib/types";
import { humanize, money, t, uuid } from "@/lib/format";
import { Logo } from "@/components/brand";
import { ThemeCard } from "./theme-card";
import { Button, ErrorState, Field, LoadingBlock, Notice, cx, inputCls, textareaCls } from "@/components/ui/primitives";
import { IconCheck, IconPlus, IconX } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

type Quote = { lines: { kind: string; code: string; label: string; qty: number; unitPriceCents: number; totalCents: number }[]; subtotalCents: number; currency: string; taxNote: string };
type Info = { partner1: string; partner2: string; honoree: string; eventDate: string; venue: string; email: string; phone: string; message: string };
const STEP_LABEL: Record<string, string> = { theme: "Style", sections: "Sections", extras: "Extras", languages: "Languages", vision: "Your vision", info: "Details", summary: "Review" };

export function CheckoutWizard() {
  const sp = useSearchParams();
  const planCode = sp.get("plan") ?? "experience";
  const toast = useToast();
  const cat = useAsync(() => api<Catalogue>("/api/public/catalogue"));
  const plan = cat.data?.plans.find((p) => p.code === planCode);
  const steps = useMemo(() => plan?.steps ?? [], [plan]);
  const [step, setStep] = useState(0);
  const draftId = useRef<string>("");
  const [themeKey, setThemeKey] = useState<string>("");
  const [sections, setSections] = useState<string[]>(["our_story", "timeline", "faq"]);
  const [custom, setCustom] = useState("");
  const [extras, setExtras] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>(["en"]);
  const [vision, setVision] = useState("");
  const [info, setInfo] = useState<Info>({ partner1: "", partner2: "", honoree: "", eventDate: "", venue: "", email: "", phone: "", message: "" });
  const [consents, setConsents] = useState({ terms: false, privacy: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    draftId.current = sessionStorage.getItem("checkout-draft") ?? uuid();
    sessionStorage.setItem("checkout-draft", draftId.current);
  }, []);

  const themes = useMemo(() => (cat.data?.themes ?? []).filter((x) => themeFits(x, plan?.product)), [cat.data, plan]);
  const isPerson = plan?.product === "birthday" || plan?.product === "bridesmaid";
  const selection = useMemo(
    () => ({ plan: planCode, themeKey: steps.includes("theme") ? themeKey || undefined : undefined, sections: plan?.usesSections || steps.includes("sections") ? sections : undefined, extras, languages }),
    [planCode, themeKey, sections, extras, languages, steps, plan],
  );

  // Live server-side quote
  useEffect(() => {
    if (!plan) return;
    if (steps.includes("theme") && !themeKey) return setQuote(null);
    const ctrl = new AbortController();
    api<Quote>("/api/checkout/quote", { body: selection, signal: ctrl.signal }).then(setQuote).catch(() => {});
    return () => ctrl.abort();
  }, [selection, plan, steps, themeKey]);

  // Record the abandoned-cart draft on each step
  useEffect(() => {
    if (!plan || !draftId.current) return;
    api(`/api/checkout/drafts/${draftId.current}`, { method: "PUT", body: { ...selection, lastStep: steps[step], info: cleanInfo(info), vision: vision || undefined } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, plan]);

  if (cat.loading && !cat.data) return <Shell><LoadingBlock label="Loading plan" /></Shell>;
  if (cat.error) return <Shell><ErrorState error={cat.error} onRetry={() => cat.reload()} /></Shell>;
  if (!plan) return <Shell><ErrorState error={new Error("That plan doesn't exist.")} title="Plan not found" /></Shell>;
  if (plan.serviceMode === "self_serve")
    return <Shell><Notice>The self-serve plan is free to build. <Link className="font-semibold underline" href="/login?mode=register">Create your account</Link> and pay when you publish.</Notice></Shell>;

  const current = steps[step];
  const allowedExtras = (cat.data!.planExtras[plan.code] ?? []).map((c) => cat.data!.extras.find((e) => e.code === c)).filter(isOfferedExtra);
  const included = plan.includedBlocks;
  // Languages: the plan includes `maxLanguages`; each extra_language unit adds one (repeat the code in `extras`).
  const extraLang = allowedExtras.find((e) => e.code === "extra_language");
  const langUnits = extras.filter((x) => x === "extra_language").length;
  const langLimit = plan.maxLanguages + langUnits;
  function toggleLanguage(code: string) {
    const on = languages.includes(code);
    const next = on ? languages.filter((x) => x !== code) : [...languages, code];
    if (!on && next.length > langLimit) {
      if (!extraLang) return;
      setExtras((v) => [...v, "extra_language"]);
    }
    if (on) {
      const need = Math.max(0, next.length - plan!.maxLanguages);
      if (langUnits > need) setExtras((v) => { const i = v.lastIndexOf("extra_language"); return v.filter((_, j) => j !== i); });
    }
    setLanguages(next);
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (current === "theme" && !themeKey) e.theme = "Choose a style to continue.";
    if (current === "languages" && languages.length === 0) e.languages = "Choose at least one language.";
    if (current === "info") {
      if (isPerson) { if (!info.honoree.trim()) e.honoree = "Enter a name."; }
      else {
        if (!info.partner1.trim()) e.partner1 = "Enter the first name.";
        if (!info.partner2.trim()) e.partner2 = "Enter the second name.";
      }
      if (!info.eventDate) e.eventDate = "Choose the date.";
      if (!/^\S+@\S+\.\S+$/.test(info.email)) e.email = "Enter a valid email. We'll send your access link here.";
    }
    if (current === "summary") {
      if (!consents.terms) e.terms = "Please accept the terms.";
      if (!consents.privacy) e.privacy = "Please accept the privacy policy.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function pay() {
    if (!validate()) return;
    setPaying(true);
    try {
      const res = await api<{ url: string }>("/api/checkout/session", {
        body: { ...selection, draftId: draftId.current, vision: vision || undefined, info: cleanInfo(info), consents, promoCode: null },
        headers: { "Idempotency-Key": draftId.current },
      });
      window.location.href = res.url;
    } catch (err) {
      setPaying(false);
      if (err instanceof ApiError && err.fields) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.replace(/^info\./, ""), v])));
      toast(err instanceof Error ? err.message : "Checkout failed", "error");
    }
  }

  const next = () => { if (validate()) { setStep((s) => Math.min(s + 1, steps.length - 1)); window.scrollTo({ top: 0 }); } };
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <Shell
      title={t(plan.name)}
      total={quote ? money(quote.subtotalCents, quote.currency) : money(plan.basePriceCents)}
      stepper={
        <ol className="stepper min-w-[480px]" aria-label="Checkout progress">
          {steps.map((s, i) => (
            <li key={s} aria-current={i === step ? "step" : undefined} className={cx("step", i < step ? "done" : i === step ? "current" : "")}>
              <span className="dot tabular">{i < step ? <IconCheck size={16} /> : i + 1}</span>
              {STEP_LABEL[s] ?? humanize(s)}
            </li>
          ))}
        </ol>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); if (current === "summary") pay(); else next(); }} noValidate>
        {current === "theme" && (
          <fieldset>
            <legend className="font-display text-2xl">Choose your starting style</legend>
            <p className="mt-1 text-muted">You&apos;ll share the details after payment. This just tells the designer where to begin.</p>
            {errors.theme && <p role="alert" className="mt-3 text-sm font-medium text-danger">{errors.theme}</p>}
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {themes.map((th) => <ThemeCard key={th.key} theme={th} selected={themeKey === th.key} onSelect={() => setThemeKey(th.key)} />)}
            </div>
          </fieldset>
        )}

        {current === "sections" && (
          <fieldset>
            <legend className="font-display text-2xl">Which sections do you need?</legend>
            <p className="mt-1 text-muted">
              {included ? <>{included} sections are included. Each extra section is {money(plan.extraBlockPriceCents)}.</> : "Pick as many as you like."}
              <span className="tabular ml-2 rounded-sm bg-surface-2 px-2 py-0.5 text-sm font-semibold text-ink">{sections.length}{included ? ` / ${included}` : ""} chosen</span>
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {cat.data!.sections.map((s) => {
                const on = sections.includes(s.key);
                const over = included != null && !on && sections.length >= included;
                return (
                  <button key={s.key} type="button" aria-pressed={on} onClick={() => setSections((v) => (on ? v.filter((x) => x !== s.key) : [...v, s.key]))}
                    className={cx("chip", on && "is-on")}>
                    {on && <IconCheck size={16} />}{s.label}
                    {over && <span className="price">+{money(plan.extraBlockPriceCents)}</span>}
                  </button>
                );
              })}
              {sections.filter((s) => s.startsWith("custom:")).map((s) => (
                <span key={s} className="chip is-on">
                  {s.slice(7)}
                  <button type="button" aria-label={`Remove ${s.slice(7)}`} onClick={() => setSections((v) => v.filter((x) => x !== s))}><IconX size={14} /></button>
                </span>
              ))}
            </div>
            <div className="mt-5 flex max-w-md gap-2">
              <label htmlFor="custom-block" className="sr-only">Add your own section</label>
              <input id="custom-block" maxLength={60} className={inputCls} placeholder="Something else? e.g. Kids' corner" value={custom} onChange={(e) => setCustom(e.target.value)} />
              <Button type="button" variant="outline" disabled={!custom.trim()} onClick={() => { const name = custom.trim().slice(0, 60); const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); setSections((v) => (v.some((x) => x.startsWith("custom:") && slug(x.slice(7)) === slug(name)) ? v : [...v, `custom:${name}`])); setCustom(""); }}><IconPlus size={16} />Add</Button>
            </div>
          </fieldset>
        )}

        {current === "extras" && (
          <fieldset>
            <legend className="font-display text-2xl">Add a little extra</legend>
            <p className="mt-1 text-muted">All optional. You can skip this step.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {allowedExtras.map((e) => {
                const on = extras.includes(e!.code);
                const units = extras.filter((x) => x === e!.code).length;
                return (
                  <label key={e!.code} className={cx("relative flex cursor-pointer gap-3 rounded-card border p-4 transition", on ? "border-transparent bg-tint shadow-[inset_0_0_0_2px_var(--brand-primary)]" : "border-line bg-surface hover:bg-surface-2")}>
                    <input type="checkbox" className="mt-1 size-4 accent-[var(--brand-primary)]" checked={on} disabled={e!.code === "extra_language" && on && languages.length > plan.maxLanguages} onChange={() => setExtras((v) => (on ? v.filter((x) => x !== e!.code) : [...v, e!.code]))} />
                    <span className="flex-1"><span className="flex justify-between gap-2 font-semibold"><span>{t(e!.name)}</span><span className="tabular">{plan.includesAllExtras ? "Included" : e!.code === "extra_language" ? `+${money(e!.priceCents)} each${units > 1 ? ` · × ${units}` : ""}` : `+${money(e!.priceCents)}`}</span></span>
                      <span className="mt-1 block text-sm text-muted">{t(e!.description)}</span></span>
                  </label>
                );
              })}
            </div>
            {allowedExtras.some((e) => e!.code === "own_song") && <Notice className="mt-4">Music must be royalty-free or a track you hold the rights to. We&apos;ll confirm before publishing.</Notice>}
          </fieldset>
        )}

        {current === "languages" && (
          <fieldset>
            <legend className="font-display text-2xl">Which languages will your guests read?</legend>
            <p className="mt-1 text-muted">{plan.maxLanguages} included{extraLang ? <>; each extra language is {plan.includesAllExtras ? "included" : `+${money(extraLang.priceCents)}`}</> : null}. <span className="tabular font-semibold text-ink">{languages.length} / {Math.max(plan.maxLanguages, languages.length)}</span></p>
            {errors.languages && <p role="alert" className="mt-2 text-sm font-medium text-danger">{errors.languages}</p>}
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {cat.data!.languages.map((l) => {
                const on = languages.includes(l.code);
                const over = !on && languages.length >= plan.maxLanguages;
                const disabled = !on && languages.length >= langLimit && !extraLang;
                return (
                  <button key={l.code} type="button" disabled={disabled} aria-pressed={on} onClick={() => toggleLanguage(l.code)}
                    className={cx("rounded-md border px-3 py-3 text-left text-sm font-medium disabled:opacity-45", on ? "border-primary bg-primary text-on-primary" : "border-line bg-surface hover:bg-surface-2")}>
                    <span className="mr-2 font-mono text-xs uppercase opacity-75">{l.code}</span>{l.label}
                    {over && extraLang && !plan.includesAllExtras && <span className="block text-caption opacity-80">+{money(extraLang.priceCents)}</span>}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        {current === "vision" && (
          <div>
            <h2 className="font-display text-2xl">Tell us about your day</h2>
            <p className="mt-1 text-muted">Colours, places, a song, a feeling. Anything that helps the designer. You can also leave this for the brief.</p>
            <Field label="Your vision" optional className="mt-5" hint={`${vision.length} / 2000`}>
              {(p) => <textarea {...p} className={textareaCls + " min-h-40"} maxLength={2000} value={vision} onChange={(e) => setVision(e.target.value)} placeholder="A relaxed lakeside evening, sage and sand, string lights…" />}
            </Field>
          </div>
        )}

        {current === "info" && (
          <div>
            <h2 className="font-display text-2xl">The essentials</h2>
            <p className="mt-1 text-muted">We use your email to create your account. You&apos;ll get a one-time link to choose your password.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {isPerson ? (
                <Field label="Their name" required error={errors.honoree}>{(p) => <input {...p} className={inputCls} value={info.honoree} onChange={(e) => setInfo({ ...info, honoree: e.target.value })} />}</Field>
              ) : (
                <>
                  <Field label="First partner's name" required error={errors.partner1}>{(p) => <input {...p} autoComplete="given-name" className={inputCls} value={info.partner1} onChange={(e) => setInfo({ ...info, partner1: e.target.value })} />}</Field>
                  <Field label="Second partner's name" required error={errors.partner2}>{(p) => <input {...p} className={inputCls} value={info.partner2} onChange={(e) => setInfo({ ...info, partner2: e.target.value })} />}</Field>
                </>
              )}
              <Field label="Date" required error={errors.eventDate}>{(p) => <input {...p} type="date" className={inputCls} value={info.eventDate} onChange={(e) => setInfo({ ...info, eventDate: e.target.value })} />}</Field>
              <Field label="Venue" optional>{(p) => <input {...p} className={inputCls} value={info.venue} onChange={(e) => setInfo({ ...info, venue: e.target.value })} />}</Field>
              <Field label="Email" required error={errors.email}>{(p) => <input {...p} type="email" autoComplete="email" className={inputCls} value={info.email} onChange={(e) => setInfo({ ...info, email: e.target.value })} />}</Field>
              <Field label="Phone" optional>{(p) => <input {...p} type="tel" autoComplete="tel" className={inputCls} value={info.phone} onChange={(e) => setInfo({ ...info, phone: e.target.value })} />}</Field>
              {isPerson && (
                <Field label="Your message to them" optional className="sm:col-span-2">{(p) => <textarea {...p} className={textareaCls} value={info.message} onChange={(e) => setInfo({ ...info, message: e.target.value })} />}</Field>
              )}
            </div>
            {!isPerson && (info.partner1 || info.partner2) && (
              <p aria-live="polite" className="font-display mt-6 text-center text-3xl text-primary">{info.partner1 || "…"} <span className="text-accent-text">&amp;</span> {info.partner2 || "…"}</p>
            )}
          </div>
        )}

        {current === "summary" && (
          <div>
            <h2 className="font-display text-2xl">Review your order</h2>
            <dl className="mt-5 divide-y divide-line rounded-card border border-line bg-surface">
              <Row k="Plan" v={t(plan.name)} />
              {themeKey && <Row k="Style" v={t(themes.find((x) => x.key === themeKey)?.name)} />}
              {steps.includes("sections") && <Row k="Sections" v={sections.map((k) => (k.startsWith("custom:") ? k.slice(7) : cat.data!.sections.find((x) => x.key === k)?.label ?? humanize(k))).join(", ")} />}
              {extras.length > 0 && <Row k="Extras" v={Object.entries(countExtras(extras)).map(([c, n]) => `${t(cat.data!.extras.find((e) => e.code === c)?.name)}${n > 1 ? ` × ${n}` : ""}`).join(", ")} />}
              <Row k="Languages" v={languages.map((c) => cat.data!.languages.find((l) => l.code === c)?.label ?? c).join(", ")} />
              <Row k={isPerson ? "For" : "Couple"} v={isPerson ? info.honoree : `${info.partner1} & ${info.partner2}`} />
              <Row k="Date" v={info.eventDate ? new Date(info.eventDate + "T12:00:00").toLocaleDateString("en-CA", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : ""} />
              <Row k="Email" v={info.email} />
            </dl>
            {quote && (
              <table className="mt-5 w-full text-sm">
                <caption className="sr-only">Price breakdown</caption>
                <tbody>
                  {quote.lines.map((l) => (
                    <tr key={l.code + l.kind} className="border-b border-line"><td className="py-2">{l.label}{l.qty > 1 && ` × ${l.qty}`}</td><td className="tabular py-2 text-right">{money(l.totalCents, quote.currency)}</td></tr>
                  ))}
                  <tr><th scope="row" className="py-3 text-left">Subtotal</th><td className="tabular py-3 text-right text-lg font-bold">{money(quote.subtotalCents, quote.currency)}</td></tr>
                </tbody>
              </table>
            )}
            <p className="text-caption text-muted">{quote?.taxNote} Your invitation stays live until 60 days after your date.</p>
            <div className="mt-5 space-y-3">
              {(["terms", "privacy"] as const).map((k) => (
                <div key={k}>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5 size-4 accent-[var(--brand-primary)]" checked={consents[k]} onChange={(e) => setConsents({ ...consents, [k]: e.target.checked })} aria-invalid={!!errors[k]} />
                    <span>I accept the {k === "terms" ? "terms of service" : "privacy policy"} <span className="text-muted">(required)</span></span>
                  </label>
                  {errors[k] && <p className="ml-6 text-xs font-medium text-danger">{errors[k]}</p>}
                </div>
              ))}
            </div>
            <Notice className="mt-5">This is a test checkout. No card is charged.</Notice>
          </div>
        )}

        <div className="sticky bottom-0 -mx-4 mt-8 flex items-center justify-between gap-3 border-t border-line bg-canvas/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:px-0">
          <Button type="button" variant="ghost" onClick={back} disabled={step === 0}>Back</Button>
          {current === "summary" ? (
            <Button type="submit" variant="accent" size="lg" loading={paying}>Pay {quote ? money(quote.subtotalCents) : ""} &amp; start</Button>
          ) : (
            <Button type="submit" size="lg">Continue</Button>
          )}
        </div>
      </form>
    </Shell>
  );
}

function cleanInfo(i: Info) {
  const o: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(i)) if (v.trim()) o[k] = v.trim();
  return o;
}
function Row({ k, v }: { k: string; v?: string }) {
  return <div className="grid grid-cols-3 gap-3 px-4 py-3 text-sm"><dt className="text-muted">{k}</dt><dd className="col-span-2 font-medium">{v || "—"}</dd></div>;
}
function Shell({ children, title, total, stepper }: { children: React.ReactNode; title?: string; total?: string; stepper?: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4">
          <Logo height={24} />
          {title && <h1 className="truncate text-sm"><span className="font-semibold">{title}</span><span className="sr-only"> checkout</span>{total && <span className="tabular ml-3 rounded-sm bg-surface-2 px-2 py-1 font-semibold">{total}</span>}</h1>}
          <Link href="/pricing" className="grid size-11 place-items-center rounded-md text-muted hover:bg-surface-2" aria-label="Leave checkout"><IconX /></Link>
        </div>
        {stepper && <div tabIndex={0} role="region" aria-label="Checkout steps" className="mx-auto max-w-5xl overflow-x-auto px-4 pb-4 pt-1">{stepper}</div>}
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
