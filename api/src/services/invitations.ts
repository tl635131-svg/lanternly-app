import { z } from 'zod';
import type { Event, Invitation, Theme } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { Tx } from '../db.js';
import { CUSTOM_LINK_ADDON, OWN_SONG_ADDON } from '../lib/addons.js';
import { giftModeProblems } from '../lib/brief.js';
import { addonPaymentRequired, entitlements, missingAddons, selectExtra } from './entitlements.js';
import { assertOwnSongEnabled } from '../lib/features.js';
import { ensureRights } from './music-rights.js';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { publish } from '../lib/bus.js';
import { randomToken } from '../lib/crypto.js';
import { AppError, conflict, notFound, unprocessable, validation } from '../lib/errors.js';
import { RESERVED_SLUGS } from '../lib/slug.js';
import { InvitationConfigSchema, InvitationContentSchema } from '../lib/theme-engine.js';
import { inviteUrl } from './provisioning.js';
import { themeFitsProduct } from '../lib/themes.js';
import { previewUrl } from '../routes/revisions.js';

export const InvitationUpdateInput = z.object({
  themeKey: z.string().max(80).optional(),
  /** Default guest language (one of the event languages). Applies immediately. */
  locale: z.string().max(20).optional(),
  content: InvitationContentSchema.optional(),
  config: InvitationConfigSchema.optional(),
  /** Tick "I have the rights to use this music" for the custom song (config.music.assetId / externalUrl) in this save. */
  musicRightsConfirmed: z.boolean().optional(),
});
export type InvitationUpdate = z.infer<typeof InvitationUpdateInput>;
type Actor = { id: string; type: 'host' | 'admin'; req?: FastifyRequest };

/** Spec: has_unpublished_changes = published_version is null or draft_changed_at > published_at. */
export const hasUnpublishedChanges = (inv: Pick<Invitation, 'publishedVersion' | 'draftChangedAt' | 'publishedAt'>) =>
  inv.publishedVersion == null || (!!inv.draftChangedAt && (!inv.publishedAt || inv.draftChangedAt > inv.publishedAt));

export function invitationFullDto(inv: Invitation & { theme?: Theme | null }) {
  return {
    id: inv.id,
    eventId: inv.eventId,
    kind: inv.kind,
    slug: inv.slug,
    url: inviteUrl(inv.slug),
    previewUrl: previewUrl(inv.slug, inv.previewToken),
    status: inv.status,
    locale: inv.locale,
    /** Draft copy (what the editor edits). Guests see the snapshot `publishedVersion`. */
    theme: inv.theme ? { id: inv.theme.id, key: inv.theme.key, name: inv.theme.nameI18n } : null,
    content: inv.content,
    config: inv.config,
    version: inv.version,
    publishedVersion: inv.publishedVersion,
    hasUnpublishedChanges: hasUnpublishedChanges(inv),
    draftChangedAt: inv.draftChangedAt,
    publishedAt: inv.publishedAt,
    archivedAt: inv.archivedAt,
    updatedAt: inv.updatedAt,
  };
}

export async function invitationForEvent(eventId: string) {
  const inv = await prisma.invitation.findFirst({ where: { eventId }, orderBy: { createdAt: 'asc' }, include: { theme: true } });
  if (!inv) throw notFound('Invitation');
  if (!inv.previewToken) return prisma.invitation.update({ where: { id: inv.id }, data: { previewToken: randomToken(18) }, include: { theme: true } });
  return inv;
}

/** The snapshot guests see, or null when nothing is published. */
export async function liveSnapshot(inv: Pick<Invitation, 'id' | 'publishedVersion'>) {
  if (inv.publishedVersion == null) return null;
  return prisma.invitationVersion.findUnique({ where: { invitationId_version: { invitationId: inv.id, version: inv.publishedVersion } } });
}

/**
 * Self-serve hosts need an add-on to use some features. Before paying, using it adds it to the event's
 * selected add-ons (charged at pay-to-publish); after paying it must have been bought (add-on checkout).
 */
async function requireAddon(event: Event, code: string, what: string) {
  const ent = await entitlements(event);
  if (ent.has(code)) return;
  if (!event.paidAt && event.serviceMode === 'self_serve') {
    await selectExtra(event.id, event.selectedExtras, code);
    event.selectedExtras = [...event.selectedExtras, code];
    return;
  }
  throw addonPaymentRequired(event.id, [{ code, qty: 1 }], `${what} needs the "${code}" add-on. Add it with the add-ons checkout.`);
}

/** "Publish changes" on a self-serve event: every add-on the draft uses must be paid (402 ADDON_PAYMENT_REQUIRED). */
export async function assertAddonsPaid(event: Event, inv: Pick<Invitation, 'id' | 'config'>) {
  const missing = await missingAddons(event, inv);
  if (missing.length) throw addonPaymentRequired(event.id, missing);
}

export async function assertSlugAvailable(slug: string, invitationId: string) {
  if (RESERVED_SLUGS.has(slug) || slug.startsWith('demo-')) throw validation('This link is reserved.', { slug: 'reserved' });
  const taken = await prisma.invitation.findUnique({ where: { slug }, select: { id: true } });
  if (taken && taken.id !== invitationId) throw conflict('CONFLICT', 'This link is already taken.', { field: 'slug' });
  const alias = await prisma.invitationSlugRedirect.findUnique({ where: { oldSlug: slug } });
  if (alias && alias.invitationId !== invitationId) throw conflict('CONFLICT', 'This link is already taken.', { field: 'slug' });
}

/**
 * Rename the invitation link; the old slug goes to invitation_slug_redirects (same transaction) and keeps
 * resolving to this invitation. Going back to one of its own previous slugs removes that redirect row.
 */
export async function changeSlug(inv: Pick<Invitation, 'id' | 'slug'>, slug: string, db: Tx | typeof prisma = prisma) {
  if (slug === inv.slug) return;
  await db.invitationSlugRedirect.deleteMany({ where: { oldSlug: slug, invitationId: inv.id } });
  await db.invitationSlugRedirect.upsert({ where: { oldSlug: inv.slug }, create: { oldSlug: inv.slug, invitationId: inv.id }, update: {} });
  await db.invitation.update({ where: { id: inv.id }, data: { slug } });
}

/**
 * N-39: the editor's link state after a reload. `previousSlugs` = invitation_slug_redirects rows, newest first;
 * `customLinkLocked` = the slug was ever renamed (a redirect exists) or custom_link is on a paid order of the event.
 */
export async function linkState(inv: Pick<Invitation, 'id' | 'eventId'>) {
  const [rows, paid] = await Promise.all([
    prisma.invitationSlugRedirect.findMany({ where: { invitationId: inv.id }, orderBy: { createdAt: 'desc' }, select: { oldSlug: true, createdAt: true } }),
    prisma.order.count({ where: { eventId: inv.eventId, status: 'paid', extras: { has: CUSTOM_LINK_ADDON } } }),
  ]);
  return { previousSlugs: rows.map((r) => ({ oldSlug: r.oldSlug, createdAt: r.createdAt })), customLinkLocked: rows.length > 0 || paid > 0 };
}

export async function previousSlugs(invitationId: string) {
  const rows = await prisma.invitationSlugRedirect.findMany({ where: { invitationId }, orderBy: { createdAt: 'desc' }, select: { oldSlug: true } });
  return rows.map((r) => r.oldSlug);
}

/**
 * `PATCH /api/events/:id/invitation/slug` (and the deprecated `PUT …/invitation {slug}`): applies immediately.
 * Hosts need `custom_link` (bought, included in Couture, or — before a self-serve payment — selected; it is then
 * added to selectedExtras and charged at checkout). Admins/staff may always rename.
 */
export async function setInvitationSlug(inv: Invitation, slug: string, actor: Actor) {
  if (slug !== inv.slug) {
    await assertSlugAvailable(slug, inv.id);
    if (actor.type === 'host') {
      const event = await prisma.event.findUniqueOrThrow({ where: { id: inv.eventId } });
      await requireAddon(event, CUSTOM_LINK_ADDON, 'Choosing your link name');
    }
    await prisma.$transaction((tx) => changeSlug(inv, slug, tx));
    await logActivity({ eventId: inv.eventId, actorType: actor.type, actorId: actor.id, action: 'invitation.slug_changed', data: { from: inv.slug, to: slug } });
    publish(inv.eventId, 'invitation.updated', { slug });
  }
  return { slug, url: inviteUrl(slug), previousSlugs: await previousSlugs(inv.id) };
}

export async function updateInvitation(inv: Invitation, input: InvitationUpdate, actor: Actor) {
  const data: Record<string, unknown> = {};
  const event = await prisma.event.findUniqueOrThrow({ where: { id: inv.eventId } });
  const isHost = actor.type === 'host';
  let draftChanged = false;
  if (input.themeKey) {
    const theme = await prisma.theme.findUnique({ where: { key: input.themeKey } });
    if (!theme || theme.status === 'retired' || !themeFitsProduct(theme, inv.kind)) throw unprocessable('INVALID_SELECTION', 'This design is not available for this invitation.', { themeKey: 'Invalid' });
    if (theme.id !== inv.themeId) draftChanged = true;
    data.themeId = theme.id;
  }
  if (input.locale) {
    if (!event.languages.includes(input.locale)) throw validation('Default language must be one of the event languages.', { locale: 'Invalid' });
    data.locale = input.locale;
  }
  if (input.content) {
    const bad = Object.keys(input.content).filter((l) => !event.languages.includes(l));
    if (bad.length) throw validation(`Content languages must match the event languages (${event.languages.join(', ')}).`, { content: bad.join(', ') });
    // Gift block mode rules (display-only gifts; the message is optional): cash/both need one complete payout
    // method (422 GIFT_PAYOUT_REQUIRED); registry/both need a registry link (422).
    const noPayout: Record<string, string> = {};
    const noRegistry: Record<string, string> = {};
    for (const [lang, c] of Object.entries(input.content)) {
      const p = giftModeProblems((c as any)?.sections?.gift_list);
      const at = `content.${lang}.sections.gift_list`;
      if (p.missingPayout) {
        noPayout[`${at}.interacEmail`] = 'Add an Interac e-Transfer email, or';
        noPayout[`${at}.bank`] = 'institution + transit + account numbers, or an IBAN';
      }
      if (p.missingRegistry) noRegistry[`${at}.registries`] = 'Add at least one registry link (https)';
    }
    if (Object.keys(noPayout).length) throw new AppError(422, 'GIFT_PAYOUT_REQUIRED', 'Cash gifts need one complete way for guests to send money: an Interac e-Transfer email, Canadian bank details (institution, transit and account numbers), or an IBAN.', noPayout);
    if (Object.keys(noRegistry).length) throw new AppError(422, 'GIFT_REGISTRY_URL_REQUIRED', 'A registry needs at least one registry link (https).', noRegistry);
    data.content = input.content;
    draftChanged = true;
  }
  if (input.config) {
    const music = input.config.music;
    if (music?.trackId && !(await prisma.musicTrack.findFirst({ where: { id: music.trackId, active: true } }))) throw validation('Unknown music track.', { 'config.music.trackId': 'Invalid' });
    const assetIds = [music?.assetId, input.config.cover?.posterAssetId, input.config.cover?.mediaAssetId].filter(Boolean) as string[];
    if (assetIds.length) {
      const owned = await prisma.asset.count({ where: { id: { in: assetIds }, eventId: inv.eventId, deletedAt: null } });
      if (owned !== new Set(assetIds).size) throw validation('Referenced files must be uploaded to this event.', { config: 'Unknown asset' });
    }
    // A couple's own song (uploaded file or link) needs a rights confirmation, and on self-serve the own_song add-on.
    const prevMusic = ((inv.config as any)?.music ?? {}) as { assetId?: string | null; externalUrl?: string | null };
    const tick = { confirmed: input.musicRightsConfirmed === true, userId: actor.id, req: actor.req };
    const newAsset = music?.assetId && music.assetId !== prevMusic.assetId ? music.assetId : null;
    const newUrl = music?.externalUrl && music.externalUrl !== prevMusic.externalUrl ? music.externalUrl : null;
    if (newAsset || newUrl) assertOwnSongEnabled();
    if (newAsset) {
      if (!(await prisma.asset.findFirst({ where: { id: newAsset, eventId: inv.eventId, kind: 'music', deletedAt: null } }))) throw validation('Use an audio file uploaded with kind=music.', { 'config.music.assetId': 'Not a music upload' });
      await ensureRights(inv.eventId, { assetId: newAsset }, tick);
    }
    if (newUrl) await ensureRights(inv.eventId, { url: newUrl }, tick);
    if (isHost && (newAsset || newUrl)) await requireAddon(event, OWN_SONG_ADDON, 'Using your own song');
    data.config = { ...((inv.config as object) ?? {}), ...input.config };
    draftChanged = true;
  }
  if (draftChanged) data.draftChangedAt = new Date();
  const updated = await prisma.invitation.update({ where: { id: inv.id }, data, include: { theme: true } });
  await logActivity({ eventId: inv.eventId, actorType: actor.type, actorId: actor.id, action: 'invitation.updated', data: { fields: Object.keys(data) } });
  publish(inv.eventId, 'invitation.updated', { status: updated.status, hasUnpublishedChanges: hasUnpublishedChanges(updated) });
  return updated;
}

/** Publish / "Publish changes": snapshot the draft as version n+1 and make it the live page. */
export async function publishInvitation(inv: Invitation, actor: Actor) {
  if (inv.status === 'archived') throw conflict('CONFLICT', 'This invitation is archived.');
  const updated = await prisma.$transaction(async (tx) => {
    const version = inv.version + 1;
    await tx.invitationVersion.create({ data: { invitationId: inv.id, version, themeId: inv.themeId, content: inv.content as any, config: inv.config as any, publishedById: actor.id } });
    return tx.invitation.update({ where: { id: inv.id }, data: { status: 'published', publishedAt: new Date(), version, publishedVersion: version, previewToken: inv.previewToken ?? randomToken(18) }, include: { theme: true } });
  });
  await logActivity({ eventId: inv.eventId, actorType: actor.type, actorId: actor.id, action: 'invitation.published', data: { version: updated.version } });
  publish(inv.eventId, 'invitation.updated', { status: 'published', version: updated.version, hasUnpublishedChanges: false });
  return updated;
}

export async function unpublishInvitation(inv: Invitation, actor: Actor) {
  const updated = await prisma.invitation.update({ where: { id: inv.id }, data: { status: 'draft' }, include: { theme: true } });
  await logActivity({ eventId: inv.eventId, actorType: actor.type, actorId: actor.id, action: 'invitation.unpublished' });
  publish(inv.eventId, 'invitation.updated', { status: 'draft' });
  return updated;
}

/** Throw away draft edits: copy the live snapshot back into the draft. */
export async function discardDraft(inv: Invitation, actor: Actor) {
  const live = await liveSnapshot(inv);
  if (!live) throw conflict('CONFLICT', 'Nothing has been published yet, so there is no live version to go back to.');
  const updated = await prisma.invitation.update({ where: { id: inv.id }, data: { content: live.content as any, config: live.config as any, themeId: live.themeId, draftChangedAt: null }, include: { theme: true } });
  await logActivity({ eventId: inv.eventId, actorType: actor.type, actorId: actor.id, action: 'invitation.draft_discarded', data: { version: live.version } });
  publish(inv.eventId, 'invitation.updated', { status: updated.status, hasUnpublishedChanges: hasUnpublishedChanges(updated) });
  return updated;
}

/** Copy snapshot k into the draft only; it goes live with the next publish. */
export async function rollbackInvitation(inv: Invitation, version: number, actor: Actor) {
  const v = await prisma.invitationVersion.findUnique({ where: { invitationId_version: { invitationId: inv.id, version } } });
  if (!v) throw notFound('Version');
  const updated = await prisma.invitation.update({ where: { id: inv.id }, data: { content: v.content as any, config: v.config as any, themeId: v.themeId, draftChangedAt: new Date() }, include: { theme: true } });
  await logActivity({ eventId: inv.eventId, actorType: actor.type, actorId: actor.id, action: 'invitation.rolled_back', data: { version } });
  publish(inv.eventId, 'invitation.updated', { status: updated.status, hasUnpublishedChanges: true });
  return updated;
}

export async function listVersions(invitationId: string) {
  const rows = await prisma.invitationVersion.findMany({ where: { invitationId }, orderBy: { version: 'desc' }, select: { id: true, version: true, createdAt: true, publishedById: true } });
  return { items: rows };
}

export async function rotatePreviewToken(inv: Invitation) {
  return prisma.invitation.update({ where: { id: inv.id }, data: { previewToken: randomToken(18) }, include: { theme: true } });
}
