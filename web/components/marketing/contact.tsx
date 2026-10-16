"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Card, Field, Notice, inputCls, selectCls, textareaCls } from "@/components/ui/primitives";
import { IconCheck } from "@/components/ui/icons";
import { SiteFooter, SiteHeader } from "./chrome";

type Form = { name: string; email: string; topic: "general" | "partner" | "order" | "press"; message: string; consent: boolean; website: string };

export function ContactPage() {
  const [f, setF] = useState<Form>({ name: "", email: "", topic: "general", message: "", consent: false, website: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const [top, setTop] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  function validate() {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = "Please tell us your name.";
    if (!/^\S+@\S+\.\S+$/.test(f.email)) e.email = "Please enter a valid email.";
    if (f.message.trim().length < 5) e.message = "A few more words, please (at least 5 characters).";
    if (!f.consent) e.consent = "Please agree so we can reply to you.";
    setErr(e);
    return !Object.keys(e).length;
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTop(null);
    if (!validate()) return;
    setBusy(true);
    try {
      await api("/api/public/contact", { body: { name: f.name.trim(), email: f.email.trim(), topic: f.topic, message: f.message.trim(), consent: true, website: f.website } });
      setDone(true);
    } catch (e2) {
      if (e2 instanceof ApiError && e2.fields) setErr(e2.fields);
      setTop(e2 instanceof Error ? e2.message : "Something went wrong. Please try again.");
    } finally { setBusy(false); }
  }
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-2xl px-4 py-12 sm:py-16">
        <h1 className="font-display text-3xl sm:text-4xl">Say hello</h1>
        <p className="mt-2 text-muted">Questions about a plan, an order, or working together? We usually answer within one business day.</p>
        <Card className="mt-8">
          {done ? (
            <div className="py-6 text-center" role="status">
              <span className="mx-auto grid size-12 place-items-center rounded-full bg-success-soft text-success"><IconCheck size={24} /></span>
              <h2 className="mt-4 text-xl font-semibold">Thanks, {f.name.split(" ")[0]}!</h2>
              <p className="mt-1 text-muted">Your message is with us. We&apos;ll reply to {f.email}.</p>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
              {top && <Notice tone="danger" className="sm:col-span-2">{top}</Notice>}
              <Field label="Your name" required error={err.name}>{(p) => <input {...p} autoComplete="name" maxLength={100} className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
              <Field label="Email" required error={err.email}>{(p) => <input {...p} type="email" autoComplete="email" maxLength={255} className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
              <Field label="What's it about?" className="sm:col-span-2" error={err.topic}>{(p) => (
                <select {...p} className={selectCls} value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value as Form["topic"] })}>
                  <option value="general">A general question</option><option value="order">An existing order</option><option value="partner">Partnering with us</option><option value="press">Press</option>
                </select>
              )}</Field>
              <Field label="Message" required className="sm:col-span-2" error={err.message} hint={`${f.message.length} / 5000`}>{(p) => <textarea {...p} maxLength={5000} className={textareaCls + " min-h-36"} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />}</Field>
              <div className="sm:col-span-2">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 size-4 accent-[var(--brand-primary)]" checked={f.consent} aria-invalid={err.consent ? true : undefined} aria-describedby={err.consent ? "consent-err" : undefined} onChange={(e) => setF({ ...f, consent: e.target.checked })} />
                  <span>I agree that you can use these details to reply to my message.</span>
                </label>
                {err.consent && <p id="consent-err" className="mt-1 text-xs font-medium text-danger">{err.consent}</p>}
              </div>
              <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden"><label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></label></div>
              <div className="sm:col-span-2"><Button type="submit" loading={busy}>Send message</Button></div>
            </form>
          )}
        </Card>
      </main>
      <SiteFooter />
    </>
  );
}
