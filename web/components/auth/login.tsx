"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError, setCsrf } from "@/lib/api";
import type { Me } from "@/lib/types";
import { landingFor } from "@/lib/session";
import { AuthShell } from "./shell";
import { Button, Field, Notice, inputCls } from "@/components/ui/primitives";

type Mode = "password" | "magic" | "forgot" | "register";

export function LoginForm() {
  const sp = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>((sp.get("mode") as Mode) || "password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<string | null>(null);

  const titles: Record<Mode, [string, string]> = {
    password: ["Welcome back", "Sign in to manage your invitation, guests and replies."],
    magic: ["Email me a sign-in link", "We'll send a one-time link that signs you in. It works for 20 minutes."],
    forgot: ["Reset your password", "We'll email you a link to choose a new password."],
    register: ["Start building, free", "Tell us your email. We'll send a one-time link to set your password. You'll only pay when you publish."],
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fe: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(email)) fe.email = "Enter a valid email address.";
    if (mode === "password" && !password) fe.password = "Enter your password.";
    setFieldErr(fe);
    if (Object.keys(fe).length) return;
    setBusy(true);
    try {
      if (mode === "password") {
        const me = await api<Me>("/api/auth/login", { body: { email, password } });
        setCsrf(me.csrfToken);
        const next = sp.get("next");
        router.replace(next && /^\/(?!\/)/.test(next) && !next.includes("\\") ? next : landingFor(me));
        return;
      }
      if (mode === "magic") await api("/api/auth/magic-link", { body: { email } });
      if (mode === "forgot") await api("/api/auth/password/forgot", { body: { email } });
      if (mode === "register") await api("/api/auth/register", { body: { email, name: name || undefined, locale: "en" } });
      setSent(email);
    } catch (err) {
      if (err instanceof ApiError && err.code === "INVALID_CREDENTIALS") setError("That email and password don't match. Try again, or use a sign-in link.");
      else setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <AuthShell title="Check your inbox" subtitle={<>If an account can use <strong className="text-ink">{sent}</strong>, a one-time link is on its way.</>}>
        <p className="text-sm text-muted">The link works once and expires soon. We never send passwords by email.</p>
        <Button variant="outline" className="mt-6 w-full" onClick={() => { setSent(null); setMode("password"); }}>Back to sign in</Button>
      </AuthShell>
    );

  const [title, subtitle] = titles[mode];
  return (
    <AuthShell title={title} subtitle={subtitle}>
      {sp.get("signedOut") && <Notice tone="success" className="mb-4">You&apos;ve signed out.</Notice>}
      {error && <div role="alert" className="mb-4 rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {mode === "register" && (
          <Field label="Your name" optional>{(p) => <input {...p} className={inputCls} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        )}
        <Field label="Email" required error={fieldErr.email}>
          {(p) => <input {...p} type="email" autoComplete="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        {mode === "password" && (
          <Field label="Password" required error={fieldErr.password}>
            {(p) => <input {...p} type="password" autoComplete="current-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
        )}
        <Button type="submit" size="lg" loading={busy} className="mt-1 w-full">
          {mode === "password" ? "Sign in" : mode === "register" ? "Send my set-password link" : "Send link"}
        </Button>
      </form>
      <div className="mt-5 flex flex-col gap-2 text-sm">
        {mode === "password" ? (
          <>
            <button type="button" className="min-h-11 text-left font-semibold text-accent-text hover:underline" onClick={() => setMode("magic")}>Email me a sign-in link instead</button>
            <button type="button" className="min-h-11 text-left text-muted hover:text-ink hover:underline" onClick={() => setMode("forgot")}>Forgot your password?</button>
            <p className="mt-2 text-muted">New here? <button type="button" className="tap-44 font-semibold text-ink underline" onClick={() => setMode("register")}>Start building free</button> or <Link className="tap-44 font-semibold text-ink underline" href="/pricing">see plans</Link>.</p>
          </>
        ) : (
          <button type="button" className="min-h-11 text-left font-semibold text-accent-text hover:underline" onClick={() => setMode("password")}>Back to sign in with a password</button>
        )}
      </div>
    </AuthShell>
  );
}
