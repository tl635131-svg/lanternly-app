"use client";
import Link from "next/link";
import { useState } from "react";
import { Logo, BRAND_NAME } from "@/components/brand";
import { ButtonLink } from "@/components/ui/primitives";
import { IconMenu, IconX } from "@/components/ui/icons";

const nav = [
  { href: "/#styles", label: "Styles" },
  { href: "/#how", label: "How it works" },
  { href: "/#hosts", label: "For hosts" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteHeader({ dark = false }: { dark?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <header className={dark ? "bg-night text-on-night" : "border-b border-line bg-surface/90 backdrop-blur"}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo dark={dark} height={28} />
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium ${dark ? "text-on-night/85 hover:text-on-night" : "text-muted hover:text-ink"}`}>{n.label}</Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <ButtonLink href="/login" variant={dark ? "night" : "ghost"} size="sm" className={dark ? "border border-on-night/20" : ""}>Sign in</ButtonLink>
          <ButtonLink href="/pricing" variant="accent" size="sm">Create your invite</ButtonLink>
        </div>
        <button className="grid size-11 place-items-center rounded-md md:hidden" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)}>
          {open ? <IconX /> : <IconMenu />}
        </button>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Mobile" className={`border-t px-4 pb-4 md:hidden ${dark ? "border-on-night/15" : "border-line"}`}>
          <ul className="flex flex-col py-2">
            {nav.map((n) => (
              <li key={n.href}><Link onClick={() => setOpen(false)} href={n.href} className="block rounded-md px-2 py-3 font-medium">{n.label}</Link></li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2">
            <ButtonLink href="/login" variant="outline">Sign in</ButtonLink>
            <ButtonLink href="/pricing" variant="accent">Create invite</ButtonLink>
          </div>
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto bg-night text-on-night">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <Logo dark height={26} />
          <p className="mt-3 max-w-sm text-sm text-on-night/75">Invitations that glow on every phone, with replies, guest lists and seating gathered in one calm place.</p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-glow">Product</h2>
          <ul className="mt-3 space-y-2 text-sm text-on-night/80">
            <li><Link href="/#styles" className="inline-flex min-h-11 items-center hover:text-on-night">Styles</Link></li>
            <li><Link href="/pricing" className="inline-flex min-h-11 items-center hover:text-on-night">Pricing</Link></li>
            <li><Link href="/i/maya-and-theo" className="inline-flex min-h-11 items-center hover:text-on-night">See a live invite</Link></li>
            <li><Link href="/contact" className="inline-flex min-h-11 items-center hover:text-on-night">Contact us</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-glow">Account</h2>
          <ul className="mt-3 space-y-2 text-sm text-on-night/80">
            <li><Link href="/login" className="inline-flex min-h-11 items-center hover:text-on-night">Sign in</Link></li>
            <li><Link href="/login?mode=register" className="inline-flex min-h-11 items-center hover:text-on-night">Start for free</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-on-night/10 py-5 text-center text-xs text-on-night/60">© {new Date().getFullYear()} {BRAND_NAME}. Prices in Canadian dollars.</div>
    </footer>
  );
}
