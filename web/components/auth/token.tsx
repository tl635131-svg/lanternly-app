"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError, setCsrf } from "@/lib/api";
import type { Me } from "@/lib/types";
import { landingFor } from "@/lib/session";
import { AuthShell } from "./shell";
import { Button, ButtonLink, Field, Spinner, cx, inputCls } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";

type Inspect = { valid: false } | { valid: true; purpose: "set_password" | "reset_password" | "login" | "cohost_invite"; email: string; requiresPassword: boolean; expiresAt: string; event: { id: string; title: string } | null };

export function passwordIssue(pw: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (!/[a-zA-Z]/.test(pw)) return "Include at least one letter.";
  if (!/[^a-zA-Z]/.test(pw)) return "Include a number or symbol.";
  return null;
}
export function strength(pw: string) {
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^a-zA-Z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}

export function TokenLanding() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<Inspect | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [name, setName] = useState("");
  const [fe, setFe] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const auto = useRef(false);

  async function consume(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const me = await api<Me>("/api/auth/token/consume", { body: { token, ...body } });
      setCsrf(me.csrfToken);
      router.replace(landingFor(me, me.joinedEventId));
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.code === "INVALID_TOKEN") setInfo({ valid: false });
      else if (e instanceof ApiError && e.fields?.password) setFe({ pw: e.fields.password });
      else setErr(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  useEffect(() => {
    api<Inspect>("/api/auth/token/inspect", { body: { token } })
      .then((r) => {
        setInfo(r);
        if (r.valid && !r.requiresPassword && !auto.current) {
          auto.current = true;
          consume({});
        }
      })
      .catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (err) return <AuthShell title="Something went wrong"><p role="alert" className="text-sm text-danger">{err}</p><ButtonLink href="/login" variant="outline" className="mt-6 w-full">Go to sign in</ButtonLink></AuthShell>;
  if (!info) return <AuthShell title="Checking your link…"><Spinner label="Checking link" /></AuthShell>;
  if (!info.valid)
    return (
      <AuthShell title="This link has expired" subtitle="One-time links work once and only for a short time. Request a fresh one below.">
        <div className="flex flex-col gap-2">
          <ButtonLink href="/login?mode=magic" className="w-full">Email me a new sign-in link</ButtonLink>
          <ButtonLink href="/login?mode=forgot" variant="outline" className="w-full">Reset my password</ButtonLink>
        </div>
      </AuthShell>
    );
  if (!info.requiresPassword) return <AuthShell title="Signing you in…"><Spinner label="Signing in" /></AuthShell>;

  const titles = {
    set_password: "Choose your password",
    reset_password: "Choose a new password",
    cohost_invite: info.event ? `Join ${info.event.title}` : "Join the event",
    login: "Choose your password",
  };
  const s = strength(pw);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const issue = passwordIssue(pw);
    if (issue) errs.pw = issue;
    if (pw !== pw2) errs.pw2 = "The passwords don't match.";
    setFe(errs);
    if (Object.keys(errs).length) return;
    consume({ password: pw, name: name || undefined });
  }
  return (
    <AuthShell title={titles[info.purpose]} subtitle={<>For <strong className="text-ink">{info.email}</strong>. This link expires {formatDate(info.expiresAt, { dateStyle: "medium", timeStyle: "short" }).replace(/\.$/, "")}.</>}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {info.purpose !== "reset_password" && (
          <Field label="Your name" optional>{(p) => <input {...p} className={inputCls} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        )}
        <Field label="New password" required error={fe.pw} hint="At least 10 characters, with letters and a number or symbol.">
          {(p) => <input {...p} type="password" autoComplete="new-password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} />}
        </Field>
        <div aria-hidden className="-mt-2 grid grid-cols-4 gap-1">
          {[0, 1, 2, 3].map((i) => <span key={i} className={cx("h-1.5 rounded-full", i < s ? (s >= 3 ? "bg-success" : "bg-accent") : "bg-surface-2")} />)}
        </div>
        <p className="sr-only" aria-live="polite">Password strength {["very weak", "weak", "fair", "good", "strong"][s]}</p>
        <Field label="Confirm password" required error={fe.pw2}>
          {(p) => <input {...p} type="password" autoComplete="new-password" className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} />}
        </Field>
        <Button type="submit" size="lg" loading={busy} className="w-full">Save password and continue</Button>
      </form>
      <p className="mt-4 text-center text-xs text-muted">Already set up? <Link href="/login" className="tap-44 underline">Sign in</Link></p>
    </AuthShell>
  );
}
