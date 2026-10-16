"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useSession } from "@/lib/session";
import { Logo } from "@/components/brand";
import { EmptyPage } from "@/components/ui/empty-page";
import { LoadingBlock, cx } from "@/components/ui/primitives";
import { IconInbox, IconLayout, IconLogout, IconMail, IconSparkle, IconUsers } from "@/components/ui/icons";
import { initials } from "@/lib/format";

const NAV = [
  { href: "/admin", label: "Pipeline", icon: IconLayout, exact: true },
  { href: "/admin/orders", label: "Orders", icon: IconInbox, adminOnly: true },
  { href: "/admin/catalogue", label: "Catalogue", icon: IconSparkle },
  { href: "/admin/messages", label: "Emails", icon: IconMail },
  { href: "/admin/team", label: "Team", icon: IconUsers, adminOnly: true },
];

/** Studio console frame: role gate (staff/admin only), sidebar on desktop, bottom tabs on mobile. */
export function AdminShell({ children }: { children: ReactNode }) {
  const { me, loading, logout } = useSession();
  const path = usePathname();
  if (loading || !me) return <main id="main" className="mx-auto w-full max-w-6xl px-4 py-10"><LoadingBlock rows={4} label="Loading the studio console" /></main>;
  if (me.role !== "staff" && me.role !== "admin")
    return <EmptyPage overline="Studio team only" title="This area is for the studio" body="You're signed in as a host. Your invitations live in your dashboard." action={{ label: "Go to my invitations", href: "/app" }} />;
  // N-34: Orders and Team are admin-only (the API returns 403 to staff), so staff don't see them,
  // and a staff member who opens one by URL gets a clear message instead of an error box.
  const nav = NAV.filter((n) => !n.adminOnly || me.role === "admin");
  const blocked = me.role !== "admin" && NAV.some((n) => n.adminOnly && path.startsWith(n.href));
  const active = (n: (typeof NAV)[number]) => (n.exact ? path === n.href || path.startsWith("/admin/events") : path.startsWith(n.href));
  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="flex h-16 items-center px-5"><Logo height={24} href="/admin" /></div>
        <p className="px-5 pb-2 text-overline font-semibold uppercase tracking-wider text-muted">Studio console</p>
        <nav aria-label="Studio console" className="flex flex-col gap-1 px-3">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n) ? "page" : undefined}
              className={cx("flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold", active(n) ? "bg-tint text-primary" : "text-muted hover:bg-surface-2 hover:text-ink")}>
              <n.icon size={18} />{n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-line p-4">
          <div className="flex items-center gap-3">
            <span aria-hidden className="avatar">{initials(me.user.name ?? me.user.email)}</span>
            <span className="min-w-0 flex-1 text-sm"><span className="block truncate font-semibold">{me.user.name ?? me.user.email}</span><span className="block text-caption capitalize text-muted">{me.role === "admin" ? "Studio admin" : "Designer"}</span></span>
            <button onClick={logout} className="grid size-11 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink" aria-label="Sign out"><IconLogout size={18} /></button>
          </div>
          {me.memberships.length > 0 && <Link href="/app" className="mt-2 inline-flex min-h-11 items-center text-caption font-semibold text-primary underline">My own invitations</Link>}
        </div>
      </aside>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur md:hidden">
        <Logo height={22} href="/admin" />
        <button onClick={logout} className="grid size-11 place-items-center rounded-md text-muted" aria-label="Sign out"><IconLogout size={18} /></button>
      </header>
      <main id="main" className="pb-tabbar min-w-0 flex-1 px-4 pt-6 sm:px-6 md:!pb-12 lg:px-10 lg:pt-8">
        {blocked ? (
          <div className="mx-auto max-w-lg py-16 text-center">
            <p className="text-overline font-semibold uppercase tracking-wider text-muted">Admins only</p>
            <h1 className="font-display mt-2 text-[28px]">This page is for studio admins</h1>
            <p className="mt-2 text-muted">Orders and team settings are managed by an admin. Your events are on the pipeline.</p>
            <Link href="/admin" className="mt-6 inline-flex min-h-11 items-center rounded-md bg-primary px-5 font-semibold text-on-primary">Back to the pipeline</Link>
          </div>
        ) : children}
      </main>
      <nav aria-label="Studio console" className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-surface shadow-raised md:hidden" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))`, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {nav.map((n) => (
          <Link key={n.href} href={n.href} aria-current={active(n) ? "page" : undefined} className={cx("flex h-16 flex-col items-center justify-center gap-1 text-overline font-semibold", active(n) ? "text-primary" : "text-muted")}>
            <n.icon size={20} /><span className="max-w-full truncate px-0.5">{n.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
