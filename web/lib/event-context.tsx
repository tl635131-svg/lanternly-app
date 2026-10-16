"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import type { EventT, Stats } from "./types";

type StreamMsg = { type: string; eventId: string; data: unknown; at: string };
type Ctx = {
  event: EventT | null; error: unknown; loading: boolean; reload: () => Promise<void>;
  stats: Stats | null; setStats: (s: Stats) => void; live: boolean;
  subscribe: (fn: (m: StreamMsg) => void) => () => void;
  canWrite: boolean; isOwner: boolean;
};
const EventCtx = createContext<Ctx | null>(null);
export const useEvent = () => {
  const c = useContext(EventCtx);
  if (!c) throw new Error("useEvent outside EventProvider");
  return c;
};

/** Loads the event and keeps one SSE connection open for live updates (api-contract.md §8). */
export function EventProvider({ eventId, children }: { eventId: string; children: ReactNode }) {
  const [event, setEvent] = useState<EventT | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [live, setLive] = useState(false);
  const subs = useRef(new Set<(m: StreamMsg) => void>());

  const reload = useCallback(async () => {
    try {
      const [e, s] = await Promise.all([api<EventT>(`/api/events/${eventId}`), api<Stats>(`/api/events/${eventId}/stats`)]);
      setEvent(e);
      setStats(s);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!event) return;
    const es = new EventSource(`/api/events/${eventId}/stream`, { withCredentials: true });
    const handler = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data) as StreamMsg;
        if (msg.type === "stats.updated") setStats(msg.data as Stats);
        if (msg.type === "stage.changed" || msg.type === "invitation.updated" || msg.type === "brief.updated" || msg.type === "revision.updated") reload();
        subs.current.forEach((fn) => fn(msg));
      } catch {
        /* ignore malformed */
      }
    };
    es.addEventListener("ready", () => setLive(true));
    es.onerror = () => setLive(false);
    for (const t of ["guest.created", "guest.updated", "guest.deleted", "stats.updated", "stage.changed", "brief.updated", "revision.updated", "invitation.updated"]) es.addEventListener(t, handler as EventListener);
    es.onmessage = handler;
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id, eventId]);

  const subscribe = useCallback((fn: (m: StreamMsg) => void) => {
    subs.current.add(fn);
    return () => {
      subs.current.delete(fn);
    };
  }, []);

  const canWrite = !!event && event.myRole !== "viewer";
  const isOwner = event?.myRole === "owner";
  return <EventCtx.Provider value={{ event, error, loading, reload, stats, setStats, live, subscribe, canWrite, isOwner }}>{children}</EventCtx.Provider>;
}
