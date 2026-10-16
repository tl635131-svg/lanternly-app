"use client";
import { useEffect, useId, useState } from "react";
import { api, ApiError, proxied } from "@/lib/api";
import type { Companion, Guest, PublicInvitation } from "@/lib/types";
import { humanize, uuid } from "@/lib/format";
import { IconCalendar, IconCheck, IconPlus, IconMinus, IconTrash, IconAlert, IconSend, IconEdit, IconArrowLeft, IconHeart, IconCloud, IconSparkle } from "@/components/ui/icons";
import { fmtEventDate } from "./sections";
import { useIt } from "@/lib/invite-i18n";

export const DIETARY_LABEL: Record<string, string> = {
  gluten_free: "Gluten-free", lactose_free: "Lactose-free", vegetarian: "Vegetarian", vegan: "Vegan", nut: "Nut allergy", fruit: "Fruit allergy", other: "Other",
};

type Form = {
  fullName: string; email: string; attendance: "yes" | "no" | ""; primaryMeal: string; primaryDietary: string; dietaryTags: string[];
  companions: (Companion & { key: string })[]; extraEvents: Record<string, string>; answers: Record<string, string | boolean>; message: string; website: string;
};
const empty = (name = ""): Form => ({ fullName: name, email: "", attendance: "", primaryMeal: "", primaryDietary: "", dietaryTags: [], companions: [], extraEvents: {}, answers: {}, message: "", website: "" });
const fromGuest = (g: Partial<Guest>): Form => ({
  fullName: g.fullName ?? "", email: g.email ?? "", attendance: (g.attendance === "pending" ? "" : g.attendance) ?? "", primaryMeal: g.primaryMeal ?? "", primaryDietary: g.primaryDietary ?? "",
  dietaryTags: g.dietaryTags ?? [], companions: (g.companions ?? []).map((c) => ({ ...c, key: c.id ?? uuid() })), extraEvents: g.extraEvents ?? {},
  answers: (g.answers as Record<string, string | boolean>) ?? {}, message: g.message ?? "", website: "",
});


type Stored = { guestId: string; editToken?: string };
type Result = { attendance: "yes" | "no"; partySize: number; name: string; meals: string[]; email: string };

export function RsvpSection({ data, slug, personalToken, editLink, replyBy }: { data: PublicInvitation; slug: string; personalToken: string | null; editLink: Stored | null; replyBy?: string | null }) {
  const t = useIt();
  const r = data.rsvp!;
  const sec = (data.content.sections?.rsvp ?? {}) as { heading?: string; intro?: string; thankYouYes?: string; thankYouNo?: string };
  const storeKey = `rsvp:${slug}`;
  const [mode, setMode] = useState<"form" | "summary" | "done" | "loading">("loading");
  const [existing, setExisting] = useState<Partial<Guest> | null>(null);
  const [cred, setCred] = useState<Stored | null>(null);
  const [form, setForm] = useState<Form>(empty(data.invitee ? [data.invitee.firstName, data.invitee.lastName].filter(Boolean).join(" ") : ""));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [idemKey] = useState(() => uuid());

  // Decide initial mode: existing reply via personal link, edit link, or stored credential.
  useEffect(() => {
    (async () => {
      if (data.invitee?.existingResponse) {
        setExisting(data.invitee.existingResponse);
        setCred({ guestId: data.invitee.existingResponse.id! });
        setMode("summary");
        return;
      }
      const stored: Stored | null = editLink ?? (() => { try { return JSON.parse(localStorage.getItem(storeKey) ?? "null"); } catch { return null; } })();
      if (stored?.guestId && (stored.editToken || personalToken) && !data.invitation.demo) {
        try {
          const g = await api<Partial<Guest>>(`/api/public/invitations/${slug}/rsvps/${stored.guestId}`, { query: { editToken: stored.editToken, g: stored.editToken ? undefined : personalToken } });
          setExisting(g);
          setCred(stored);
          setMode("summary");
          return;
        } catch { /* stale credential: fall through to a new form */ }
      }
      setMode("form");
    })();
  }, [data, slug, personalToken, editLink, storeKey]);

  const maxComp = r.maxCompanions;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const clearErr = (k: string) => setErrors((e) => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; });

  function validate() {
    const e: Record<string, string> = {};
    if (!form.fullName.trim()) e.fullName = t.errName;
    if (!form.attendance) e.attendance = t.errAttendance;
    if (form.attendance === "yes") {
      if (r.requireEmail && !/^\S+@\S+\.\S+$/.test(form.email)) e.email = t.errEmailNeeded;
      if (r.mealOptions.length && !form.primaryMeal) e.primaryMeal = t.errMeal;
      form.companions.forEach((c, i) => {
        if (!c.fullName.trim()) e[`companions.${i}.fullName`] = t.errCompName;
        if (r.mealOptions.length && !c.meal) e[`companions.${i}.meal`] = t.errCompMeal;
      });
      for (const q of r.customQuestions) if (q.required && (form.answers[q.id] === undefined || (typeof form.answers[q.id] === "string" && !String(form.answers[q.id]).trim()))) e[`answers.${q.id}`] = q.type === "yes_no" ? t.errYesNo : t.errAnswer;
    } else if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) e.email = t.errEmail;
    setErrors(e);
    if (Object.keys(e).length) {
      setTopError(t.errCheck);
      setTimeout(focusFirstInvalid, 30);
    }
    return Object.keys(e).length === 0;
  }

  function payload() {
    const yes = form.attendance === "yes";
    return {
      fullName: form.fullName.trim(), email: form.email.trim() || null, attendance: form.attendance,
      primaryMeal: yes ? form.primaryMeal || null : null, primaryDietary: yes ? form.primaryDietary.trim() || null : null, dietaryTags: yes ? form.dietaryTags : [],
      companions: yes ? form.companions.map((c) => ({ type: c.type ?? "adult", fullName: c.fullName.trim(), meal: c.meal || null, dietary: c.dietary?.trim() || null })) : [],
      extraEvents: yes ? form.extraEvents : {}, answers: form.answers, message: form.message.trim() || null, language: data.lang, website: form.website,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTopError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      let partySize = 1 + (form.attendance === "yes" ? form.companions.length : 0);
      if (cred && existing) {
        await api(`/api/public/invitations/${slug}/rsvps/${cred.guestId}`, { method: "PATCH", body: { ...payload(), editToken: cred.editToken, g: cred.editToken ? undefined : personalToken ?? undefined } });
      } else {
        const res = await api<{ id: string; editToken: string; attendance: "yes" | "no"; partySize: number }>(`/api/public/invitations/${slug}/rsvps`, {
          body: { ...payload(), g: personalToken ?? undefined }, headers: { "Idempotency-Key": idemKey },
        });
        partySize = res.partySize;
        if (!data.invitation.demo) {
          const c = { guestId: res.id, editToken: res.editToken };
          localStorage.setItem(storeKey, JSON.stringify(c));
          setCred(c);
        }
      }
      setResult({ attendance: form.attendance as "yes" | "no", partySize, name: form.fullName.trim().split(" ")[0], meals: form.attendance === "yes" ? [form.primaryMeal, ...form.companions.map((c) => c.meal ?? "")].filter(Boolean) : [], email: form.email.trim() });
      setExisting({ ...payload(), attendance: form.attendance as "yes" | "no" } as Partial<Guest>);
      setMode("done");
      setTimeout(() => document.getElementById("s-rsvp")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
    } catch (err) {
      if (err instanceof ApiError && err.code === "ALREADY_RESPONDED") {
        setTopError(t.errAlready);
        try {
          const gid = String(err.details?.guestId);
          const g = await api<Partial<Guest>>(`/api/public/invitations/${slug}/rsvps/${gid}`, { query: { g: personalToken ?? undefined } });
          setExisting(g); setCred({ guestId: gid }); setForm(fromGuest(g));
        } catch { /* ignore */ }
      } else if (err instanceof ApiError && err.fields) {
        // e.g. `answers.shuttle` for an unanswered required question → shown inline under that question.
        setErrors(err.fields);
        setTopError(t.errCheck);
        setTimeout(focusFirstInvalid, 30);
      } else if (err instanceof ApiError && err.code === "RSVP_CLOSED") {
        setTopError(t.errClosed);
      } else setTopError(err instanceof Error ? err.message : t.errGeneric);
    } finally {
      setBusy(false);
    }
  }

  const heading = sec.heading || t.willYouJoin;
  const hosts = coupleFirstNames(data, t.theHosts);
  if (!r.open && mode !== "summary") {
    const reason = t.closed[r.closedReason ?? "closed"] ?? t.closed.closed;
    return (
      <Wrap>
        <h2 id="h-rsvp" className="inv-title">{heading}</h2>
        <div className="inv-card mt-4"><p className="inv-muted text-[14.5px]">{reason}{r.closedReason !== "preview" && t.stillReach}</p></div>
      </Wrap>
    );
  }

  if (mode === "loading") return <Wrap><h2 id="h-rsvp" className="inv-title">{heading}</h2><p role="status" className="inv-muted mt-3">{t.loading}</p></Wrap>;

  if (mode === "done" && result) {
    const yesR = result.attendance === "yes";
    return (
      <Wrap center>
        <div role="status">
          <div aria-hidden className="relative mx-auto mb-6 grid size-[84px] place-items-center rounded-full" style={{ background: "var(--inv-accent)", color: "var(--inv-on-accent)", boxShadow: "0 0 0 10px color-mix(in srgb, var(--inv-accent) 22%, transparent), 0 0 60px color-mix(in srgb, var(--inv-accent) 45%, transparent)" }}>
            {yesR ? <IconCheck size={36} /> : <IconHeart size={32} />}
          </div>
          <h2 id="h-rsvp" className="inv-title">{yesR ? t.seeYou(result.name) : t.missYou(result.name)}</h2>
          <p className="inv-muted mx-auto mt-2 max-w-xs text-[15px] leading-relaxed">{yesR ? sec.thankYouYes || t.thanksYes(hosts) : sec.thankYouNo || t.thanksNo}</p>
          {yesR && (
            <dl className="inv-card mt-6 text-left text-[14.5px]">
              <SumRow k={t.coming} v={t.seatsOf(result.partySize, Math.max(result.partySize, data.invitee?.maxPartySize ?? result.partySize))} />
              {result.meals.length > 0 && <SumRow k={t.dinner} v={result.meals.map(humanize).join(", ")} />}
              {data.event.eventDate && <SumRow k={t.when} v={fmtEventDate(data.event.eventDate, data.lang, "long")} />}
              {data.event.venueName && <SumRow k={t.where} v={data.event.venueName} />}
            </dl>
          )}
          {data.invitation.demo && <p className="inv-muted mt-3 text-[13px]">{t.demoNotSaved}</p>}
          <div className="mt-5 flex flex-col gap-2.5">
            {yesR && <a href={proxied(data.calendarUrl)} className="inv-btn w-full"><IconCalendar size={18} />{t.addToMyCalendar}</a>}
            <div className="grid grid-cols-2 gap-2.5">
              {cred && !data.invitation.demo ? <button type="button" className="inv-btn ghost" onClick={() => { setForm(fromGuest(existing ?? {})); setMode("form"); }}><IconEdit size={16} />{t.changeReply}</button> : <span />}
              <button type="button" className="inv-btn ghost" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><IconArrowLeft size={16} />{t.invitation}</button>
            </div>
            {!personalToken && <button type="button" className="inv-muted mt-1 min-h-11 text-[13px] underline underline-offset-4" onClick={() => { localStorage.removeItem(storeKey); setCred(null); setExisting(null); setForm(empty()); setMode("form"); }}>{t.replyForOther}</button>}
          </div>
          {result.email && !data.invitation.demo && <p className="inv-muted mt-5 text-[13px]">{t.confirmationTo(result.email)}</p>}
        </div>
      </Wrap>
    );
  }

  if (mode === "summary" && existing)
    return (
      <Wrap>
        <p className="inv-over">{t.yourReply}</p>
        <h2 id="h-rsvp" className="inv-title mt-2">{existing.attendance === "yes" ? t.youreComing : t.youCantCome}</h2>
        <dl className="inv-card mt-4 text-[14.5px]">
          <SumRow k={t.name} v={existing.fullName ?? ""} />
          <SumRow k={t.replyLabel} v={existing.attendance === "yes" ? t.comingSeats(existing.partySize ?? 1 + (existing.companions?.length ?? 0)) : t.cantCome} />
          {existing.companions && existing.companions.length > 0 && <SumRow k={t.with} v={existing.companions.map((c) => c.fullName).join(", ")} />}
          {existing.primaryMeal && <SumRow k={t.dinner} v={humanize(existing.primaryMeal)} />}
        </dl>
        {r.open ? (
          <button type="button" className="inv-btn mt-4 w-full" onClick={() => { setForm(fromGuest(existing)); setMode("form"); }}><IconEdit size={18} />{t.changeMyReply}</button>
        ) : (
          <p className="inv-muted mt-4 text-[14px]">{t.closedNoChanges}</p>
        )}
      </Wrap>
    );

  const yes = form.attendance === "yes";
  const seats = 1 + form.companions.length;
  const meals = r.mealOptions;
  const setComp = (key: string, patch: Partial<Form["companions"][number]>) => set("companions", form.companions.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  return (
    <section id="s-rsvp" aria-labelledby="h-rsvp" className="inv-sec">
      <div id="rsvp-form" className="scroll-mt-6" />
      {/* B7: the deadline is shown once, as the overline above the title */}
      {replyBy && <p className="inv-over">{t.replyBy(replyBy)}</p>}
      <h2 id="h-rsvp" className="inv-title mt-2">{data.invitee ? `${heading.replace(/\?$/, "")}, ${data.invitee.firstName}?` : heading}</h2>
      {(sec.intro || data.invitee) && (
        <p className="inv-muted mt-2 text-[14.5px] leading-relaxed">
          {sec.intro || t.householdOnly}{" "}
          {data.invitee && data.invitee.maxPartySize > 1 && t.seatsSavedShort(data.invitee.maxPartySize)}
        </p>
      )}
      <form onSubmit={submit} noValidate className="mt-6">
        {topError && <div role="alert" className="inv-card mb-4 flex gap-2 text-[14px]" style={{ boxShadow: "inset 0 0 0 1.5px #FF8A95" }}><IconAlert size={18} className="mt-0.5 shrink-0" />{topError}</div>}
        <IvField label={t.fullName} error={errors.fullName} required>{(p) => <input {...p} autoComplete="name" className="inv-input" value={form.fullName} onChange={(e) => { set("fullName", e.target.value); clearErr("fullName"); }} />}</IvField>

        <fieldset className="inv-field" aria-describedby={errors.attendance ? "att-err" : undefined}>
          <legend className="inv-label mb-[7px]">{t.canYouCome} <Req /></legend>
          <div role="radiogroup" aria-label={t.canYouCome} aria-invalid={errors.attendance ? true : undefined} className="inv-choice">
            {([["yes", t.yesL, t.yesS, IconSparkle], ["no", t.noL, t.noS, IconCloud]] as const).map(([v, l, sub, I]) => (
              <button key={v} type="button" role="radio" aria-checked={form.attendance === v} onClick={() => { set("attendance", v); clearErr("attendance"); }}>
                <I size={20} className="icon" />{l}<small>{sub}</small>
              </button>
            ))}
          </div>
          {errors.attendance && <p id="att-err" role="alert" className="inv-err"><IconAlert size={14} />{errors.attendance}</p>}
        </fieldset>

        {yes && (
          <>
            {maxComp > 0 && (
              <div className="inv-field">
                <span id="seats-l" className="inv-label">{t.howManySeats(1 + maxComp)}</span>
                <div className="inv-stepper" role="group" aria-labelledby="seats-l">
                  <span className="inv-muted text-[14px]">{t.adults(1 + form.companions.filter((c) => c.type !== "child").length)}{form.companions.some((c) => c.type === "child") ? ` · ${t.children(form.companions.filter((c) => c.type === "child").length)}` : ""}</span>
                  <span className="ctl">
                    <button type="button" aria-label={t.fewerSeat} disabled={seats <= 1} onClick={() => set("companions", form.companions.slice(0, -1))} className="disabled:opacity-40"><IconMinus size={16} /></button>
                    <output aria-live="polite" className="tabular w-5 text-center">{seats}</output>
                    <button type="button" aria-label={t.moreSeat} disabled={seats > maxComp} onClick={() => set("companions", [...form.companions, { key: uuid(), type: "adult", fullName: "", meal: "" }])} className="disabled:opacity-40"><IconPlus size={16} /></button>
                  </span>
                </div>
              </div>
            )}

            <div className="inv-card mb-4">
              <p className="mb-3 flex items-center justify-between text-[15px] font-bold" style={{ color: "var(--inv-head)" }}>{form.fullName || t.you}<span className="inv-muted text-[12.5px] font-medium">{t.you}</span></p>
              {meals.length > 0 && <MealPills label={t.dinner} value={form.primaryMeal} options={meals} error={errors.primaryMeal} onChange={(m) => { set("primaryMeal", m); clearErr("primaryMeal"); }} />}
              {r.allergyChecklist && r.dietaryTags.length > 0 && (
                <fieldset className="inv-field">
                  <legend className="inv-label mb-[7px]">{t.dietaryNeeds} <span className="opt">{t.optional}</span></legend>
                  <div className="flex flex-wrap gap-2">
                    {r.dietaryTags.map((d) => {
                      const on = form.dietaryTags.includes(d);
                      return <button key={d} type="button" role="checkbox" aria-checked={on} className="inv-pill" onClick={() => set("dietaryTags", on ? form.dietaryTags.filter((x) => x !== d) : [...form.dietaryTags, d])}>{t.diet[d] ?? humanize(d)}</button>;
                    })}
                  </div>
                </fieldset>
              )}
              <IvField label={t.allergiesNeeds} optional last>{(p) => <input {...p} className="inv-input" placeholder={t.allergiesEg} value={form.primaryDietary} onChange={(e) => set("primaryDietary", e.target.value)} />}</IvField>
            </div>

            {form.companions.map((c, i) => (
              <div key={c.key} className="inv-card mb-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-[15px] font-bold" style={{ color: "var(--inv-head)" }}>{c.fullName || (c.type === "child" ? t.child : t.guestN(i + 2))}</span>
                  <span className="flex items-center gap-1">
                    {r.allowChildren ? (
                      <span role="radiogroup" aria-label={t.guestAge(i + 2)} className="flex gap-1">
                        {(["adult", "child"] as const).map((ty) => <button key={ty} type="button" role="radio" aria-checked={(c.type ?? "adult") === ty} className="inv-pill !h-11 !px-3 !text-[12.5px]" onClick={() => setComp(c.key, { type: ty })}>{ty === "adult" ? t.adult : t.child}</button>)}
                      </span>
                    ) : <span className="inv-muted text-[12.5px]">{t.adult}</span>}
                    <button type="button" className="grid size-11 place-items-center rounded-md" aria-label={t.removeGuest(i + 2)} onClick={() => set("companions", form.companions.filter((x) => x.key !== c.key))}><IconTrash size={16} /></button>
                  </span>
                </div>
                <IvField label={c.type === "child" ? t.childName : t.name} error={errors[`companions.${i}.fullName`]} required>{(p) => <input {...p} className="inv-input" placeholder={t.firstName} value={c.fullName} onChange={(e) => { setComp(c.key, { fullName: e.target.value }); clearErr(`companions.${i}.fullName`); }} />}</IvField>
                {meals.length > 0 && <MealPills label={t.dinner} value={c.meal ?? ""} options={meals} error={errors[`companions.${i}.meal`]} onChange={(m) => { setComp(c.key, { meal: m }); clearErr(`companions.${i}.meal`); }} />}
                <IvField label={t.allergies} optional last>{(p) => <input {...p} className="inv-input" value={c.dietary ?? ""} onChange={(e) => setComp(c.key, { dietary: e.target.value })} />}</IvField>
              </div>
            ))}
            {errors.companions && <p role="alert" className="inv-err mb-4"><IconAlert size={14} />{errors.companions}</p>}
            {maxComp > 0 && form.companions.length < maxComp && r.allowChildren && (
              <button type="button" onClick={() => set("companions", [...form.companions, { key: uuid(), type: "child", fullName: "", meal: "" }])} className="inv-btn ghost mb-4"><IconPlus size={16} />{t.addChild}</button>
            )}

            {r.extraEvents.map((ev) => (
              <fieldset key={ev} className="inv-field">
                <legend className="inv-label mb-[7px]">{t.joinFor(humanize(ev).toLowerCase())}</legend>
                <div role="radiogroup" aria-label={humanize(ev)} className="flex flex-wrap gap-2">
                  {(["yes", "no"] as const).map((v) => <button key={v} type="button" role="radio" aria-checked={form.extraEvents[ev] === v} className="inv-pill" onClick={() => set("extraEvents", { ...form.extraEvents, [ev]: v })}>{v === "yes" ? t.yes : t.noThanks}</button>)}
                </div>
              </fieldset>
            ))}
          </>
        )}

        {r.customQuestions.map((q) =>
          q.type === "yes_no" ? (
            <fieldset key={q.id} className="inv-field" aria-describedby={errors[`answers.${q.id}`] ? `qerr-${q.id}` : undefined}>
              <legend className="inv-label mb-[7px]">{q.label} {q.required ? <Req /> : <span className="opt">{t.optional}</span>}</legend>
              <div role="radiogroup" aria-label={q.label} aria-required={q.required || undefined} aria-invalid={errors[`answers.${q.id}`] ? true : undefined} className="flex flex-wrap gap-2">
                {[true, false].map((v) => (
                  <button key={String(v)} type="button" role="radio" aria-checked={form.answers[q.id] === v} className="inv-pill" onClick={() => { set("answers", { ...form.answers, [q.id]: v }); clearErr(`answers.${q.id}`); }}>{v ? t.yes : t.no}</button>
                ))}
              </div>
              {errors[`answers.${q.id}`] && <p id={`qerr-${q.id}`} role="alert" className="inv-err"><IconAlert size={14} />{errors[`answers.${q.id}`]}</p>}
            </fieldset>
          ) : (
            <IvField key={q.id} label={q.label} optional={!q.required} required={q.required} error={errors[`answers.${q.id}`]}>
              {(p) => <input {...p} maxLength={1000} className="inv-input" value={String(form.answers[q.id] ?? "")} onChange={(e) => { set("answers", { ...form.answers, [q.id]: e.target.value }); clearErr(`answers.${q.id}`); }} />}
            </IvField>
          ),
        )}

        <IvField label={t.noteFor(hosts)} optional>{(p) => <textarea {...p} rows={3} className="inv-input" placeholder={t.noteEg} value={form.message} onChange={(e) => set("message", e.target.value)} />}</IvField>

        <IvField label={t.emailLabel} error={errors.email} required={yes && r.requireEmail} optional={!(yes && r.requireEmail)} hint={t.emailHint}>
          {(p) => <input {...p} type="email" autoComplete="email" className="inv-input" placeholder="you@example.com" value={form.email} onChange={(e) => { set("email", e.target.value); clearErr("email"); }} />}
        </IvField>

        {/* Honeypot: hidden from people and assistive tech */}
        <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set("website", e.target.value)} /></label>
        </div>

        <button type="submit" disabled={busy} className="inv-btn mt-2 w-full disabled:opacity-60">
          {busy ? t.sending : existing ? t.saveChanges : t.sendReply} {!busy && <IconSend size={18} />}
        </button>
        <p className="inv-muted mt-3 text-center text-[12.5px]">{t.sharedWith(hosts)}</p>
        {existing && <button type="button" className="inv-muted mt-2 min-h-11 w-full text-[14px] underline" onClick={() => setMode("summary")}>{t.cancel}</button>}
      </form>
    </section>
  );
}

function Wrap({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return <section id="s-rsvp" aria-labelledby="h-rsvp" className={"inv-sec" + (center ? " text-center" : "")}>{children}</section>;
}

/** Focus the first invalid control; for radio groups focus the checked (or first) option. */
function focusFirstInvalid() {
  const el = document.querySelector<HTMLElement>("#s-rsvp [aria-invalid=true]");
  if (!el) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return el.focus();
  (el.querySelector<HTMLElement>("[aria-checked=true]") ?? el.querySelector<HTMLElement>("button, input"))?.focus();
}

function coupleFirstNames(data: PublicInvitation, fallback: string) {
  const h = data.event.hostNames;
  return [h.partner1, h.partner2].filter(Boolean).join(" & ") || h.honoree || fallback;
}

function Req() {
  const t = useIt();
  return <><span aria-hidden style={{ color: "var(--inv-glow-text)" }}>*</span><span className="sr-only"> {t.required}</span></>;
}

function SumRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-3 first:pt-0 last:border-0 last:pb-0" style={{ borderColor: "var(--inv-line)" }}>
      <dt className="inv-muted">{k}</dt><dd className="text-right font-semibold" style={{ color: "var(--inv-head)" }}>{v}</dd>
    </div>
  );
}

function MealPills({ label, value, options, error, onChange }: { label: string; value: string; options: string[]; error?: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="inv-field">
      <span id={id} className="inv-label">{label} <Req /></span>
      <div role="radiogroup" aria-labelledby={id} aria-invalid={error ? true : undefined} aria-describedby={error ? id + "-e" : undefined} className="flex flex-wrap gap-2">
        {options.map((m) => <button key={m} type="button" role="radio" aria-checked={value === m} className="inv-pill" onClick={() => onChange(m)}>{humanize(m)}</button>)}
      </div>
      {error && <p id={id + "-e"} role="alert" className="inv-err"><IconAlert size={14} />{error}</p>}
    </div>
  );
}

function IvField({ label, error, hint, required, optional, last, children }: { label: string; error?: string; hint?: string; required?: boolean; optional?: boolean; last?: boolean; children: (p: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string; required?: boolean }) => React.ReactNode }) {
  const id = useId();
  const t = useIt();
  const d = [hint && id + "-h", error && id + "-e"].filter(Boolean).join(" ") || undefined;
  return (
    <div className="inv-field" style={last ? { marginBottom: 0 } : undefined}>
      <label htmlFor={id} className="inv-label">{label} {required && <Req />}{optional && <span className="opt"> {t.optional}</span>}</label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": d, required })}
      {hint && <p id={id + "-h"} className="inv-muted text-[12.5px]">{hint}</p>}
      {error && <p id={id + "-e"} role="alert" className="inv-err"><IconAlert size={14} />{error}</p>}
    </div>
  );
}
