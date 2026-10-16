"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { EventT } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingBlock, Notice, PageHeader } from "@/components/ui/primitives";
import { IconArrowRight, IconCalendar, IconPlus, IconSparkle } from "@/components/ui/icons";
import { NewDraftDialog } from "./new-draft";

export function statusBadge(e: EventT) {
  if (e.invitation?.status === "published") return <Badge tone="success">Live</Badge>;
  if (e.serviceMode === "studio") return <Badge tone="warning">In production</Badge>;
  return <Badge>Draft</Badge>;
}

export function EventsHome() {
  const { me } = useSession();
  const events = useAsync(() => api<{ items: EventT[] }>("/api/events"));
  const [open, setOpen] = useState(false);
  return (
    <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        title={me?.user.name ? `Hello, ${me.user.name.split(" ")[0]}` : "Your invitations"}
        subtitle="Everything you're hosting, in one place."
        actions={<Button onClick={() => setOpen(true)}><IconPlus size={18} />New invitation</Button>}
      />
      {(me?.role === "admin" || me?.role === "staff") && (
        <Notice className="mb-6">You&apos;re signed in as studio {me.role === "admin" ? "admin" : "designer"}. This page lists only events you host yourself. <Link href="/admin" className="font-semibold underline">Open the studio console</Link> for the production pipeline.</Notice>
      )}
      {events.loading && !events.data ? (
        <LoadingBlock rows={3} />
      ) : events.error ? (
        <ErrorState error={events.error} onRetry={() => events.reload()} />
      ) : events.data!.items.length === 0 ? (
        <EmptyState icon={<IconSparkle />} title="No invitations yet" body="Start a free draft. You can pick a style, write your story and preview everything before you pay." action={<Button onClick={() => setOpen(true)}>Start a free draft</Button>} />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {events.data!.items.map((e) => (
            <li key={e.id}>
              <Card className="flex h-full flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-xl">{e.title}</h2>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted"><IconCalendar size={16} />{e.eventDate ? formatDate(e.eventDate, { dateStyle: "full" }) : "Date to be decided"}</p>
                  </div>
                  {statusBadge(e)}
                </div>
                <p className="text-sm text-muted">{e.serviceMode === "studio" ? "Designed by our studio" : e.paid ? "Self-serve · paid" : "Self-serve · free draft"} · {e.myRole === "owner" ? "You own this" : `You're a ${e.myRole}`}</p>
                <Link href={`/app/${e.id}`} className="mt-auto inline-flex items-center gap-1 self-start rounded-md text-sm font-semibold text-primary hover:underline">Open dashboard <IconArrowRight size={16} /></Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <NewDraftDialog open={open} onClose={() => setOpen(false)} />
    </main>
  );
}
