"use client";
import Link from "next/link";
import { useSession } from "@/lib/session";
import { Logo } from "@/components/brand";
import { IconLogout } from "@/components/ui/icons";
import { initials } from "@/lib/format";

export function AppHeader() {
  const { me, logout } = useSession();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Logo height={24} href="/app" />
          <Link href="/app" className="hidden text-sm font-medium text-muted hover:text-ink sm:inline">My invitations</Link>
          {(me?.role === "admin" || me?.role === "staff") && <Link href="/admin" className="hidden text-sm font-medium text-muted hover:text-ink sm:inline">Studio console</Link>}
        </div>
        {me && (
          <div className="flex items-center gap-2">
            <span className="hidden text-right text-sm sm:block"><span className="block font-semibold leading-tight">{me.user.name ?? me.user.email}</span><span className="text-xs text-muted">{me.user.email}</span></span>
            <span aria-hidden className="grid size-9 place-items-center rounded-full bg-tint text-sm font-bold text-primary">{initials(me.user.name ?? me.user.email)}</span>
            <button onClick={logout} className="grid size-11 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink" aria-label="Sign out" title="Sign out"><IconLogout size={18} /></button>
          </div>
        )}
      </div>
    </header>
  );
}
