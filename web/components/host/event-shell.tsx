"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { EventProvider, useEvent } from "@/lib/event-context";
import { ErrorState, LoadingBlock, StatusChip, cx } from "@/components/ui/primitives";
import { IconEdit, IconHome, IconInbox, IconSettings, IconTable, IconUsers, IconSparkle, IconEye } from "@/components/ui/icons";
import { ApiError } from "@/lib/api";

export function EventShell({ eventId, children }: { eventId: string; children: ReactNode }) {
  return (
    <EventProvider eventId={eventId}>
      <Inner eventId={eventId}>{children}</Inner>
    </EventProvider>
  );
}

function Inner({ eventId, children }: { eventId: string; children: ReactNode }) {
  const { event, error, loading, reload, live } = useEvent();
  const pathname = usePathname();
  const base = `/app/${eventId}`;
  const studio = event?.serviceMode === "studio";
  const tabs = [
    { href: base, label: "Overview", icon: IconHome },
    { href: `${base}/invitation`, label: "Invitation", icon: IconEdit },
    { href: `${base}/guests`, label: "Guests", icon: IconUsers },
    { href: `${base}/replies`, label: "Replies", icon: IconInbox },
    { href: `${base}/seating`, label: "Seating", icon: IconTable },
    ...(studio ? [{ href: `${base}/brief`, label: "Brief", icon: IconSparkle }, { href: `${base}/revisions`, label: "Review", icon: IconEye }] : []),
    { href: `${base}/settings`, label: "Settings", icon: IconSettings },
  ];
  const mobileTabs = tabs.filter((t) => t.label !== "Brief" && t.label !== "Review");
  const isActive = (h: string) => (h === base ? pathname === base : pathname.startsWith(h));

  if (loading && !event) return <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8"><LoadingBlock label="Loading your event" rows={4} /></main>;
  if (error && !event) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8">
        <ErrorState error={notFound ? new Error("This event doesn't exist, or you don't have access to it.") : error} title={notFound ? "Event not found" : undefined} onRetry={notFound ? undefined : () => reload()} />
        <Link href="/app" className="mt-4 inline-block text-sm font-semibold underline">Back to my invitations</Link>
      </main>
    );
  }
  return (
    <>
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex items-center justify-between gap-3 pt-4">
            <p className="truncate font-display text-lg">{event?.title}</p>
            <span className="flex shrink-0 items-center gap-2" title={live ? "Live updates on" : "Reconnecting"}>
              {event?.invitation?.status === "published" ? <StatusChip tone="attending">Published</StatusChip> : <StatusChip tone="neutral">Draft</StatusChip>}
              <span className={cx("hidden items-center gap-1.5 text-caption font-medium sm:flex", live ? "text-success" : "text-muted")}><span className={cx("size-2 rounded-full", live ? "bg-success" : "bg-border-strong")} />{live ? "Live updates" : "Reconnecting"}</span>
            </span>
          </div>
          <nav aria-label="Event sections" className="-mb-px mt-2 hidden gap-1 overflow-x-auto md:flex">
            {tabs.map((t) => (
              <Link key={t.href} href={t.href} aria-current={isActive(t.href) ? "page" : undefined}
                className={cx("flex h-12 items-center gap-2 whitespace-nowrap border-b-[2.5px] px-3.5 text-[14.5px] font-semibold", isActive(t.href) ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}>
                <t.icon size={17} />{t.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      {/* B4: content clears the fixed bottom tab bar (64px + safe area) on mobile */}
      <main id="main" className="pb-tabbar mx-auto w-full max-w-6xl flex-1 px-4 pt-6 sm:px-6 md:!pb-12 md:pt-8">{children}</main>
      {/* Mobile bottom navigation */}
      <nav aria-label="Event sections" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-raised backdrop-blur md:hidden">
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${mobileTabs.length}, minmax(0,1fr))` }}>
          {mobileTabs.map((t) => (
            <li key={t.href}>
              <Link href={t.href} aria-current={isActive(t.href) ? "page" : undefined} className={cx("flex h-16 flex-col items-center justify-center gap-0.5 text-[12px] font-semibold", isActive(t.href) ? "text-primary" : "text-muted")}>
                <t.icon size={20} /><span className="max-w-full truncate px-0.5">{t.label === "Invitation" ? "Invite" : t.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
