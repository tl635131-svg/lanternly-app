"use client";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand";
import { Button, ButtonLink } from "./primitives";
import { IconLantern } from "./icons";

type Action = { label: string; href?: string; onClick?: () => void };

/** Full-page empty / invalid-link / 404 pattern (design-review C7): logo + `.empty` card on the canvas. */
export function EmptyPage({ title, body, icon, action, secondary, overline }: { title: string; body?: ReactNode; icon?: ReactNode; action?: Action; secondary?: Action; overline?: string }) {
  const btn = (a: Action, variant: "primary" | "outline") =>
    a.href ? <ButtonLink href={a.href} variant={variant}>{a.label}</ButtonLink> : <Button variant={variant} onClick={a.onClick}>{a.label}</Button>;
  return (
    <main id="main" className="flex min-h-svh flex-col items-center bg-canvas px-5 py-10">
      <Logo height={28} />
      <div className="flex w-full flex-1 items-center justify-center py-10">
        <div className="empty w-full max-w-md rounded-xl border border-line bg-surface px-8 py-10 shadow-raised">
          <div className="orb mb-3">{icon ?? <IconLantern size={28} />}</div>
          {overline && <p className="text-overline font-bold uppercase tracking-[.12em] text-accent-text">{overline}</p>}
          <h1 className="font-display text-h2 text-ink">{title}</h1>
          {body && <p className="text-body-sm text-muted">{body}</p>}
          {(action || secondary) && <div className="mt-3 flex flex-wrap justify-center gap-2.5">{action && btn(action, "primary")}{secondary && btn(secondary, "outline")}</div>}
        </div>
      </div>
    </main>
  );
}
