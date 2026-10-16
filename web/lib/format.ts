export const t = (m: Record<string, string> | undefined | null, lang = "en") => (m ? m[lang] ?? m.en ?? Object.values(m)[0] ?? "" : "");

export function money(cents: number, currency = "CAD") {
  const v = cents / 100;
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: v % 1 ? 2 : 0 }).format(v);
}
export function formatDate(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "long" }, locale = "en-CA") {
  if (!d) return "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00") : new Date(d);
  return new Intl.DateTimeFormat(locale, opts).format(date);
}
export function relTime(iso: string) {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return formatDate(iso, { dateStyle: "medium" });
}
export const humanize = (s: string) => s.replace(/^custom:/, "").replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);
export const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
export const STAGES = [
  { key: "order_received", label: "Order received", desc: "Payment confirmed. We've opened your project." },
  { key: "brief_received", label: "Brief received", desc: "Thanks for the details. We're reviewing them now." },
  { key: "in_queue", label: "In the queue", desc: "Your invitation has a slot on a designer's calendar." },
  { key: "designing", label: "Designing", desc: "A designer is building your invitation." },
  { key: "review", label: "Your review", desc: "Your draft is ready. Have a look and ask for changes or approve it." },
  { key: "delivered", label: "Delivered", desc: "Your invitation is live and ready to share." },
] as const;
