// Editor field definitions per invitation section (shapes follow the API theme engine).
import type { AssetKind } from "@/lib/types";
import { giftCheck } from "@/lib/validate";

/** A sub-field of a group (e.g. gift bank details). `check` returns an error message or null; `digits` strips spaces before saving. */
export type GroupField = { key: string; label: string; hint?: string; inputMode?: "text" | "email" | "numeric"; maxLength?: number; check?: (v: string) => string | null; digits?: boolean; advanced?: boolean };

export type RowField = { key: string; label: string; type?: "text" | "textarea" | "url" | "time" | "asset"; placeholder?: string; required?: boolean; max?: number; assetKinds?: AssetKind[] };
type When = { when?: (data: Record<string, unknown>) => boolean };
export type FieldDef = When & (
  | { key: string; label: string; type?: "text" | "textarea" | "url" | "time" | "datetime" | "date" | "email"; placeholder?: string; hint?: string; max?: number; check?: (v: string) => string | null }
  | { key: string; label: string; type: "color"; hint?: string }
  | { key: string; label: string; type: "asset" | "assets"; assetKinds: AssetKind[]; hint?: string; max?: number }
  | { key: string; label: string; type: "track"; hint?: string }
  | { key: string; label: string; type: "rights" }
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[] }
  | { key: string; label: string; type: "colors" }
  | { key: string; label: string; type: "rows"; item: string; max?: number; fields: RowField[] }
  | { key: string; label: string; type: "group"; hint?: string; advancedLabel?: string; fields: GroupField[] });

export type SectionDef = { key: string; label: string; group: string; fields: FieldDef[]; validate?: (data: Record<string, unknown>) => Record<string, string> };
/** Fields shown for the current data (e.g. gift payout fields only in money mode). */
export const visibleFields = (def: SectionDef, data: Record<string, unknown> | undefined) => def.fields.filter((f) => !f.when || f.when(data ?? {}));

const heading = (ph: string): FieldDef => ({ key: "heading", label: "Section title", type: "text", placeholder: ph });

export const SECTION_DEFS: SectionDef[] = [
  { key: "invitation_text", label: "Invitation message", group: "Essentials", fields: [heading("You are invited"), { key: "body", label: "Message", type: "textarea", placeholder: "Join us for an evening of…" }] },
  { key: "countdown", label: "Countdown", group: "Essentials", fields: [heading("Counting down"), { key: "startAt", label: "Count down to", type: "datetime", hint: "Usually the ceremony start time." }] },
  { key: "venue", label: "Venue & map", group: "Essentials", fields: [heading("Where & when"), { key: "items", label: "Places", type: "rows", item: "place", fields: [
    { key: "label", label: "Label", placeholder: "Ceremony" }, { key: "name", label: "Venue name", required: true }, { key: "address", label: "Address" },
    { key: "startsAt", label: "Starts", type: "time" }, { key: "endsAt", label: "Ends", type: "time" }, { key: "mapQuery", label: "Map search (optional)", placeholder: "Defaults to the name and address" }, { key: "note", label: "Note", type: "textarea" },
  ] }] },
  { key: "our_story", label: "Our story", group: "Story", fields: [heading("Our story"), { key: "text", label: "Your story", type: "textarea" }, { key: "milestones", label: "Milestones", type: "rows", item: "milestone", fields: [
    { key: "year", label: "Year", required: true, max: 10 }, { key: "title", label: "Title", required: true }, { key: "photo", label: "Photo", type: "asset", assetKinds: ["brief_photo", "gallery"] }, { key: "text", label: "What happened", type: "textarea", required: true },
  ] }] },
  { key: "timeline", label: "Schedule", group: "The day", fields: [heading("The day"), { key: "rows", label: "Moments", type: "rows", item: "moment", fields: [
    { key: "time", label: "Time", type: "time", required: true }, { key: "title", label: "What", required: true }, { key: "description", label: "Details" },
  ] }] },
  { key: "dress_code", label: "Dress code", group: "The day", fields: [heading("What to wear"), { key: "text", label: "Guidance", type: "textarea" }, { key: "palette", label: "Suggested colours", type: "colors" }] },
  { key: "menu", label: "Menu", group: "The day", fields: [heading("At the table"), { key: "main", label: "Main idea", placeholder: "A long family-style dinner" }, { key: "courses", label: "Courses", type: "textarea" }] },
  // Gifts are display-only: the couple's message, one way to give they manage themselves, and/or registry links. We never take money.
  { key: "gift_list", label: "Gifts", group: "Guests", fields: [heading("Gifts"),
    { key: "mode", label: "What would you like to share?", type: "select", options: [{ value: "registry", label: "Registry links" }, { value: "cash", label: "Money gift details" }, { value: "both", label: "Both" }] },
    { key: "note", label: "Your message to guests", type: "textarea", max: 1000, placeholder: "Your presence is the best gift. If you'd like to give something, here's how.", hint: "Optional." },
    { key: "registries", label: "Registry links", type: "rows", item: "registry", max: 10, when: (d) => d.mode !== "cash", fields: [
      { key: "name", label: "Name", max: 120 }, { key: "url", label: "Link (https://…)", type: "url", required: true, max: 500 },
    ] },
    { key: "interacEmail", label: "Interac e-Transfer email", type: "email", placeholder: "you@example.com", hint: "Guests in Canada can send an e-Transfer to this email from their own bank.", max: 255, check: giftCheck.interacEmail, when: (d) => d.mode === "cash" || d.mode === "both" },
    { key: "bank", label: "Bank deposit details", type: "group", hint: "Or share a full Canadian account (institution, transit and account numbers) or an IBAN.", advancedLabel: "International guests (IBAN / BIC)", when: (d) => d.mode === "cash" || d.mode === "both", fields: [
      { key: "holder", label: "Account holder", maxLength: 120 }, { key: "bank", label: "Bank name", maxLength: 120 },
      { key: "institutionNumber", label: "Institution number", hint: "3 digits", inputMode: "numeric", maxLength: 3, check: giftCheck.institutionNumber, digits: true },
      { key: "transitNumber", label: "Transit number", hint: "5 digits", inputMode: "numeric", maxLength: 5, check: giftCheck.transitNumber, digits: true },
      { key: "accountNumber", label: "Account number", hint: "7 to 12 digits", inputMode: "numeric", maxLength: 12, check: giftCheck.accountNumber, digits: true },
      { key: "reference", label: "Reference", hint: "e.g. Maya & Theo gift", maxLength: 120 },
      { key: "iban", label: "IBAN", hint: "Optional", maxLength: 50, check: giftCheck.iban, advanced: true },
      { key: "bic", label: "BIC / SWIFT", hint: "Optional, 8 or 11 characters", maxLength: 11, check: giftCheck.bic, advanced: true },
    ] },
  ], validate: (d) => {
    const e: Record<string, string> = {};
    const mode = (d.mode as string) || "registry";
    const blank = (v: unknown) => typeof v !== "string" || !v.trim();
    if (mode === "cash" || mode === "both") {
      const b = (d.bank ?? {}) as Record<string, string>;
      const ok = !blank(d.interacEmail) || (!blank(b.institutionNumber) && !blank(b.transitNumber) && !blank(b.accountNumber)) || !blank(b.iban);
      if (!ok) e.bank = "Add one complete way to give: an Interac email, or the institution, transit and account numbers, or an IBAN.";
    }
    if (mode === "registry" || mode === "both") {
      const rows = Array.isArray(d.registries) ? (d.registries as { url?: string }[]) : [];
      if (!rows.some((r) => typeof r.url === "string" && r.url.trim()) && blank(d.registryUrl)) e.registries = "Add at least one registry link.";
      rows.forEach((r, i) => { if (r.url && !/^https:\/\//.test(r.url.trim())) e[`registries.${i}.url`] = "Use a link that starts with https://"; });
    }
    return e;
  } },
  { key: "accommodation", label: "Where to stay", group: "Travel", fields: [heading("Where to stay"), { key: "rows", label: "Places to stay", type: "rows", item: "place", fields: [
    { key: "name", label: "Name", required: true }, { key: "address", label: "Address", required: true }, { key: "url", label: "Website", type: "url" }, { key: "note", label: "Note (group code, etc.)" },
  ] }] },
  { key: "transport", label: "Getting there", group: "Travel", fields: [heading("Getting there"), { key: "rows", label: "Options", type: "rows", item: "option", fields: [
    { key: "type", label: "Type", placeholder: "Shuttle", required: true }, { key: "time", label: "Time", type: "time", required: true }, { key: "from", label: "From" }, { key: "to", label: "To" }, { key: "note", label: "Note" },
  ] }] },
  { key: "pre_wedding", label: "The night before", group: "Extras", fields: [heading("Welcome evening"), { key: "date", label: "When" }, { key: "location", label: "Where" }, { key: "details", label: "Details", type: "textarea" }] },
  { key: "activities", label: "Things to do", group: "Extras", fields: [heading("While you're here"), { key: "rows", label: "Activities", type: "rows", item: "activity", fields: [
    { key: "name", label: "Name", required: true }, { key: "date", label: "When", required: true }, { key: "details", label: "Details", type: "textarea" },
  ] }] },
  { key: "faq", label: "FAQ", group: "Guests", fields: [heading("Good to know"), { key: "rows", label: "Questions", type: "rows", item: "question", fields: [
    { key: "question", label: "Question", required: true }, { key: "answer", label: "Answer", type: "textarea", required: true },
  ] }] },
  { key: "photos", label: "Photos", group: "Story", fields: [heading("Moments"), { key: "intro", label: "Intro line", type: "text" }, { key: "rows", label: "Photos", type: "rows", item: "photo", max: 30, fields: [
    { key: "assetId", label: "Photo", type: "asset", required: true, assetKinds: ["gallery", "brief_photo"] }, { key: "name", label: "Caption" },
  ] }] },
  { key: "rsvp", label: "Reply form", group: "Essentials", fields: [heading("Kindly reply"), { key: "intro", label: "Intro line", placeholder: "Please let us know by…" }, { key: "thankYouYes", label: "Thank-you message (coming)", type: "textarea" }, { key: "thankYouNo", label: "Message (not coming)", type: "textarea" }] },
];
/** Fallback display name for a `custom:<slug>` key ("custom:kids-corner" → "Kids corner"). */
export const customLabel = (key: string, names?: Record<string, string> | null) => names?.[key] ?? (key.slice(7).replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()) || "Custom section");
export const slugifyCustom = (name: string) => name.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
/** Invitation custom block: optional title + body text. */
export const CUSTOM_DEF = (key: string, title?: string): SectionDef => ({ key, label: title || customLabel(key), group: "Extras", fields: [{ key: "title", label: "Title shown to guests", type: "text", max: 120 }, { key: "content", label: "Text", type: "textarea", max: 5000 }] });
/** Brief custom block: body text only (no title in the brief schema). */
export const BRIEF_CUSTOM_DEF = (key: string, names?: Record<string, string> | null): SectionDef => ({ key, label: customLabel(key, names), group: "Extras", fields: [{ key: "content", label: "What should this section say?", type: "textarea", max: 5000 }] });
export const defFor = (key: string, title?: string) => (key.startsWith("custom:") ? CUSTOM_DEF(key, title) : SECTION_DEFS.find((d) => d.key === key));

/* ── Validation matching the API contract (required row fields, lengths, colours) ── */
const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const rowIsEmpty = (row: Record<string, unknown>) => Object.values(row).every(isBlank);

/** Errors keyed like the API (`rows.0.address`). Fully empty rows are ignored (they're dropped on save). */
export function validateSection(def: SectionDef | undefined, data: Record<string, unknown> | undefined): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!def || !data) return errors;
  if (def.validate && Object.values(data).some((v) => v !== undefined && v !== "")) Object.assign(errors, def.validate(data));
  for (const f of visibleFields(def, data)) {
    const v = data[f.key];
    if (f.type === "rows" && Array.isArray(v)) {
      (v as Record<string, unknown>[]).forEach((row, i) => {
        if (rowIsEmpty(row)) return;
        for (const rf of f.fields) {
          const rv = row[rf.key];
          if (rf.required && isBlank(rv)) errors[`${f.key}.${i}.${rf.key}`] = "Required";
          else if (rf.max && typeof rv === "string" && rv.length > rf.max) errors[`${f.key}.${i}.${rf.key}`] = `Max ${rf.max} characters`;
        }
      });
    } else if (f.type === "colors" && Array.isArray(v)) {
      (v as string[]).forEach((c, i) => { if (!/^#[0-9a-fA-F]{6}$/.test(c)) errors[`${f.key}.${i}`] = "Use a #RRGGBB colour"; });
    } else if (f.type === "color" && typeof v === "string" && v && !/^#[0-9a-fA-F]{6}$/.test(v)) {
      errors[f.key] = "Use a #RRGGBB colour";
    } else if (f.type === "group" && v && typeof v === "object") {
      for (const sf of f.fields) {
        const sv = (v as Record<string, unknown>)[sf.key];
        const m = typeof sv === "string" && sv.trim() ? sf.check?.(sv) : null;
        if (m) errors[`${f.key}.${sf.key}`] = m;
      }
    } else if ("max" in f && f.max && typeof v === "string" && v.length > f.max) {
      errors[f.key] = `Max ${f.max} characters`;
    } else if ("check" in f && f.check && typeof v === "string" && v.trim()) {
      const m = f.check(v);
      if (m) errors[f.key] = m;
    }
  }
  return errors;
}

/** Shape a section for the API: drop fully empty rows, make sure required row keys exist, strip empty optional asset refs. */
export function normalizeSection(def: SectionDef | undefined, data: Record<string, unknown>): Record<string, unknown> {
  if (!def) return data;
  const out: Record<string, unknown> = { ...data };
  for (const f of def.fields) if (f.when && !f.when(data)) delete out[f.key];
  if (def.key === "gift_list") {
    // Fold the legacy single link into `registries`, and send only whitelisted gift keys.
    const regs = Array.isArray(out.registries) ? [...(out.registries as Record<string, unknown>[])] : [];
    if (typeof out.registryUrl === "string" && out.registryUrl.trim() && out.mode !== "cash" && !regs.some((r) => r.url === out.registryUrl)) regs.unshift({ url: out.registryUrl });
    delete out.registryUrl;
    if (out.mode !== "cash") out.registries = regs;
    for (const k of Object.keys(out)) if (!["mode", "note", "registries", "interacEmail", "bank", "heading"].includes(k)) delete out[k];
  }
  for (const f of visibleFields(def, out)) {
    if (f.type === "rows" && Array.isArray(out[f.key])) {
      out[f.key] = (out[f.key] as Record<string, unknown>[]).filter((r) => !rowIsEmpty(r)).map((r) => {
        const row: Record<string, unknown> = { ...r }; // keep keys the editor doesn't show (e.g. venue lat/lng)
        for (const rf of f.fields) {
          const rv = r[rf.key];
          if (rf.required && rf.type !== "asset") row[rf.key] = typeof rv === "string" ? rv : "";
          else if (isBlank(rv)) delete row[rf.key];
        }
        return row;
      });
    }
    if ((f.type === "asset" || f.type === "track") && isBlank(out[f.key])) delete out[f.key];
    if (f.type === "color" && isBlank(out[f.key])) delete out[f.key];
    if (f.type === "email" && isBlank(out[f.key])) delete out[f.key];
    if (f.type === "group" && out[f.key] && typeof out[f.key] === "object") {
      const g: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(out[f.key] as Record<string, unknown>)) {
        if (isBlank(v)) continue;
        const sf = f.fields.find((x) => x.key === k);
        g[k] = typeof v === "string" ? (sf?.digits ? v.replace(/\s/g, "") : k === "bic" ? v.trim().toUpperCase() : v.trim()) : v;
      }
      if (Object.keys(g).length) out[f.key] = g;
      else delete out[f.key];
    }
  }
  return out;
}
export const CORE = ["hero", "invitation_text", "venue", "rsvp"];
