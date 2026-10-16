"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiError, setCsrf } from "./api";
import type { Me } from "./types";

type Session = { me: Me | null; loading: boolean; refresh: () => Promise<Me | null>; logout: () => Promise<void>; setMe: (m: Me) => void };
const Ctx = createContext<Session>({ me: null, loading: true, refresh: async () => null, logout: async () => {}, setMe: () => {} });
export const useSession = () => useContext(Ctx);

export async function fetchMe(): Promise<Me | null> {
  try {
    const me = await api<Me>("/api/auth/me");
    setCsrf(me.csrfToken);
    return me;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

/** Wraps signed-in areas. Redirects to /login?next=… when there is no session. */
export function SessionProvider({ children, require = true }: { children: ReactNode; require?: boolean }) {
  const [me, setMeState] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    const m = await fetchMe().catch(() => null);
    setMeState(m);
    setLoading(false);
    return m;
  }, []);

  useEffect(() => {
    refresh().then((m) => {
      if (!m && require) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    });
  }, [refresh, require, router, pathname]);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setCsrf(null);
    setMeState(null);
    router.replace("/login?signedOut=1");
  }, [router]);

  const setMe = useCallback((m: Me) => {
    setCsrf(m.csrfToken);
    setMeState(m);
  }, []);

  return <Ctx.Provider value={{ me, loading, refresh, logout, setMe }}>{children}</Ctx.Provider>;
}

export function landingFor(me: Me, joinedEventId?: string | null) {
  if (me.role === "admin" || me.role === "staff") return "/admin";
  if (joinedEventId) return `/app/${joinedEventId}`;
  if (me.memberships.length === 1) return `/app/${me.memberships[0].eventId}`;
  return "/app";
}
