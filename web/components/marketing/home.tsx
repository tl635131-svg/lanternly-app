"use client";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { themeFits, type Catalogue, type Plan, type Review, type Theme } from "@/lib/types";
import { money, t } from "@/lib/format";
import { invVars } from "@/lib/palette";
import { brand } from "@/theme/brand";
import { SiteFooter, SiteHeader } from "./chrome";
import { ThemeCard } from "./theme-card";
import { BRAND_NAME, BrandSymbol } from "@/components/brand";
import { Badge, ButtonLink, ErrorState, Skeleton, StatusChip, cx } from "@/components/ui/primitives";
import { IconArrowRight, IconBell, IconCheck, IconDownload, IconLink, IconMail, IconTable, IconUtensils } from "@/components/ui/icons";

const Overline = ({ children, dark }: { children: React.ReactNode; dark?: boolean }) => (
  <p className={cx("text-overline font-bold uppercase tracking-[.12em]", dark ? "text-glow" : "text-accent-text")}>{children}</p>
);

export function HomePage() {
  const cat = useAsync(() => api<Catalogue>("/api/public/catalogue"));
  const reviews = useAsync(() => api<{ items: Review[]; onlySamples?: boolean }>("/api/public/reviews", { query: { limit: 3 } }));
  const themes = (cat.data?.themes ?? []).filter((x) => themeFits(x, "wedding_invite"));
  const plans = ["diy", "experience", "premium"].map((c) => cat.data?.plans.find((p) => p.code === c)).filter(Boolean) as Plan[];
  const hero = themes.find((x) => x.status === "active");

  return (
    <>
      <SiteHeader dark />
      <main id="main" className="overflow-x-clip">
        {/* Hero */}
        <section className="relative overflow-hidden bg-night text-on-night">
          <div aria-hidden className="glow-bloom" style={{ width: 900, height: 900, right: -260, top: -260 }} />
          <div className="relative mx-auto grid max-w-[1200px] items-center gap-12 px-5 pb-20 pt-12 sm:px-8 md:grid-cols-[1.15fr_.85fr] md:pt-16">
            <div className="reveal">
              <p className="inline-flex items-center gap-2 rounded-sm bg-night-raised px-3 py-1.5 text-body-sm text-on-night-muted shadow-glow-night">Digital invitations for weddings and celebrations</p>
              <h1 className="font-display mt-6 text-[40px] leading-[1.04] sm:text-[56px] lg:text-[64px]"><Tagline /></h1>
              <p className="mt-5 max-w-xl text-[18px] leading-relaxed text-on-night-muted">
                Design an invitation that glows on every phone, send each household its own link, and watch replies, meals and seats fall into place.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <ButtonLink href="/pricing" variant="accent" size="lg">Start your invitation <IconArrowRight size={18} /></ButtonLink>
                <ButtonLink href="/i/maya-and-theo" variant="night" size="lg">See a live invitation</ButtonLink>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-body-sm text-on-night-muted">
                {["Free to design", "Pay when you publish", "No app for guests"].map((x) => (
                  <li key={x} className="flex items-center gap-1.5"><IconCheck size={16} className="text-accent" />{x}</li>
                ))}
              </ul>
            </div>
            <HeroPhone theme={hero} />
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-16 border-b border-line bg-surface">
          <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8">
            <Overline>How it works</Overline>
            <h2 className="font-display mt-2 text-h2 sm:text-[34px]">From first draft to final headcount</h2>
            <ol className="stepper mt-10 hidden md:flex">
              {["Choose a design", "Make it yours", "Send personal links", "Watch replies arrive"].map((h, i) => (
                <li key={h} className={cx("step", i === 0 ? "done" : i === 1 ? "current" : "")}><span className="dot">{i + 1}</span></li>
              ))}
            </ol>
            <div className="mt-6 grid gap-8 md:grid-cols-4">
              {[
                ["Choose a design", "Start from six original designs. Every colour, font and section is yours to change."],
                ["Make it yours", "Add your story, schedule, map, music and the questions you need answered."],
                ["Send personal links", "Each household gets its own link with their seats already saved. Share by email, text or QR."],
                ["Watch replies arrive", "See who's coming, dinner choices and allergies as they land, then plan the seating."],
              ].map(([h, b], i) => (
                <div key={h} className="flex gap-4 md:block">
                  <span className="tabular grid size-8 shrink-0 place-items-center rounded-full bg-tint text-[13px] font-bold text-primary md:hidden">{i + 1}</span>
                  <div>
                    <h3 className="font-semibold">{h}</h3>
                    <p className="mt-1 text-body-sm text-muted">{b}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Designs */}
        <section id="styles" className="mx-auto max-w-[1200px] scroll-mt-16 px-5 py-20 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <Overline>Designs</Overline>
              <h2 className="font-display mt-2 text-h2 sm:text-[34px]">Six starting points, endless versions</h2>
              <p className="mt-2 max-w-xl text-muted">Every design has its own opening glow. Keep the palette and fonts until it feels like the two of you.</p>
            </div>
            <ButtonLink href="/pricing" variant="outline">Compare plans</ButtonLink>
          </div>
          {cat.error ? (
            <div className="mt-8"><ErrorState error={cat.error} onRetry={() => cat.reload()} title="We couldn't load the designs" /></div>
          ) : (
            <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {cat.loading && !cat.data
                ? Array.from({ length: 6 }).map((_, i) => <li key={i}><Skeleton className="aspect-[9/16] w-full rounded-[18px]" /><Skeleton className="mt-3 h-4 w-2/3" /></li>)
                : themes.map((th, i) => <li key={th.key}><ThemeCard theme={th} index={i} /></li>)}
            </ul>
          )}
        </section>

        {/* For hosts */}
        <section id="hosts" className="scroll-mt-16 border-y border-line bg-surface">
          <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-5 py-20 sm:px-8 md:grid-cols-2 [&>*]:min-w-0">
            <div>
              <Overline>For hosts</Overline>
              <h2 className="font-display mt-2 text-h2 sm:text-[34px]">Every reply, the moment it lands</h2>
              <p className="mt-3 max-w-lg text-muted">One calm dashboard for both of you, with no spreadsheets to merge and no chasing.</p>
              <ul className="mt-8 grid gap-5 sm:grid-cols-2">
                {[
                  [IconLink, "Personal links", "One link per household, with their seats already saved."],
                  [IconBell, "Gentle reminders", "Scheduled nudges before your reply date."],
                  [IconUtensils, "Meals & allergies", "Dinner counts and dietary needs, ready for the caterer."],
                  [IconTable, "Seating planner", "Drop households onto tables and print place cards."],
                  [IconDownload, "Excel export", "Households and guests on separate sheets."],
                  [IconMail, "Bilingual", "English and French, chosen by each guest."],
                ].map(([Icon, h, b]) => {
                  const I = Icon as typeof IconLink;
                  return (
                    <li key={h as string} className="flex gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-tint text-primary"><I size={18} /></span>
                      <span><span className="block text-[15px] font-semibold">{h as string}</span><span className="text-body-sm text-muted">{b as string}</span></span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <DashboardTeaser />
          </div>
        </section>

        {/* Testimonials: from the API; sample copy is labelled, no stars or "verified" badges. Hidden when empty. */}
        {(reviews.data?.items.length ?? 0) > 0 && (
          <section className="mx-auto max-w-[1200px] px-5 py-16 sm:px-8">
            <Overline>From couples</Overline>
            <ul className="mt-6 grid gap-4 md:grid-cols-3">
              {reviews.data!.items.map((r) => (
                <li key={r.id} className="card card-pad flex flex-col">
                  {r.isSample && <Badge className="mb-3 w-fit">Sample review</Badge>}
                  <blockquote className="text-ink">“{r.text}”</blockquote>
                  <p className="mt-auto pt-4 text-body-sm text-muted">{r.displayName}{r.location ? ` · ${r.location}` : ""}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Pricing */}
        <section className={cx("px-5 py-20 sm:px-8", (reviews.data?.items.length ?? 0) > 0 && "pt-4")}>
          <div className="mx-auto max-w-[1200px]">
            <Overline>Pricing</Overline>
            <h2 className="font-display mt-2 text-h2 sm:text-[34px]">One payment. No subscriptions.</h2>
            <p className="mt-2 text-muted">Design for free. Pay once when you&apos;re ready to share. {cat.data?.taxNote}</p>
            <ul className="mt-8 grid gap-4 md:grid-cols-3">
              {cat.loading && !cat.data
                ? Array.from({ length: 3 }).map((_, i) => <li key={i}><Skeleton className="h-52" /></li>)
                : plans.map((p) => <MiniPlan key={p.code} plan={p} featured={p.code === "experience"} />)}
            </ul>
          </div>
        </section>

        {/* CTA band (aligned to the 1200 container) */}
        <section className="px-5 pb-20 sm:px-8">
          <div className="card-night relative mx-auto max-w-[1200px] px-6 py-16 text-center">
            <div aria-hidden className="glow-bloom" style={{ width: 700, height: 700, left: "50%", top: -260, marginLeft: -350 }} />
            <div className="relative">
              <span className="mx-auto block w-fit"><BrandSymbol dark size={44} /></span>
              <h2 className="font-display mt-4 text-h2 sm:text-[40px]">Ready when you are</h2>
              <p className="mx-auto mt-2 max-w-md text-on-night-muted">Build your invitation for free with {BRAND_NAME}. You only pay when you publish it to your guests.</p>
              <div className="mt-6 flex justify-center"><ButtonLink href="/login?mode=register" variant="accent" size="lg">Start your invitation <IconArrowRight size={18} /></ButtonLink></div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

/** Brand tagline with its last two words lit in the accent colour. */
function Tagline() {
  const words = brand.tagline.replace(/[.!]$/, "").split(" ");
  const lit = words.splice(-2).join(" ");
  return <>{words.join(" ")} <span className="text-accent">{lit}.</span></>;
}

function MiniPlan({ plan, featured }: { plan: Plan; featured?: boolean }) {
  const href = plan.serviceMode === "self_serve" ? "/login?mode=register&plan=diy" : `/start?plan=${plan.code}`;
  return (
    <li className={cx("flex flex-col rounded-card p-6", featured ? "card-night" : "card")}>
      <p className={cx("text-overline font-bold uppercase tracking-[.12em]", featured ? "text-glow" : "text-muted")}>{plan.serviceMode === "studio" ? (featured ? "Designed with you" : "Fully bespoke") : "Do it yourself"}</p>
      <h3 className="font-display mt-2 text-h3">{t(plan.name)}</h3>
      <p className="mt-2"><span className="font-display tabular text-[34px]">{money(plan.basePriceCents, plan.currency)}</span> <span className={cx("text-body-sm", featured ? "text-on-night-muted" : "text-muted")}>one time</span></p>
      <p className={cx("mt-2 flex-1 text-body-sm", featured ? "text-on-night-muted" : "text-muted")}>{t(plan.description)}</p>
      <ButtonLink href={href} variant={featured ? "accent" : "outline"} className="mt-5 w-full">{plan.serviceMode === "self_serve" ? "Start free" : `Choose ${t(plan.name)}`}</ButtonLink>
    </li>
  );
}

/** B13: visible phone frame on night (#0C0E26 + ring + night glow), cover drawn from the first API theme. */
function HeroPhone({ theme }: { theme?: Theme }) {
  const { style, light } = invVars(theme?.defaultConfig);
  return (
    <div className="reveal relative mx-auto" style={{ animationDelay: ".15s" }} aria-hidden>
      <div className="phone" style={{ boxShadow: "0 0 0 1px rgba(255,255,255,.06) inset, 0 0 0 1.5px #2A2D5C, var(--brand-shadow-glow-night)" }}>
        <div className={cx("scr", light ? "inv light" : "inv")} style={style}>
          <span className="notch" />
          <span className="inv-bloom" style={{ width: 520, height: 520, left: -110, top: -40 }} />
          <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="inv-over">You&apos;re invited</p>
            <p className="inv-names phone-names mt-3">Maya<br />&amp; Theo</p>
            <span className="inv-rule mx-auto my-4" />
            <p className="text-[14px] font-bold" style={{ color: "var(--inv-glow-text)" }}>Saturday 12 June 2027</p>
            <p className="inv-muted mt-1 text-[12.5px]">Lakeside Pavilion · Muskoka, Ontario</p>
            <span className="inv-btn mt-6 !h-11 !text-[14px]">Open invitation</span>
          </div>
        </div>
      </div>
      <div className="card absolute -left-16 top-12 hidden w-56 items-center gap-3 p-3 text-ink sm:flex">
        <span className="grid size-8 place-items-center rounded-full bg-tint text-[13px] font-bold text-primary">EV</span>
        <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">Eleanor replied</span><span className="text-caption text-muted">Coming · party of 3</span></span>
        <StatusChip tone="attending">Yes</StatusChip>
      </div>
      <div className="card absolute -right-10 bottom-20 hidden w-40 p-3 text-ink sm:block">
        <p className="text-caption text-muted">Coming so far</p>
        <p className="font-display tabular text-[26px] leading-tight">86 <span className="text-caption font-semibold text-success">+3 today</span></p>
        <div className="bar mt-2"><span style={{ width: "62%", background: "var(--brand-success)" }} /><span style={{ width: "12%", background: "var(--brand-danger)" }} /></div>
      </div>
    </div>
  );
}

function DashboardTeaser() {
  return (
    <div aria-hidden className="card raised p-5">
      <div className="flex items-center justify-between">
        <div><p className="font-semibold">Replies</p><p className="text-caption text-muted">Maya &amp; Theo · updated just now</p></div>
        <StatusChip tone="info">Live</StatusChip>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {[["Coming", "86", "attending"], ["Can't come", "12", "declined"], ["Maybe", "4", "maybe"], ["Waiting", "18", "pending"]].map(([l, n, tone]) => (
          <div key={l} className="rounded-md border border-line p-2.5">
            <div className="flex items-center gap-1.5 text-caption text-muted"><span className="size-1.5 rounded-full" style={{ background: `var(--brand-rsvp-${tone})` }} />{l}</div>
            <div className="font-display tabular mt-1 text-[22px]">{n}</div>
          </div>
        ))}
      </div>
      <ul className="mt-3 divide-y divide-line">
        {[["The Vance family", "3 guests · Salmon, Short rib", "attending"], ["Nadia Rahman", "2 guests · vegetarian", "attending"], ["Owen Price", "\"Sending love from Lisbon!\"", "declined"], ["Luc Tremblay", "Opened 1 h ago", "pending"]].map(([n, d, tone]) => (
          <li key={n} className="flex items-center gap-3 py-2.5">
            <span className="avatar">{n.replace(/^The /, "").split(" ").map((x) => x[0]).slice(0, 2).join("")}</span>
            <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold">{n}</span><span className="block truncate text-caption text-muted">{d}</span></span>
            <StatusChip tone={tone as "attending"} />
          </li>
        ))}
      </ul>
    </div>
  );
}
