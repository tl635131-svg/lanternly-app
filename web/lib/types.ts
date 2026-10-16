// Types mirror app/api-contract.md. OpenAPI (/docs/json) is the field-level source of truth.
export type I18n = Record<string, string>;
export type Role = "host" | "staff" | "admin";
export type EventRole = "owner" | "cohost" | "viewer";
export type Stage = "order_received" | "brief_received" | "in_queue" | "designing" | "review" | "delivered";
export type Attendance = "yes" | "no" | "pending";

export interface User { id: string; email: string; name: string | null; role: Role; locale: string; hasPassword: boolean; createdAt: string; lastLoginAt: string | null; disabled: boolean }
export interface Membership { eventId: string; role: EventRole; title: string; serviceMode: "self_serve" | "studio" }
export interface Me { user: User; role: Role; memberships: Membership[]; csrfToken: string; purpose?: string; joinedEventId?: string | null }

export interface Plan {
  code: string; product: string; serviceMode: "self_serve" | "studio"; name: I18n; description: I18n; features: I18n[];
  basePriceCents: number; currency: string; includedBlocks: number | null; extraBlockPriceCents: number; maxLanguages: number;
  revisionRounds: number; unlimitedRevisions: boolean; deliveryDays: number | null; includesAllExtras: boolean; hasRsvp: boolean;
  usesSections: boolean; steps: string[];
}
export interface Extra { code: string; name: I18n; description?: I18n; priceCents: number; currency: string; available: boolean }
export interface Theme {
  id: string; key: string; product: string | null; name: I18n; description?: I18n; moodTags?: string[]; previewVideoUrl: string | null;
  posterUrl: string | null; demoSlug: string | null; isNew?: boolean; isPopular?: boolean; status: "active" | "coming_soon" | string;
  /** null = fits every product; use `products` */ products?: string[]; sort?: number;
  defaultConfig?: InvitationConfig;
}
export interface Catalogue {
  currency: string; taxNote: string; plans: Plan[]; extras: Extra[]; planExtras: Record<string, string[]>; themes: Theme[]; extraBriefSections?: Record<string, string>;
  sections: { key: string; label: string }[]; languages: { code: string; label: string }[]; dietaryTags: string[];
  defaultRsvpSettings: Partial<RsvpSettings>;
}
export interface MusicTrack { id: string; title: string; artist: string; durationS: number; moodTags: string[]; url: string | null; license: string }
/** Testimonials: show a "Sample review" label when isSample; never stars or "verified" badges. */
export interface Review { id: string; displayName: string; location: string | null; text: string; isSample: boolean; createdAt: string }

export interface InvitationSummary { id: string; slug: string; url: string; status: "draft" | "published" | "archived"; kind: string; publishedAt: string | null; version: number; publishedVersion?: number | null }
export interface EventT {
  id: string; product: string; planCode: string | null; serviceMode: "self_serve" | "studio"; title: string;
  hostNames: { partner1?: string; partner2?: string; honoree?: string }; eventDate: string | null; timezone: string;
  venueName: string | null; venueAddress: string | null; primaryLanguage: string; languages: string[];
  productionStage: Stage | null; express: boolean; maxRevisionRounds: number; designApprovedAt: string | null; highSeasonNotice: boolean;
  invitesSentManual: number; remindersEnabled: boolean; reminderDaysBefore: number; notifyOnRsvp: boolean; paid: boolean; paidAt: string | null;
  deliveredAt: string | null; archiveAfter: string | null; createdAt: string; invitation: InvitationSummary | null; myRole: EventRole;
  daysToEvent?: number;
  /** Add-ons picked before paying (self-serve, unpaid) and add-ons already bought. */
  selectedExtras?: string[]; purchasedExtras?: string[];
  /** Plan limit plus purchased (or, unpaid, selected) extra_language units. */
  maxLanguages?: number;
  brief?: { status: string; locked: boolean; newSections: string[]; completion: { done: number; total: number; missing: string[] } } | null;
  revisions?: { max: number; used: number; open: boolean } | null;
}
export interface Stats {
  invitesSent: number; invitesSentSource: string; responses: number; awaiting: number; confirmed: number; declined: number; pending: number;
  /** N-40: guest-list entries, those with a yes/no reply, those without (= invited − replied), and general-link replies (not in the rate). */
  invited?: number; replied?: number; waiting?: number; generalLinkReplies?: number;
  /** replied / invited; null when there's no guest list. */
  totalAttendees: number; responseRate: number | null; confirmedRate: number | null; averageParty: number | null; responsesExceedInvites: boolean;
}
export interface Activity { id: string; action: string; actorType: string; data: { name?: string; guestId?: string; partySize?: number; attendance?: Attendance; [k: string]: unknown }; createdAt: string }

export interface CustomQuestion { id: string; label: string; type: "text" | "yes_no"; required?: boolean }
export interface RsvpSettings {
  deadline: string | null; requireEmail: boolean; mealOptions: string[]; maxCompanions: number; allowChildren: boolean; allergyChecklist: boolean;
  extraEvents: string[]; customQuestions: CustomQuestion[]; mode: "auto" | "open" | "closed";
}

/** Invitation palette. primary = main button, onPrimary = its text, accent = highlight text, glow = light colour. */
export interface Palette { background: string; surface: string; primary: string; onPrimary: string; accent: string; glow: string; text: string; muted: string }
export interface InvitationConfig {
  palette?: Partial<Palette>; fonts?: { display?: string; body?: string; script?: string };
  cover?: { type?: "glow" | "illustration" | "video" | "photo" | "none" | (string & {}); initials?: string; glowColor?: string; posterAssetId?: string | null; mediaAssetId?: string | null };
  opening?: { animation?: string; durationMs?: number };
  music?: { trackId?: string | null; assetId?: string | null; externalUrl?: string | null; volume?: number; autoplayOnOpen?: boolean };
  sectionOrder?: string[]; hiddenSections?: string[];
}
export interface InviteContent {
  hero?: { tagline?: string; title?: string; subtitle?: string; dateText?: string; backgroundAssetId?: string | null };
  sections?: Record<string, Record<string, unknown>>;
  footer?: { signature?: string; [k: string]: unknown };
}
export interface Invitation {
  id: string; eventId: string; kind: string; slug: string; url: string; previewUrl: string; status: "draft" | "published" | "archived"; locale: string;
  theme: { id: string; key: string; name: I18n } | null; content: Record<string, InviteContent>; config: InvitationConfig; version: number;
  publishedAt: string | null; archivedAt: string | null; updatedAt: string; editable: boolean; canPublish: boolean;
  /** Draft vs live: guests see `publishedVersion`; the editor always edits the draft. */
  publishedVersion?: number | null; hasUnpublishedChanges?: boolean; draftChangedAt?: string | null;
  /** Old links that redirect here, newest first. GET returns `{oldSlug, createdAt}`; the slug PATCH returns plain strings. Owners/co-hosts/studio only. */
  previousSlugs?: (PreviousSlug | string)[];
  /** N-39: the link was renamed, so Custom link must be paid for (can't be unticked). Owners/co-hosts/studio only. */
  customLinkLocked?: boolean;
}
export interface PreviousSlug { oldSlug: string; createdAt?: string | null }
/** Accept both server shapes of `previousSlugs`. */
export function slugHistory(list: (PreviousSlug | string)[] | null | undefined): PreviousSlug[] {
  return (list ?? []).map((x) => (typeof x === "string" ? { oldSlug: x } : x)).filter((x) => !!x?.oldSlug);
}

export interface Companion { id?: string; type?: "adult" | "child"; fullName: string; meal?: string | null; dietary?: string | null }
export interface Guest {
  id: string; fullName: string; email: string | null; phone: string | null; attendance: Attendance; partySize: number; primaryMeal: string | null;
  primaryDietary: string | null; dietaryTags: string[]; companions: Companion[]; extraEvents: Record<string, string>; answers: Record<string, unknown>;
  message: string | null; notes: string | null; source: "rsvp_form" | "manual"; language: string | null; submittedAt: string | null; updatedAt: string;
  deletedAt: string | null; invitee: { id: string; firstName: string; lastName: string | null; householdName: string | null } | null;
}
export interface GuestList { items: Guest[]; nextCursor: string | null; counts: { all: number; yes: number; no: number; pending: number; trash: number } }

export interface Invitee {
  id: string; householdName: string | null; firstName: string; lastName: string | null; email: string | null; phone: string | null; language: string | null;
  maxPartySize: number; knownCompanions: { fullName: string; type?: string }[]; groupLabel: string | null;
  status: "not_sent" | "sent" | "opened" | "responded" | "bounced" | "opted_out"; sentAt: string | null; lastOpenedAt: string | null; openCount: number;
  respondedAt: string | null; optedOut: boolean; notes: string | null; createdAt: string; personalUrl: string;
}
export interface InviteeLink { url: string; text: string; language: string; whatsappUrl: string | null; smsUrl: string | null; mailto: string | null; qrPng: string }
export interface ShareKit { url: string; published: boolean; texts: Record<string, string>; textLanguage: string; untranslatedLanguages: string[]; supportedTextLanguages: string[]; whatsapp: string; sms: string; email: { subject: string; body: string; mailto: string }; qr: { png: string; svg: string } }

export type TableShape = "round" | "rect" | "square" | "u_shape" | "serpentine" | "head";
export interface SeatTable { id: string; label: string; shape: TableShape; seats: number; note: string | null; x: number; y: number; rotation: number; used?: number; overBy?: number; kidsCount?: number; dietaryCount?: number }
export interface LayoutItem { id: string; kind: string; label?: string; x: number; y: number; w: number; h: number; rotation: number }
export interface Assignment { id?: string; tableId: string; guestId: string | null; companionId: string | null; seatIndex: number | null }
export interface PartyMember { kind: "guest" | "companion"; id: string; fullName: string; type: "adult" | "child"; meal: string | null; dietary: string | null; seated: boolean }
export interface Party { guestId: string; name: string; partySize: number; members: PartyMember[] }
export interface Seating { version: number; layout: LayoutItem[]; tables: SeatTable[]; assignments: Assignment[]; parties: Party[]; stats: { confirmedPeople: number; seated: number; unseated: number; tables: number; seats: number } }

export interface Revision { id: string; round: number; request: string; status: "submitted" | "in_progress" | "completed"; staffNote: string | null; createdAt: string; resolvedAt: string | null; comments: { id: string; body: string; createdAt: string; author: { id: string; name: string | null; role: string } }[] }
export interface Revisions { maxRounds: number; unlimited: boolean; used: number; remaining: number; open: boolean; canSubmit: boolean; canApprove: boolean; stage: Stage; draftUrl: string | null; approvedAt: string | null; items: Revision[] }
export interface Member { userId: string; role: EventRole; user: { id: string; email: string; name: string | null }; createdAt: string }

export interface PublicInvitation {
  invitation: { id: string; slug: string; kind: string; status: string; version: number; defaultLanguage: string; preview: boolean; demo: boolean };
  theme: { key: string; defaultConfig: InvitationConfig } | null;
  config: InvitationConfig; languages: string[]; lang: string; content: InviteContent;
  event: { title: string; hostNames: EventT["hostNames"]; eventDate: string | null; timezone: string; venueName: string | null; venueAddress: string | null };
  rsvp: (Omit<RsvpSettings, "mode"> & { open: boolean; closedReason: string | null; dietaryTags: string[] }) | null;
  invitee: { firstName: string; lastName: string | null; householdName: string | null; maxPartySize: number; knownCompanions: { fullName: string; type?: string }[]; language: string | null; existingResponse: Partial<Guest> | null } | null;
  assets: Record<string, { url: string; mime: string; kind: string }>;
  music: { title: string; artist: string; url: string | null; license: string; volume: number; autoplayOnOpen: boolean } | null;
  calendarUrl: string;
}

export type AssetKind = "brief_photo" | "illustration_ref" | "cover" | "gallery" | "music";
export interface Asset { id: string; kind: AssetKind; originalName: string; mime: string; bytes: number; url: string; createdAt: string }
export interface Brief {
  sections: { key: string; label: string }[]; customBlockNames: Record<string, string> | null; data: Record<string, Record<string, unknown>>;
  status: "not_started" | "in_progress" | "submitted" | "archived"; locked: boolean; newSections: string[];
  completion: { done: number; total: number; missing: string[] }; submittedAt: string | null;
}
export interface Campaign { id: string; kind: "invite" | "reminder" | "update" | "thank_you"; channel: string; status: "scheduled" | "running" | "done" | "canceled"; scheduledAt: string | null; createdAt: string; automatic?: boolean; [k: string]: unknown }

/** A theme fits a product when product is null (fits all), equals it, or lists it in products[]. */
export const themeFits = (t: Pick<Theme, "product" | "products">, product: string | undefined | null) =>
  !product || t.product == null || t.product === product || !!t.products?.includes(product);

/** Add-ons that are no longer sold (Lanternly spec): hidden everywhere even if an older API still lists them. */
export const RETIRED_EXTRAS = new Set(["reminder_pack"]);
export const isOfferedExtra = (e: { code: string; available?: boolean } | undefined | null): e is Extra => !!e && e.available !== false && !RETIRED_EXTRAS.has(e.code);
/** Covers the product still supports; legacy illustration/video covers are mapped to the glow cover before saving. */
export function cleanConfig(cfg: InvitationConfig): InvitationConfig {
  const t = cfg.cover?.type as string | undefined;
  if (t === "illustration" || t === "video") return { ...cfg, cover: { ...cfg.cover, type: "glow" } };
  return cfg;
}

/** Expand `{code: qty}` into the repeated-code list the checkout expects (`extra_language` once per unit). */
export const expandExtras = (sel: Record<string, number>) => Object.entries(sel).flatMap(([c, n]) => Array.from({ length: Math.max(0, n) }, () => c));
export function countExtras(list: string[] | undefined | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of list ?? []) if (!RETIRED_EXTRAS.has(c)) out[c] = (out[c] ?? 0) + 1;
  return out;
}
export const REPEATABLE_EXTRAS = new Set(["extra_language"]);
/** A couple's own song (upload or link) rather than a library track. */
export const usesOwnSong = (cfg: InvitationConfig | undefined) => !!(cfg?.music?.assetId || cfg?.music?.externalUrl);
