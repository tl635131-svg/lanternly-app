"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { isOfferedExtra, type Catalogue, type Extra, type Plan } from "@/lib/types";
import { money, t } from "@/lib/format";
import { SiteFooter, SiteHeader } from "./chrome";
import { Badge, ButtonLink, ErrorState, Notice, Segmented, Skeleton, cx } from "@/components/ui/primitives";
import { IconCheck, IconHeart, IconSparkle, IconMusic, IconLantern, IconMail, IconClock, IconChevronDown, IconUsers } from "@/components/ui/icons";

const WEDDING = ["diy", "experience", "premium"];
const OTHER = ["std", "birthday", "bridesmaid"];
/** Icons per add-on code; unknown codes fall back to a sparkle. Names/prices always come from the API. */
const EXTRA_ICON: Record<string, typeof IconMusic> = { own_song: IconMusic, custom_monogram: IconLantern, extra_language: IconMail, photo_cover_film: IconSparkle, rush_design: IconClock };

export function PricingPage() {
  const sp = useSearchParams();
  const canceled = sp.get("checkout") === "canceled";
  const [tab, setTab] = useState<"wedding" | "other">("wedding");
  const cat = useAsync(() => api<Catalogue>("/api/public/catalogue"));
  const codes = tab === "wedding" ? WEDDING : OTHER;
  const plans = codes.map((c) => cat.data?.plans.find((p) => p.code === c)).filter(Boolean) as Plan[];
  const extras = (cat.data?.extras ?? []).filter(isOfferedExtra);

  return (
    <>
      <SiteHeader />
      <main id="main" className="w-full">
        <div className="mx-auto max-w-[1200px] px-5 pb-6 pt-12 sm:px-8 sm:pt-16">
          {canceled && <Notice tone="warning" className="mb-6">Checkout was canceled and you weren&apos;t charged. Your choices are saved if you want to pick up where you left off.</Notice>}
          <div className="text-center">
            <h1 className="font-display text-[36px] leading-tight sm:text-[48px]">Pay once. Share all season.</h1>
            <p className="mx-auto mt-3 max-w-2xl text-muted">Design it yourself for free, or let our studio make it for you. Your invitation stays live until 60 days after your date.</p>
            <div className="mt-6 flex justify-center">
              <Segmented label="Event type" value={tab} onChange={setTab} options={[{ value: "wedding", label: <><IconHeart size={16} />Weddings</> }, { value: "other", label: <><IconSparkle size={16} />Other celebrations</> }]} />
            </div>
          </div>

          {cat.error ? (
            <div className="mt-10"><ErrorState error={cat.error} onRetry={() => cat.reload()} title="We couldn't load our plans" /></div>
          ) : (
            <ul className="mt-10 grid gap-5 md:grid-cols-3">
              {cat.loading && !cat.data
                ? [0, 1, 2].map((i) => <li key={i}><Skeleton className="h-[460px]" /></li>)
                : plans.map((p, i) => <PlanCard key={p.code} plan={p} featured={tab === "wedding" ? p.code === "experience" : i === 0} />)}
            </ul>
          )}
          <p className="mt-6 text-center text-body-sm text-muted">Prices in Canadian dollars. {cat.data?.taxNote}</p>
        </div>

        {extras.length > 0 && (
          <section className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8">
            <p className="text-overline font-bold uppercase tracking-[.12em] text-accent-text">Add-ons</p>
            <h2 className="font-display mt-2 text-h2">Make it even more yours</h2>
            <p className="mt-2 text-muted">Add them at checkout or later from your dashboard. Every add-on is included with {t(cat.data?.plans.find((p) => p.includesAllExtras)?.name) || "our top plan"}.</p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {extras.map((e) => <ExtraCard key={e.code} e={e} />)}
            </ul>
          </section>
        )}

        <section className="mx-auto max-w-3xl px-5 py-14 sm:px-8">
          <p className="text-center text-overline font-bold uppercase tracking-[.12em] text-accent-text">Questions</p>
          <h2 className="font-display mt-2 text-center text-h2">Good to know</h2>
          <div className="mt-6 flex flex-col gap-2.5">
            {[
              ["Can I try the editor before paying?", "Yes. Design as much as you like for free. You only pay when you publish and start sharing links."],
              ["Do my guests need an account or an app?", "No. Guests open their link in any browser, read everything and reply in about a minute."],
              ["What happens after my event?", "Your invitation stays live until 60 days after your date, then becomes read-only. You can still export your guest list."],
              ["How does the studio work?", "After checkout you fill in a short brief. A designer builds your invitation, you ask for changes, and we publish once you approve."],
              ["Do you ever email me a password?", "Never. After purchase you get a one-time link to choose your own password."],
            ].map(([q, a], i) => (
              <details key={q} className="card group px-5 py-4" open={i === 0}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold marker:hidden">{q}<IconChevronDown size={18} className="shrink-0 transition group-open:rotate-180" /></summary>
                <p className="mt-2 text-body-sm text-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function ExtraCard({ e }: { e: Extra }) {
  const I = EXTRA_ICON[e.code] ?? IconSparkle;
  return (
    <li className="card flex gap-3 p-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-tint text-primary"><I size={18} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2"><h3 className="text-[15px] font-semibold">{t(e.name)}</h3><span className="tabular text-body-sm font-semibold">{money(e.priceCents, e.currency)}</span></div>
        {e.description && <p className="mt-0.5 text-body-sm text-muted">{t(e.description)}</p>}
      </div>
    </li>
  );
}

function PlanCard({ plan, featured }: { plan: Plan; featured?: boolean }) {
  const href = plan.serviceMode === "self_serve" ? "/login?mode=register&plan=diy" : `/start?plan=${plan.code}`;
  const sub = featured ? "text-on-night-muted" : "text-muted";
  return (
    <li>
      <div className={cx("relative flex h-full flex-col rounded-card p-6", featured ? "card-night" : "card")}>
        {featured && <div aria-hidden className="glow-bloom" style={{ width: 520, height: 520, right: -240, top: -240 }} />}
        <div className="relative flex h-full flex-col">
          <div className="flex items-start justify-between gap-2">
            <p className={cx("text-overline font-bold uppercase tracking-[.12em]", featured ? "text-glow" : "text-muted")}>{plan.serviceMode === "studio" ? (plan.includesAllExtras ? "Fully bespoke" : "Designed with you") : plan.code === "diy" ? "Do it yourself" : "One page"}</p>
            {featured && <Badge tone="accent"><IconSparkle size={14} />Recommended</Badge>}
          </div>
          <h2 className="font-display mt-2 text-h2">{t(plan.name)}</h2>
          <p className={cx("mt-1 text-body-sm", sub)}>{t(plan.description)}</p>
          <p className="mt-5"><span className="font-display tabular text-[40px] leading-none">{money(plan.basePriceCents, plan.currency)}</span> <span className={cx("text-body-sm", sub)}>one time</span></p>
          <p className={cx("mt-1 text-caption", sub)}>{plan.serviceMode === "self_serve" ? "Free to design · pay to publish" : plan.deliveryDays ? `Ready in about ${plan.deliveryDays} business days` : "Made by our studio"}</p>
          <ul className="mt-5 flex-1 space-y-2.5 text-body-sm">
            {plan.features.map((f, i) => (
              <li key={i} className="flex gap-2"><IconCheck size={18} className={cx("mt-0.5 shrink-0", featured ? "text-accent" : "text-success")} />{t(f)}</li>
            ))}
            <li className="flex gap-2"><IconUsers size={18} className={cx("mt-0.5 shrink-0", featured ? "text-accent" : "text-success")} />Up to {plan.maxLanguages} language{plan.maxLanguages === 1 ? "" : "s"}</li>
          </ul>
          {/* B13: every plan has its own CTA; accent only on the recommended one */}
          <ButtonLink href={href} variant={featured ? "accent" : plan.includesAllExtras ? "primary" : "outline"} className="mt-6 w-full">
            {plan.serviceMode === "self_serve" ? "Start designing free" : `Choose ${t(plan.name)}`}
          </ButtonLink>
        </div>
      </div>
    </li>
  );
}
