"use client";
import Link from "next/link";
import { forwardRef, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { IconAlert, IconX } from "./icons";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: { theme: { color: ["canvas", "surface", "surface-2", "surface-raised", "line", "border-strong", "ink", "muted", "ink-subtle", "primary", "primary-hover", "on-primary", "accent", "on-accent", "accent-text", "tint", "night", "night-raised", "on-night", "on-night-muted", "glow", "focus", "focus-halo", "success", "success-soft", "danger", "danger-soft", "warning", "warning-soft", "info", "info-soft", "rsvp-attending", "rsvp-attending-soft", "rsvp-declined", "rsvp-declined-soft", "rsvp-pending", "rsvp-pending-soft", "rsvp-maybe", "rsvp-maybe-soft"], radius: ["xs", "card"], shadow: ["card", "raised", "pop", "glow", "glow-night"], text: ["caption", "overline", "body-sm", "body", "h3", "h2", "h1"] } },
});
const cx = (...c: (string | false | null | undefined)[]) => twMerge(c.filter(Boolean).join(" "));
export { cx };

type Variant = "primary" | "accent" | "outline" | "ghost" | "danger" | "night";
const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  accent: "bg-accent text-on-accent hover:brightness-95 shadow-glow",
  outline: "bg-surface text-ink shadow-[inset_0_0_0_1.5px_var(--brand-border-strong)] hover:bg-surface-2",
  ghost: "text-primary hover:bg-tint",
  danger: "bg-danger text-white hover:brightness-110",
  night: "bg-transparent text-on-night shadow-[inset_0_0_0_1.5px_rgba(238,237,249,.35)] hover:bg-white/5",
};
const sizes = { sm: "tap-44 h-9 px-3.5 text-sm gap-1.5 rounded-sm", md: "h-11 px-[18px] text-[15px] gap-2", lg: "h-[52px] px-6 text-base gap-2" };

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof sizes; loading?: boolean };
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "primary", size = "md", loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx(
        "inline-flex select-none items-center justify-center whitespace-nowrap rounded-md font-semibold transition-[background,box-shadow,filter] duration-150 ease-standard disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none",
        variants[variant], sizes[size], className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
});

export function ButtonLink({ href, variant = "primary", size = "md", className, children, ...rest }: { href: string; variant?: Variant; size?: keyof typeof sizes; className?: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const cls = cx("inline-flex items-center justify-center whitespace-nowrap rounded-md font-semibold transition-[background,box-shadow,filter] duration-150 ease-standard", variants[variant], sizes[size], className);
  if (/^(https?:|mailto:|sms:|tel:)/.test(href) || rest.target) return <a href={href} className={cls} {...rest}>{children}</a>;
  return <Link href={href} className={cls} {...rest}>{children}</Link>;
}

export function Spinner({ className = "size-5", label }: { className?: string; label?: string }) {
  return (
    <span role={label ? "status" : undefined} className="inline-flex items-center gap-2">
      <svg className={cx("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
        <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

export function Card({ className, children, as: As = "section", ...rest }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" | "li" } & React.HTMLAttributes<HTMLElement>) {
  return <As className={cx("rounded-card border border-line bg-surface p-5 shadow-card", className)} {...rest}>{children}</As>;
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "success" | "danger" | "warning" | "accent" | "primary" | "info"; children: ReactNode; className?: string }) {
  const tones = {
    neutral: "bg-surface-2 text-muted",
    info: "bg-info-soft text-info",
    success: "bg-success-soft text-success",
    danger: "bg-danger-soft text-danger",
    warning: "bg-warning-soft text-warning",
    accent: "bg-accent text-on-accent",
    primary: "bg-primary text-on-primary",
  };
  return <span className={cx("inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-xs px-2 text-xs font-semibold", tones[tone], className)}>{children}</span>;
}

/**
 * The one reply-status chip used everywhere (design-review A4/B9/B10):
 * Coming · Can't come · Maybe · Waiting, plus neutral/info for delivery states.
 */
export type ReplyTone = "attending" | "declined" | "maybe" | "pending" | "info" | "neutral";
export const REPLY_LABEL: Record<"attending" | "declined" | "maybe" | "pending", string> = { attending: "Coming", declined: "Can't come", maybe: "Maybe", pending: "Waiting" };
export function StatusChip({ tone, children, className }: { tone: ReplyTone; children?: ReactNode; className?: string }) {
  return <span className={cx("status", tone, className)}>{children ?? (tone in REPLY_LABEL ? REPLY_LABEL[tone as keyof typeof REPLY_LABEL] : null)}</span>;
}
/** Maps API attendance values (yes/no/pending, maybe if ever added) onto the chip. */
export const toneForAttendance = (a: string | null | undefined): ReplyTone =>
  a === "yes" || a === "attending" ? "attending" : a === "no" || a === "declined" ? "declined" : a === "maybe" ? "maybe" : "pending";

type FieldProps = { label: string; hint?: string; error?: string; required?: boolean; children: (p: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean; required?: boolean }) => ReactNode; className?: string; optional?: boolean };
export function Field({ label, hint, error, required, optional, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? id + "-hint" : undefined;
  const errId = error ? id + "-err" : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label} {required && <span aria-hidden className="text-danger">*</span>}
        {optional && <span className="font-medium text-ink-subtle"> (optional)</span>}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, required })}
      {hint && <p id={hintId} className="text-[13px] leading-snug text-muted">{hint}</p>}
      {error && <p id={errId} className="flex items-center gap-1.5 text-[13px] font-medium text-danger"><IconAlert size={14} />{error}</p>}
    </div>
  );
}
/* Inputs: 1.5px border-strong (#8A85B3, ≥3:1), 10px radius, 44px, focus = solid border + amber halo (A1/A2) */
const fieldBase =
  "w-full rounded-md border-[1.5px] border-border-strong bg-surface text-[15px] text-ink placeholder:text-ink-subtle aria-[invalid=true]:border-danger focus:border-focus focus:outline-none focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--brand-focus-halo)_35%,transparent)] disabled:bg-surface-2 disabled:text-muted";
export const inputCls = "h-11 px-3.5 " + fieldBase;
export const textareaCls = "min-h-24 px-3.5 py-3 resize-y " + fieldBase;
export const selectCls = inputCls + " pr-8";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("skeleton", className ?? "h-5 w-full")} />;
}

export function LoadingBlock({ label = "Loading", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className={cx("h-14", i % 2 ? "w-11/12" : "w-full")} />)}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty rounded-card border border-line bg-surface shadow-card">
      {icon && <div className="orb mb-2">{icon}</div>}
      <h3 className="font-display text-lg text-ink">{title}</h3>
      {body && <p className="max-w-md text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "We couldn't load this" }: { error: unknown; onRetry?: () => void; title?: string }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-card border border-danger/30 bg-danger-soft p-5 text-danger">
      <div className="flex items-center gap-2 font-semibold"><IconAlert />{title}</div>
      <p className="text-sm text-ink">{msg}</p>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Notice({ tone = "neutral", children, className }: { tone?: "neutral" | "warning" | "success" | "danger"; children: ReactNode; className?: string }) {
  const tones = { neutral: "bg-info-soft text-ink", warning: "bg-warning-soft text-warning", success: "bg-success-soft text-success", danger: "bg-danger-soft text-danger" };
  return <div className={cx("rounded-md px-4 py-3 text-sm", tones[tone], className)}>{children}</div>;
}

/** Accessible modal built on the native <dialog> element (focus trap + Esc for free). */
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Nested dialogs (e.g. refund confirm inside the order dialog): ignore close/cancel events from a child dialog.
      onClose={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onCancel={(e) => { if (e.target !== e.currentTarget) return; e.preventDefault(); onClose(); }}
      className={cx(
        "m-auto max-h-[92vh] w-[calc(100%-1.5rem)] overflow-hidden rounded-xl border-0 bg-surface p-0 text-ink shadow-pop backdrop:bg-[var(--brand-scrim)]",
        wide ? "max-w-3xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[92vh] flex-col">
          <header className="flex items-center justify-between gap-4 px-6 pb-1 pt-5">
            <h2 id={titleId} className="font-display text-lg">{title}</h2>
            <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-md text-muted hover:bg-surface-2" aria-label="Close dialog"><IconX /></button>
          </header>
          <div className="overflow-y-auto px-6 pb-5 pt-3">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2.5 border-t border-line bg-surface-2 px-6 py-4">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** design `.segmented` — never wraps; scrolls sideways with an edge fade when it doesn't fit (B3). */
export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; label: string; className?: string }) {
  return <ScrollFade className={className}>
    <div role="radiogroup" aria-label={label} className="segmented">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={cx("seg", value === o.value && "is-on")}>
          {o.label}{o.count != null && <span className="count tabular">{o.count}</span>}
        </button>
      ))}
    </div>
  </ScrollFade>;
}

/** Horizontal scroller with a right-edge fade that disappears once scrolled to the end. */
export function ScrollFade({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const upd = () => el.classList.toggle("at-end", el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
    upd();
    el.addEventListener("scroll", upd, { passive: true });
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", upd); ro.disconnect(); };
  }, []);
  return <div ref={ref} className={cx("seg-scroll", className)}>{children}</div>;
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm font-semibold">{label}</label>
        {description && <p className="text-[13px] text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative h-[26px] w-11 shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-border-strong")}
      >
        <span className={cx("absolute left-0 top-[3px] size-5 rounded-full bg-white transition-transform duration-200 ease-enter", checked ? "translate-x-[21px]" : "translate-x-[3px]")} />
      </button>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[28px] leading-tight text-ink sm:text-h1">{title}</h1>
        {subtitle && <div className="mt-1 text-body-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/**
 * An <img> for uploaded files. If the file is gone (e.g. storage wiped on a free host), it renders `fallback`
 * (nothing by default) instead of a broken-image icon.
 */
export function SafeImg({ fallback = null, onError, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fallback?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed || !props.src) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  return <img {...props} onError={(e) => { setFailed(true); onError?.(e); }} />;
}
