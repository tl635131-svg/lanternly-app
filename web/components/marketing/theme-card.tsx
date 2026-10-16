import type { Theme } from "@/lib/types";
import { t } from "@/lib/format";
import { invVars } from "@/lib/palette";
import { Badge, ButtonLink, cx } from "@/components/ui/primitives";
import { IconEye } from "@/components/ui/icons";

/**
 * Mini phone cover rendered from a theme's palette (no images needed). Each theme gets its own
 * composition (orb position + type scale) so the gallery isn't one layout with a colour swap (B14).
 */
export function ThemePhone({ theme, index = 0, names = "Maya & Theo", date = "12 Jun 2027", className, small }: { theme: Pick<Theme, "defaultConfig" | "key">; index?: number; names?: string; date?: string; className?: string; small?: boolean }) {
  const { style, light } = invVars(theme.defaultConfig);
  const variant = index % 3;
  const parts = names.split(/\s*&\s*/);
  const nameEl = (
    <span className={cx("block font-bold leading-[1.02] tracking-[-.04em] [text-wrap:balance]", small ? "text-[15px]" : variant === 2 ? "text-[30px]" : "text-[24px]")} style={{ color: "var(--inv-head)", fontFamily: "var(--inv-display)" }}>
      {parts.length === 2 ? <>{parts[0]}<br />&amp; {parts[1]}</> : names}
    </span>
  );
  return (
    <div
      aria-hidden
      className={cx("inv relative aspect-[9/16] w-full overflow-hidden rounded-[18px] shadow-[0_0_0_1.5px_rgba(42,45,92,.55)]", light && "light", className)}
      style={{ ...style, minHeight: 0 }}
    >
      <span className="inv-bloom" style={variant === 0 ? { width: "150%", aspectRatio: 1, left: "-25%", top: "8%" } : variant === 1 ? { width: "130%", aspectRatio: 1, right: "-55%", top: "-30%" } : { width: "140%", aspectRatio: 1, left: "-20%", bottom: "-55%" }} />
      <div className={cx("relative flex h-full flex-col px-[10%]", variant === 0 && "items-center justify-center text-center", variant === 1 && "justify-start pt-[22%] text-left", variant === 2 && "justify-end pb-[16%] text-left")}>
        {!small && <span className="mb-2 text-[12px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--inv-glow-text)" }}>Invited</span>}
        {nameEl}
        <span className={cx("my-2 h-[2px] w-6 rounded", variant === 0 && "mx-auto")} style={{ background: "var(--inv-accent)" }} />
        {!small && <span className="text-[12px] font-semibold" style={{ color: "var(--inv-muted)" }}>{date}</span>}
        <span className={cx("mt-3 inline-flex w-fit items-center rounded-[8px] font-bold", small ? "h-5 px-2 text-[12px]" : "h-7 px-3 text-[12px]", variant === 0 && "mx-auto")} style={{ background: "var(--inv-accent)", color: "var(--inv-on-accent)" }}>Open</span>
      </div>
    </div>
  );
}

export function ThemeCard({ theme, index, selected, onSelect }: { theme: Theme; index?: number; selected?: boolean; onSelect?: () => void }) {
  const soon = theme.status !== "active";
  const body = (
    <>
      <div className="relative">
        <ThemePhone theme={theme} index={index} />
        <div className="absolute left-2 top-2 flex gap-1">
          {theme.isNew && <Badge tone="accent">New</Badge>}
          {theme.isPopular && <Badge tone="accent">Popular</Badge>}
          {soon && <Badge>Coming soon</Badge>}
        </div>
        {selected && <span aria-hidden className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-on-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.2 4.2L19 7" /></svg></span>}
      </div>
      <div className="mt-3 text-left">
        <h3 className="font-semibold text-ink">{t(theme.name)}</h3>
        {theme.description && <p className="mt-1 text-body-sm text-muted">{t(theme.description)}</p>}
      </div>
    </>
  );
  if (onSelect)
    return (
      <button
        type="button"
        disabled={soon}
        aria-pressed={selected}
        onClick={onSelect}
        className={cx("rounded-card p-2 text-left transition disabled:opacity-60", selected ? "bg-tint shadow-[inset_0_0_0_2px_var(--brand-primary)]" : "hover:bg-surface-2")}
      >
        {body}
      </button>
    );
  return (
    <div className="flex h-full flex-col p-1">
      {body}
      {/* B13: every theme card gets the same Preview action */}
      <div className="mt-auto pt-3">
        {theme.demoSlug && !soon
          ? <ButtonLink href={`/i/${theme.demoSlug}`} variant="outline" size="sm" className="w-full"><IconEye size={16} />Preview</ButtonLink>
          : <span className="inline-flex h-9 items-center text-caption text-muted">{soon ? "Preview coming soon" : "Preview after you start"}</span>}
      </div>
    </div>
  );
}
