"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { AuthShell } from "./shell";
import { Button, Spinner } from "@/components/ui/primitives";

export function Unsubscribe() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"checking" | "ready" | "already" | "invalid" | "done" | "error">("checking");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!token) return setState("invalid");
    api<{ status: "ready" | "already" | "invalid" }>("/api/auth/unsubscribe", { query: { token } }).then((r) => setState(r.status)).catch(() => setState("error"));
  }, [token]);
  async function confirm() {
    setBusy(true);
    try {
      const r = await api<{ status: "done" | "already" | "invalid" }>("/api/auth/unsubscribe", { body: { token } });
      setState(r.status);
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  }
  const copy = {
    checking: ["Checking your link…", ""],
    ready: ["Stop invitation emails?", "You won't get reminders or updates about this event any more. You can still open the invitation from your link."],
    already: ["You're already unsubscribed", "We won't send you any more emails about this event."],
    done: ["You're unsubscribed", "Done. We won't email you about this event again."],
    invalid: ["This link isn't valid", "It may be incomplete. Try copying the full link from the email."],
    error: ["Something went wrong", "Please try again in a moment."],
  }[state];
  return (
    <AuthShell title={copy[0]} subtitle={copy[1]}>
      {state === "checking" && <Spinner label="Checking" />}
      {state === "ready" && <Button onClick={confirm} loading={busy} className="w-full">Unsubscribe</Button>}
    </AuthShell>
  );
}
