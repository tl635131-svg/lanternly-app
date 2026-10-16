"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { fetchMe } from "@/lib/session";
import { money } from "@/lib/format";
import { AuthShell } from "./shell";
import { ButtonLink, Spinner } from "@/components/ui/primitives";
import { IconCheck } from "@/components/ui/icons";

type Verify = { valid: boolean; status: "pending_payment" | "paid" | "canceled" | "refunded" | "unknown"; order: { id: string; number: string; plan: string; subtotalCents: number; taxCents: number; totalCents: number; currency: string; eventId: string | null; kind?: "plan" | "addons"; extras?: string[] } | null };

export function CheckoutSuccess() {
  const sp = useSearchParams();
  const sid = sp.get("session_id");
  const [v, setV] = useState<Verify | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!sid) return;
    let tries = 0;
    let stop = false;
    const poll = async () => {
      try {
        const r = await api<Verify>(`/api/checkout/session/${encodeURIComponent(sid)}/verify`);
        if (stop) return;
        setV(r);
        if (r.status === "pending_payment" && tries++ < 8) setTimeout(poll, 1500);
        else if (r.status === "pending_payment") setTimedOut(true);
      } catch {
        if (!stop) setV({ valid: false, status: "unknown", order: null });
      }
    };
    poll();
    fetchMe().then((m) => setSignedIn(!!m)).catch(() => {});
    return () => { stop = true; };
  }, [sid]);

  if (!sid || (v && (!v.valid || v.status === "unknown" || v.status === "canceled")))
    return (
      <AuthShell title="We couldn't confirm this payment" subtitle="If you were charged, don't worry. Write to us with your order number and we'll sort it out.">
        <ButtonLink href="/pricing" variant="outline" className="w-full">Back to pricing</ButtonLink>
      </AuthShell>
    );
  if (!v || (v.status === "pending_payment" && !timedOut))
    return <AuthShell title="Confirming your payment…" subtitle="This takes a few seconds."><Spinner label="Confirming payment" /></AuthShell>;

  const o = v.order!;
  const selfServe = o.plan === "diy";
  const addons = o.kind === "addons";
  return (
    <AuthShell title={addons ? (v.status === "paid" ? "Extras added" : "Payment received") : v.status === "paid" ? "You're all set" : "Payment received"}>
      <div className="-mt-2 mb-5 grid size-14 place-items-center rounded-full bg-success-soft text-success"><IconCheck size={28} /></div>
      <p className="text-sm text-muted">Order <strong className="text-ink">{o.number}</strong> · {money(o.totalCents || o.subtotalCents, o.currency)}{o.taxCents ? ` incl. ${money(o.taxCents, o.currency)} tax` : ""}</p>
      {addons ? (
        <p className="mt-4 text-sm">Your add-ons are ready to use. Head back to your invitation to pick up where you left off{selfServe ? ", then press Publish changes" : ""}.</p>
      ) : selfServe ? (
        <p className="mt-4 text-sm">Publishing is now unlocked. Head back to your editor and press publish when you&apos;re ready.</p>
      ) : (
        <ol className="mt-5 space-y-3 text-sm">
          <li className="flex gap-3"><span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-on-primary">1</span>Check your inbox for a one-time link to choose your password. We never email passwords.</li>
          <li className="flex gap-3"><span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-on-primary">2</span>Fill in your brief: story, schedule, venue and the little details.</li>
          <li className="flex gap-3"><span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-on-primary">3</span>We design your draft, you review it, and we publish once you approve.</li>
        </ol>
      )}
      <div className="mt-6 flex flex-col gap-2">
        {signedIn && o.eventId ? <ButtonLink href={addons ? `/app/${o.eventId}/invitation` : `/app/${o.eventId}`} className="w-full">{addons ? "Back to my invitation" : "Go to my dashboard"}</ButtonLink> : <ButtonLink href="/login" className="w-full">Sign in</ButtonLink>}
        <ButtonLink href="/" variant="outline" className="w-full">Back to home</ButtonLink>
      </div>
    </AuthShell>
  );
}
