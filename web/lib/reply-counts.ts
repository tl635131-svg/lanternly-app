"use client";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import type { Guest, GuestList, Invitee, Stats } from "@/lib/types";

/**
 * One definition of the reply numbers, shared by the host overview and the Replies page.
 * N-40: the server's stats are the source of truth: `invited` (guest-list entries), `replied` (with a yes/no),
 * `waiting` (= invited − replied), `generalLinkReplies` (no guest-list entry; never in the rate) and
 * `responseRate` = replied / invited, null without a guest list. Older APIs lack these, so we fall back to the
 * guest list (N-37).
 * - Sent: households whose personal link was actually sent (`sentAt`), else the host's manual count.
 * - Waiting list: guest-list households with no reply yet. Pending reply rows that aren't on the guest list
 *   (`pendingGuests`) are shown separately and aren't counted in Waiting.
 */
export type ReplyCounts = { invited: number; sent: number; sentFromInvitees: boolean; waitingHouseholds: Invitee[]; pendingGuests: Guest[]; waiting: number };

async function allInvitees(eventId: string): Promise<Invitee[]> {
  const out: Invitee[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await api<{ items: Invitee[]; nextCursor: string | null }>(`/api/events/${eventId}/invitees`, { query: { limit: 100, cursor } });
    out.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

export function replyCounts(invitees: Invitee[], pending: Guest[], invitesSentManual: number): ReplyCounts {
  const sentList = invitees.filter((i) => !!i.sentAt);
  // Same as the server's `waiting`: every guest-list entry without a yes/no reply.
  const waitingHouseholds = invitees.filter((i) => !i.respondedAt && i.status !== "responded");
  const pendingGuests = pending.filter((g) => g.attendance === "pending" && !g.invitee);
  return {
    invited: invitees.length,
    sent: sentList.length > 0 ? sentList.length : invitesSentManual,
    sentFromInvitees: sentList.length > 0,
    waitingHouseholds,
    pendingGuests,
    waiting: waitingHouseholds.length,
  };
}

export type ReplySummary = { invited: number; replied: number; waiting: number; generalLinkReplies: number | null; rate: number | null; hasGuestList: boolean };
/** N-40 numbers for display: the server's fields when present, else derived from the guest list. */
export function replySummary(s: Stats | null | undefined, rc?: ReplyCounts | null): ReplySummary | null {
  if (!s) return null;
  if (s.invited != null) {
    return { invited: s.invited, replied: s.replied ?? s.invited - (s.waiting ?? s.awaiting), waiting: s.waiting ?? s.awaiting, generalLinkReplies: s.generalLinkReplies ?? null, rate: s.invited > 0 ? s.responseRate : null, hasGuestList: s.invited > 0 };
  }
  const invited = rc?.invited ?? s.invitesSent;
  const waiting = rc?.waiting ?? s.awaiting;
  const replied = Math.max(0, invited - waiting);
  return { invited, replied, waiting, generalLinkReplies: null, rate: invited > 0 ? replied / invited : null, hasGuestList: invited > 0 };
}

export function useReplyCounts(eventId: string | undefined, invitesSentManual: number, deps: unknown[] = []) {
  return useAsync(async () => {
    if (!eventId) return replyCounts([], [], invitesSentManual);
    const [inv, pend] = await Promise.all([
      allInvitees(eventId),
      api<GuestList>(`/api/events/${eventId}/guests`, { query: { status: "pending", trash: false, limit: 200 } }),
    ]);
    return replyCounts(inv, pend.items, invitesSentManual);
  }, [eventId, invitesSentManual, ...deps]);
}
