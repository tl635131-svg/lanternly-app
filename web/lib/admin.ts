"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Brief, EventT, Revisions, Stage, Stats, User } from "@/lib/types";

/** Studio-facing stage names (the host sees friendlier copy from STAGES in lib/format). */
export const ADMIN_STAGES: { key: Stage; label: string }[] = [
  { key: "order_received", label: "Order received" },
  { key: "brief_received", label: "Brief received" },
  { key: "in_queue", label: "In queue" },
  { key: "designing", label: "Designing" },
  { key: "review", label: "Client review" },
  { key: "delivered", label: "Delivered" },
];
export const stageLabel = (s: string | null | undefined) => ADMIN_STAGES.find((x) => x.key === s)?.label ?? "—";

export type AdminEvent = EventT & {
  briefStatus: string | null; briefCompletion: { done: number; total: number; missing: string[] } | null;
  rsvp: { confirmed: number; declined: number; pending: number }; assignedStaff: { id: string; name: string | null; email: string } | null;
};
export type AdminEventDetail = Omit<EventT, "brief" | "revisions"> & {
  adminNote: string | null; assignedStaffId: string | null; deliveryEmailSentAt: string | null; deliveryEmailSentCount: number;
  deletionRequestedAt: string | null; progress: number; daysToEvent: number | null; brief: (Brief & { updatedAt?: string }) | null;
  revisions: Revisions | null; members: { role: string; user: User }[];
  orders: { id: string; number: string; status: string; totalCents: number; currency: string; paidAt: string | null; source?: "manual" | "checkout"; createdByAdminId?: string | null }[]; stats: Stats | null;
};
export type Order = {
  id: string; number: string; email: string; plan?: string; planCode?: string; status: string; subtotalCents: number; discountCents?: number; taxCents: number;
  totalCents: number; currency: string; paymentProvider: string; eventId: string | null; paidAt: string | null; createdAt: string;
  /** "manual" = created in the console (paymentProvider manual); "checkout" = paid through Stripe/mock checkout. */
  source?: "manual" | "checkout"; createdByAdminId?: string | null; refundReason?: string | null;
  items?: { id: string; kind: string; code: string; label: string; qty: number; unitPriceCents: number }[];
  refundedAt?: string | null; canceledAt?: string | null; stripeDashboardUrl?: string | null; languages?: string[]; theme?: { key: string; name: Record<string, string> } | null;
};
export type CheckoutDraft = {
  id: string; planCode: string; lastStep: string | null; themeKey: string | null; sections: string[]; extras: string[]; languages: string[];
  info: Record<string, unknown>; email: string | null; abandoned: boolean; convertedOrderId: string | null; createdAt: string; updatedAt: string;
};
export type Message = { id: string; eventId: string | null; channel: string; to: string; template: string; status: string; error: string | null; provider: string; sentAt: string | null; createdAt: string };
export type AdminReview = { id: string; displayName: string; location: string | null; text: string; isSample: boolean; published: boolean; createdAt: string };
export type AdminTrack = { id: string; title: string; artist: string; license: string; url: string | null; durationS: number; moodTags: string[]; active: boolean };
export type Metrics = {
  currency: string; orders: Record<string, number>; revenueLast30Days: { totalCents: number; taxCents?: number; orders: number };
  revenueAllTime: { totalCents: number; taxCents?: number; orders: number }; stages: Record<string, number>; events: { self_serve: number; studio: number }; rsvpsLast30Days: number;
};

/** Cursor-paginated GET: first page on mount / when `query` changes, then "Load more". */
export function usePaged<T>(path: string, query: Record<string, string | number | boolean | undefined>, limit = 50) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const key = JSON.stringify({ path, query });
  const seq = useRef(0);
  const load = useCallback(async (append: string | null) => {
    const n = ++seq.current;
    if (append) setMore(true); else setLoading(true);
    try {
      const r = await api<{ items: T[]; nextCursor?: string | null }>(path, { query: { ...query, limit, cursor: append ?? undefined } });
      if (n !== seq.current) return;
      setItems((prev) => (append ? [...prev, ...r.items] : r.items));
      setCursor(r.nextCursor ?? null);
      setError(null);
    } catch (e) { if (n === seq.current) setError(e); } finally { if (n === seq.current) { setLoading(false); setMore(false); } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { load(null); }, [load]);
  return { items, setItems, loading, error, hasMore: !!cursor, loadingMore: more, loadMore: () => cursor && load(cursor), reload: () => load(null) };
}

/** Manual vs checkout orders: older rows may only carry `paymentProvider`. */
export const orderSource = (o: { source?: string; paymentProvider?: string }) => (o.source ?? (o.paymentProvider === "manual" ? "manual" : "checkout")) as "manual" | "checkout";

/**
 * Build `extras` for POST /api/admin/events. The route takes `{code, qty}` items (api-contract.md);
 * set ADMIN_EXTRAS_AS_OBJECTS to false to fall back to repeated codes.
 */
export const ADMIN_EXTRAS_AS_OBJECTS = true;
export function adminExtras(codes: string[], extraLanguageUnits: number): (string | { code: string; qty: number })[] | undefined {
  const others = codes.filter((c) => c !== "extra_language");
  const units = Math.max(0, extraLanguageUnits);
  const out: (string | { code: string; qty: number })[] = ADMIN_EXTRAS_AS_OBJECTS
    ? [...others.map((code) => ({ code, qty: 1 })), ...(units ? [{ code: "extra_language", qty: units }] : [])]
    : [...others, ...Array.from({ length: units }, () => "extra_language")];
  return out.length ? out : undefined;
}
