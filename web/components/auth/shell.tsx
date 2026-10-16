import type { ReactNode } from "react";
import { Logo } from "@/components/brand";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <main id="main" className="relative flex min-h-screen items-center justify-center overflow-hidden bg-night px-4 py-12">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/3 size-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-45 blur-3xl" style={{ background: "radial-gradient(circle, var(--brand-accent), transparent 62%)" }} />
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex justify-center"><Logo dark height={32} /></div>
        <div className="rounded-card border border-line bg-surface p-6 shadow-pop sm:p-8">
          <h1 className="font-display text-2xl text-ink">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}
