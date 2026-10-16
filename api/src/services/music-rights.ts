import type { FastifyRequest } from 'fastify';
import { prisma } from '../db.js';
import { hmac } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';

/** The exact checkbox text shown to the host. Bump the version suffix if the wording changes. */
export const MUSIC_RIGHTS_STATEMENT = 'I have the rights to use this music (v1)';

export type RightsTarget = { assetId: string; url?: undefined } | { url: string; assetId?: undefined };

export const rightsRequired = (what = 'this song') =>
  new AppError(400, 'RIGHTS_CONFIRMATION_REQUIRED', `Please confirm you have the rights to use ${what} ("I have the rights to use this music").`);

export async function hasRightsConfirmation(eventId: string, target: RightsTarget) {
  return !!(await prisma.musicRightsConfirmation.findFirst({ where: { eventId, ...(target.assetId ? { assetId: target.assetId } : { url: target.url }) }, select: { id: true } }));
}

/** Store one tick: who, which event, which upload or link, when, plus a hashed IP and the user agent. */
export async function recordRightsConfirmation(eventId: string, userId: string | null, target: RightsTarget, req?: Pick<FastifyRequest, 'ip' | 'headers'>) {
  return prisma.musicRightsConfirmation.create({
    data: {
      eventId,
      userId,
      assetId: target.assetId ?? null,
      url: target.url ?? null,
      statement: MUSIC_RIGHTS_STATEMENT,
      ipHash: req?.ip ? hmac(req.ip, 'music-rights-ip') : null,
      userAgent: typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 400) : null,
    },
  });
}

/** Ensure a confirmation exists for a custom song; record one when the caller ticked the box in this request. */
export async function ensureRights(eventId: string, target: RightsTarget, tick: { confirmed?: boolean; userId: string | null; req?: Pick<FastifyRequest, 'ip' | 'headers'> }) {
  if (tick.confirmed) {
    if (!(await hasRightsConfirmation(eventId, target))) await recordRightsConfirmation(eventId, tick.userId, target, tick.req);
    return;
  }
  if (!(await hasRightsConfirmation(eventId, target))) throw rightsRequired();
}

export const rightsDto = (r: { id: string; userId: string | null; assetId: string | null; url: string | null; statement: string; confirmedAt: Date; user?: { name: string | null } | null }) => ({
  id: r.id,
  userId: r.userId,
  userName: r.user?.name ?? null,
  assetId: r.assetId,
  url: r.url,
  statement: r.statement,
  confirmedAt: r.confirmedAt,
});
