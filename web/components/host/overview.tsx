"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useEvent } from "@/lib/event-context";
import { replySummary, useReplyCounts } from "@/lib/reply-counts";
import { useAsync, useCountdown } from "@/lib/hooks";
import type { Activity, Revisions, ShareKit } from "@/lib/types";
import { STAGES, formatDate, initials, pct, relTime } from "@/lib/format";
import { Badge, StatusChip, Button, ButtonLink, Card, EmptyState, LoadingBlock, Notice, Skeleton, cx } from "@/components/ui/primitives";
import { IconArrowRight, IconCheck, IconEdit, IconInbox, IconLock, IconMinus, IconPlus, IconSparkle, IconX } from "@/components/ui/icons";
import { ShareActions, ShareKitPanel } from "./share";
import { AddonsDialog } from "./addons";
import { useToast } from "@/components/ui/toast";

export function Overview() {
  const { event } = useEvent();
  if (!event) return null;
  const studio = event.serviceMode === "studio";
  const names = [event.hostNames.partner1, event.hostNames.partner2].filter(Boolean).join(" & ") || event.hostNames.honoree || event.title;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl">Welcome back, {names}</h1>
        <p className="mt-1 text-muted">{event.eventDate ? formatDate(event.eventDate, { dateStyle: "full" }) : "No date yet"}{event.venueName ? ` · ${event.venueName}` : ""}</p>
      </div>
      {event.highSeasonNotice && <Notice tone="warning">It&apos;s our busiest season, so production may take a few extra days. Thank you for your patience.</Notice>}
      <div className="grid gap-5 lg:grid-cols-3">
        <CountdownCard />
        <div className="lg:col-span-2">{studio ? <ProductionCard /> : <PublishCard />}</div>
      </div>
      <StatsGrid />
      <div className="grid gap-5 lg:grid-cols-2">
        <ShareCard />
        <InvitesSentCard />
      </div>
      {studio && (
        <div className="grid gap-5 lg:grid-cols-2">
          <BriefCard />
          <RevisionsCard />
        </div>
      )}
      <ActivityCard />
    </div>
  );
}

function CountdownCard() {
  const { event } = useEvent();
  const target = event?.eventDate ? new Date(event.eventDate + "T00:00:00") : null;
  const c = useCountdown(target);
  return (
    <Card className="relative overflow-hidden border-0 bg-night text-on-night">
      <div aria-hidden className="absolute -right-16 -top-16 size-40 rounded-full opacity-25 blur-3xl" style={{ background: "var(--brand-accent)" }} />
      <h2 className="relative text-sm font-semibold text-glow">Countdown</h2>
      {!target ? (
        <p className="relative mt-3 text-on-night/80">Add your date in Settings to start the countdown.</p>
      ) : !c ? (
        <div className="relative mt-4 h-16" />
      ) : c.done ? (
        <p className="font-display relative mt-3 text-3xl">It&apos;s the day! 🎉</p>
      ) : (
        <div className="relative mt-4 grid grid-cols-4 gap-2" role="timer" aria-label={`${c.days} days, ${c.hours} hours, ${c.minutes} minutes to go`}>
          {([["days", c.days], ["hrs", c.hours], ["min", c.minutes], ["sec", c.seconds]] as const).map(([l, n]) => (
            <div key={l} className="relative rounded-md border border-on-night/15 bg-night-raised py-2 text-center" aria-hidden>
              <div className="tabular text-2xl font-bold">{String(n).padStart(2, "0")}</div>
              <div className="text-caption text-on-night-muted">{l}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ProductionCard() {
  const { event } = useEvent();
  const idx = Math.max(0, STAGES.findIndex((s) => s.key === event!.productionStage));
  const stage = STAGES[idx];
  return (
    <Card className="h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Your invitation&apos;s progress</h2>
        {event!.express && <Badge tone="accent">Rush design</Badge>}
      </div>
      <ol className="mt-5 grid grid-cols-6 gap-1" aria-label="Production stages">
        {STAGES.map((s, i) => (
          <li key={s.key} className="flex flex-col items-center gap-2 text-center" aria-current={i === idx ? "step" : undefined}>
            <span className={cx("tabular grid size-8 place-items-center rounded-full text-xs font-bold", i < idx ? "bg-success text-surface" : i === idx ? "bg-accent text-on-accent shadow-glow" : "bg-surface-2 text-muted")}>
              {i < idx ? <IconCheck size={16} /> : i + 1}
            </span>
            <span className={cx("hidden text-xs sm:block", i === idx ? "font-semibold" : "text-muted")}>{s.label}</span>
            <span className="sr-only">{s.label}{i < idx ? " (done)" : i === idx ? " (current)" : ""}</span>
          </li>
        ))}
      </ol>
      <div className="mt-5 rounded-md bg-tint px-4 py-3">
        <p className="font-semibold">{stage.label}</p>
        <p className="text-sm text-muted">{stage.desc}</p>
      </div>
    </Card>
  );
}

function PublishCard() {
  const { event } = useEvent();
  const [addons, setAddons] = useState(false);
  const inv = event!.invitation;
  const live = inv?.status === "published";
  const pendingExtras = (event!.selectedExtras ?? []).length;
  return (
    <Card className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Your invitation</h2>
        {live ? <StatusChip tone="attending">Live</StatusChip> : <StatusChip tone="neutral">Draft</StatusChip>}
      </div>
      <p className="text-sm text-muted">
        {live ? "Your invitation is published. Guests can open it and reply." : event!.paid ? "Publishing is unlocked. Publish from the editor whenever you're ready." : "Your draft is free to build and preview. When it's ready, publish it to share with guests."}
      </p>
      <div className="mt-auto flex flex-wrap gap-2">
        <ButtonLink href={`/app/${event!.id}/invitation`}><IconEdit size={18} />{live ? "Edit invitation" : "Continue editing"}</ButtonLink>
        {inv && <ButtonLink href={live ? `/i/${inv.slug}` : `/app/${event!.id}/invitation#preview`} variant="outline" target={live ? "_blank" : undefined}>{live ? "Open live invitation" : "Preview"}</ButtonLink>}
        {event!.paid && event!.myRole === "owner" && <Button variant="ghost" onClick={() => setAddons(true)}><IconPlus size={18} />Add extras</Button>}
      </div>
      {!event!.paid && pendingExtras > 0 && <p className="text-caption text-muted">{pendingExtras} add-on{pendingExtras === 1 ? "" : "s"} in your order, charged when you publish.</p>}
      <AddonsDialog open={addons} onClose={() => setAddons(false)} />
    </Card>
  );
}

function StatsGrid() {
  const { stats, event } = useEvent();
  const s = stats;
  // N-37: "sent" = links actually sent; "Waiting" = the same number as the Replies page's Waiting tab.
  const rc = useReplyCounts(event?.id, event?.invitesSentManual ?? 0, [stats]);
  const sent = rc.data?.sent ?? s?.invitesSent ?? 0;
  // N-40: reply rate and Waiting come from the server (guest list only); general-link replies are shown apart.
  const sum = replySummary(s, rc.data);
  const waiting = sum?.waiting ?? 0;
  const general = sum?.generalLinkReplies ? ` · +${sum.generalLinkReplies} via general link` : "";
  const tiles = s && sum
    ? [
        ["Invites sent", sent, rc.data && !rc.data.sentFromInvitees && sent > 0 ? "counted by you" : null],
        ["Replies", sum.hasGuestList ? sum.replied : s.responses, sum.hasGuestList && sum.rate != null ? `${pct(sum.rate)} of ${sum.invited} invited${general}` : `No guest list yet${s.responses ? " · all via general link" : ""}`],
        ["Waiting", waiting, sum.hasGuestList ? "on your guest list, no reply yet" : "no guest list yet"],
        ["Coming", s.confirmed, s.confirmedRate == null ? "no replies yet" : `${pct(s.confirmedRate)} of replies`],
        ["Can't come", s.declined, null],
        ["Total guests", s.totalAttendees, s.averageParty != null ? `avg party ${s.averageParty.toFixed(1)}` : "no replies yet"],
      ]
    : [];
  return (
    <section aria-labelledby="stats-h">
      <h2 id="stats-h" className="sr-only">Reply statistics</h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {!s
          ? Array.from({ length: 6 }).map((_, i) => <li key={i}><Skeleton className="h-24" /></li>)
          : tiles.map(([label, n, sub]) => (
              <li key={label as string} className="rounded-card border border-line bg-surface p-4 shadow-card">
                <p className="text-xs font-semibold text-muted">{label}</p>
                <p className="tabular font-display mt-1 text-3xl">{n as number}</p>
                {sub && <p className="text-xs text-muted">{sub}</p>}
              </li>
            ))}
      </ul>
    </section>
  );
}

function ShareCard() {
  const { event } = useEvent();
  const inv = event!.invitation;
  const live = inv?.status === "published";
  const kit = useAsync(() => (live ? api<ShareKit>(`/api/events/${event!.id}/share-kit`) : Promise.resolve(null)), [event?.id, live]);
  return (
    <Card>
      <h2 className="font-semibold">Share your invitation</h2>
      {!inv || !live ? (
        <p className="mt-3 text-sm text-muted">{event!.serviceMode === "studio" ? "Your link appears here as soon as we publish your invitation." : "Your link appears here once you publish."}</p>
      ) : (
        <div className="mt-3">
          {kit.data ? <ShareKitPanel kit={kit.data} eventId={event!.id} title={event!.title} /> : kit.error ? <ShareActions url={inv.url} title={event!.title} qrBase={`/api/events/${event!.id}/qr`} /> : <LoadingBlock rows={2} />}
          <p className="mt-3 text-xs text-muted">Want to know exactly who replied? Use <Link className="font-semibold underline" href={`/app/${event!.id}/guests`}>personal guest links</Link>.</p>
        </div>
      )}
    </Card>
  );
}

function InvitesSentCard() {
  const { event, stats, canWrite, reload } = useEvent();
  const toast = useToast();
  const rc = useReplyCounts(event?.id, event?.invitesSentManual ?? 0, [stats]);
  // Only links actually sent count (N-37); households that were added but never sent don't.
  const fromInvitees = rc.data ? rc.data.sentFromInvitees : stats?.invitesSentSource === "invitees";
  const [val, setVal] = useState<number>(event!.invitesSentManual);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setVal(event!.invitesSentManual), [event]);
  const save = (n: number) => {
    const v = Math.max(0, Math.min(100000, n || 0));
    setVal(v);
    clearTimeout(timer.current);
    setState("saving");
    timer.current = setTimeout(async () => {
      try {
        await api(`/api/events/${event!.id}/invites-sent`, { method: "PATCH", body: { total: v } });
        setState("saved");
        reload();
      } catch (e) {
        setState("idle");
        toast(e instanceof Error ? e.message : "Couldn't save", "error");
      }
    }, 600);
  };
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Invitations sent</h2>
        <span aria-live="polite" className="text-xs text-muted">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : ""}</span>
      </div>
      {fromInvitees ? (
        <p className="mt-3 text-sm text-muted">Counted automatically from your guest list: <strong className="tabular text-ink">{rc.data?.sent ?? stats?.invitesSent}</strong> households have been sent their personal link.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">Sharing one link in a group chat? Tell us roughly how many people got it so your reply rate makes sense.</p>
          <div className="mt-4 flex items-center gap-2">
            <Button variant="outline" aria-label="Decrease" disabled={!canWrite || val <= 0} onClick={() => save(val - 1)}><IconMinus size={18} /></Button>
            <label htmlFor="inv-sent" className="sr-only">Invitations sent</label>
            <input id="inv-sent" type="number" min={0} inputMode="numeric" disabled={!canWrite} value={val} onChange={(e) => save(parseInt(e.target.value, 10))} className="tabular h-11 w-24 rounded-md border border-line bg-surface text-center text-xl font-bold" />
            <Button variant="outline" aria-label="Increase" disabled={!canWrite} onClick={() => save(val + 1)}><IconPlus size={18} /></Button>
          </div>
        </>
      )}
      {stats?.responsesExceedInvites && !fromInvitees && (
        <Notice tone="warning" className="mt-3">You have more replies than invitations sent. <button className="font-semibold underline" onClick={() => save(stats.responses)}>Set it to {stats.responses}</button></Notice>
      )}
    </Card>
  );
}

function BriefCard() {
  const { event } = useEvent();
  const b = event!.brief;
  if (!b) return null;
  const { done, total } = b.completion;
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Your brief</h2>
        {b.locked ? <Badge tone="success"><IconLock size={12} />Submitted</Badge> : <Badge tone="warning">In progress</Badge>}
      </div>
      {b.newSections.length > 0 && <Notice tone="warning" className="mt-3">The studio added {b.newSections.length} new section(s) for you to fill in.</Notice>}
      <p className="mt-3 text-sm text-muted">{done} of {total} sections complete</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Brief completion">
        <div className="h-full rounded-full bg-accent" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <ButtonLink href={`/app/${event!.id}/brief`} variant="outline" size="sm" className="mt-4">{b.locked ? "View brief" : "Continue brief"} <IconArrowRight size={16} /></ButtonLink>
    </Card>
  );
}

function RevisionsCard() {
  const { event } = useEvent();
  const r = useAsync(() => api<Revisions>(`/api/events/${event!.id}/revisions`), [event?.productionStage, event?.designApprovedAt]);
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Changes &amp; approval</h2>
        {r.data && <Badge>{r.data.unlimited ? "Unlimited rounds" : `${r.data.remaining} of ${r.data.maxRounds} rounds left`}</Badge>}
      </div>
      {r.loading && !r.data ? <Skeleton className="mt-3 h-16" /> : r.data?.approvedAt ? (
        <p className="mt-3 text-sm text-success">You approved the design on {formatDate(r.data.approvedAt)}.</p>
      ) : r.data?.open ? (
        <p className="mt-3 text-sm text-muted">We&apos;re working on your latest changes.</p>
      ) : r.data?.canSubmit || r.data?.canApprove ? (
        <p className="mt-3 text-sm text-muted">Your draft is ready for review. Ask for changes or approve it.</p>
      ) : (
        <p className="mt-3 text-sm text-muted">Nothing to look at yet. We&apos;ll let you know the moment the designer shares a first version.</p>
      )}
      <ButtonLink href={`/app/${event!.id}/revisions`} variant="outline" size="sm" className="mt-4">Open review <IconArrowRight size={16} /></ButtonLink>
    </Card>
  );
}

function ActivityCard() {
  const { event, subscribe } = useEvent();
  const a = useAsync(() => api<{ items: Activity[] }>(`/api/events/${event!.id}/activity`, { query: { limit: 8 } }), [event?.id]);
  useEffect(() => subscribe((m) => { if (m.type.startsWith("guest.")) a.reload(true); }), [subscribe, a]);
  const label = (x: Activity) => {
    const n = x.data.name ?? "Someone";
    if (x.action.startsWith("rsvp")) return x.data.attendance === "yes" ? `${n} is coming${x.data.partySize && x.data.partySize > 1 ? ` (party of ${x.data.partySize})` : ""}` : x.data.attendance === "no" ? `${n} can't make it` : `${n} replied`;
    if (x.action === "guest.added") return `${n} was added by a host`;
    return `${n}: ${x.action.replace(/[._]/g, " ")}`;
  };
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Recent activity</h2>
        <Link href={`/app/${event!.id}/replies`} className="text-sm font-semibold text-primary hover:underline">All replies</Link>
      </div>
      {a.loading && !a.data ? <Skeleton className="mt-4 h-24" /> : !a.data?.items.length ? (
        <div className="mt-4"><EmptyState icon={<IconInbox />} title="No replies yet" body="As soon as a guest answers, you'll see it here." /></div>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {a.data.items.map((x) => (
            <li key={x.id} className="flex items-center gap-3 py-3">
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-tint text-sm font-bold text-primary">{initials(x.data.name ?? "?")}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{label(x)}</span>
              {x.data.attendance === "yes" ? <IconCheck size={18} className="text-success" aria-label="Coming" /> : x.data.attendance === "no" ? <IconX size={18} className="text-danger" aria-label="Can't come" /> : <IconSparkle size={18} className="text-muted" aria-hidden />}
              <time dateTime={x.createdAt} className="shrink-0 text-xs text-muted">{relTime(x.createdAt)}</time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
