import type { Asset, Event, Guest, GuestCompanion, Invitation, Invitee, Revision, RevisionComment, Theme, User } from '@prisma/client';
import { isoDate } from './format.js';

import { inviteUrl } from '../services/provisioning.js';
import { signedAssetUrl } from '../services/storage/index.js';

export const userDto = (u: User) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  locale: u.locale,
  hasPassword: !!u.passwordHash,
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt,
  disabled: !!u.disabledAt,
});

export const companionDto = (c: GuestCompanion) => ({ id: c.id, type: c.type, fullName: c.fullName, meal: c.meal, dietary: c.dietary });

export const guestDto = (g: Guest & { companions?: GuestCompanion[]; invitee?: Invitee | null }) => ({
  id: g.id,
  fullName: g.fullName,
  email: g.email,
  phone: g.phone,
  attendance: g.attendance,
  partySize: g.partySize,
  primaryMeal: g.primaryMeal,
  primaryDietary: g.primaryDietary,
  dietaryTags: g.dietaryTags,
  companions: (g.companions ?? []).sort((a, b) => a.sort - b.sort).map(companionDto),
  extraEvents: g.extraEvents,
  answers: g.answers,
  message: g.message,
  notes: g.notes,
  source: g.source,
  language: g.language,
  submittedAt: g.submittedAt,
  updatedAt: g.updatedAt,
  deletedAt: g.deletedAt,
  invitee: g.invitee ? { id: g.invitee.id, firstName: g.invitee.firstName, lastName: g.invitee.lastName, householdName: g.invitee.householdName } : null,
});

export const inviteeDto = (i: Invitee, slug?: string | null) => ({
  id: i.id,
  householdName: i.householdName,
  firstName: i.firstName,
  lastName: i.lastName,
  email: i.email,
  phone: i.phoneE164,
  language: i.language,
  maxPartySize: i.maxPartySize,
  knownCompanions: i.knownCompanions,
  groupLabel: i.groupLabel,
  status: i.status,
  sentAt: i.sentAt,
  lastOpenedAt: i.lastOpenedAt,
  openCount: i.openCount,
  respondedAt: i.respondedAt,
  optedOut: !!i.optedOutAt,
  notes: i.notes,
  createdAt: i.createdAt,
  personalUrl: slug ? inviteUrl(slug, i.token) : null,
});

export const themeDto = (t: Theme) => ({
  id: t.id,
  key: t.key,
  /** Products this design can be used for. */
  products: t.products,
  name: t.nameI18n,
  description: t.descriptionI18n,
  moodTags: t.moodTags,
  previewVideoUrl: t.previewVideoUrl,
  posterUrl: t.posterUrl,
  demoSlug: t.demoSlug,
  isNew: t.isNew,
  isPopular: t.isPopular,
  status: t.status,
  defaultConfig: t.defaultConfig,
  sort: t.sort,
});

export const assetDto = (a: Asset) => ({ id: a.id, kind: a.kind, originalName: a.originalName, mime: a.mime, bytes: a.bytes, url: signedAssetUrl(a.id), createdAt: a.createdAt });

export const revisionDto = (r: Revision & { comments?: (RevisionComment & { author?: User | null })[] }) => ({
  id: r.id,
  round: r.roundNumber,
  request: r.request,
  status: r.status,
  staffNote: r.staffNote,
  createdAt: r.createdAt,
  resolvedAt: r.resolvedAt,
  comments: (r.comments ?? []).map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, author: c.author ? { id: c.author.id, name: c.author.name, role: c.author.role } : null })),
});

export const invitationSummary = (inv: Invitation | null | undefined) =>
  inv
    ? { id: inv.id, slug: inv.slug, url: inviteUrl(inv.slug), status: inv.status, kind: inv.kind, publishedAt: inv.publishedAt, version: inv.version, publishedVersion: inv.publishedVersion }
    : null;

export const eventDto = (e: Event & { invitations?: Invitation[] }, extra: Record<string, unknown> = {}) => ({
  id: e.id,
  product: e.product,
  planCode: e.planCode,
  serviceMode: e.serviceMode,
  title: e.title,
  hostNames: e.hostNames,
  eventDate: isoDate(e.eventDate),
  timezone: e.timezone,
  venueName: e.venueName,
  venueAddress: e.venueAddress,
  primaryLanguage: e.primaryLanguage,
  languages: e.languages,
  /** Self-serve add-ons picked before paying (pre-fill the pay dialog). */
  selectedExtras: e.selectedExtras ?? [],
  productionStage: e.serviceMode === 'studio' ? e.productionStage : null,
  express: e.express,
  maxRevisionRounds: e.maxRevisionRounds,
  designApprovedAt: e.designApprovedAt,
  highSeasonNotice: e.highSeasonNotice,
  invitesSentManual: e.invitesSentManual,
  remindersEnabled: e.remindersEnabled,
  reminderDaysBefore: e.reminderDaysBefore,
  notifyOnRsvp: e.notifyOnRsvp,
  paid: !!e.paidAt,
  paidAt: e.paidAt,
  deliveredAt: e.deliveredAt,
  archiveAfter: isoDate(e.archiveAfter),
  createdAt: e.createdAt,
  invitation: invitationSummary(e.invitations?.[0]),
  ...extra,
});
