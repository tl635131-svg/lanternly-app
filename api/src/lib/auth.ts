import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Event, MemberRole, Session, TokenPurpose, User, UserRole } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { randomToken, safeEqual, sha256 } from './crypto.js';
import { AppError, forbidden, notFound, unauthenticated } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    session: Session | null;
  }
}

export const SESSION_COOKIE = 'sid';
export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Routes that never use the session for authorization, or that establish it.
// The mock checkout page is authorised by its unguessable session id + an HMAC pay token, not by the session.
const CSRF_EXEMPT = [/^\/api\/auth\/(login|token\/consume|token\/inspect|register|magic-link|password\/forgot|unsubscribe)$/, /^\/api\/webhooks\//, /^\/api\/public\//, /^\/api\/dev\/mock-checkout\//];

export function cookieOptions(httpOnly: boolean, maxAgeSeconds: number) {
  return {
    path: '/',
    httpOnly,
    sameSite: 'lax' as const,
    secure: config.COOKIE_SECURE,
    domain: config.COOKIE_DOMAIN || undefined,
    maxAge: maxAgeSeconds,
  };
}

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('user', null);
  app.decorateRequest('session', null);

  app.addHook('onRequest', async (req) => {
    const raw = req.cookies?.[SESSION_COOKIE];
    if (!raw) return;
    const session = await prisma.session.findUnique({ where: { tokenHash: sha256(raw) }, include: { user: true } });
    if (!session || session.expiresAt < new Date() || session.user.disabledAt) return;
    req.session = session;
    req.user = session.user;
    // Touch at most once every 10 minutes.
    if (Date.now() - session.lastSeenAt.getTime() > 10 * 60 * 1000) {
      await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    }
  });

  app.addHook('preHandler', async (req) => {
    if (!req.session || !MUTATING.has(req.method)) return;
    const path = req.url.split('?')[0]!;
    if (CSRF_EXEMPT.some((r) => r.test(path))) return;
    const header = req.headers[CSRF_HEADER];
    if (typeof header !== 'string' || !safeEqual(header, req.session.csrfToken)) {
      throw new AppError(403, 'CSRF_FAILED', `Missing or invalid ${CSRF_HEADER} header.`);
    }
  });
}

export async function createSession(req: FastifyRequest, reply: FastifyReply, user: User) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const ttl = config.SESSION_TTL_DAYS * 24 * 3600;
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      csrfToken,
      userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
      ip: req.ip,
      expiresAt: new Date(Date.now() + ttl * 1000),
    },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
  reply.setCookie(SESSION_COOKIE, token, cookieOptions(true, ttl));
  reply.setCookie(CSRF_COOKIE, csrfToken, cookieOptions(false, ttl));
  return { csrfToken };
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  if (req.session) await prisma.session.delete({ where: { id: req.session.id } }).catch(() => undefined);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}

export function requireUser(req: FastifyRequest): User {
  if (!req.user) throw unauthenticated();
  return req.user;
}

export function requireRole(req: FastifyRequest, ...roles: UserRole[]): User {
  const user = requireUser(req);
  if (!roles.includes(user.role)) throw forbidden();
  return user;
}

export const isStudio = (u: User) => u.role === 'admin' || u.role === 'staff';

/** Studio access: admins see everything; staff only events assigned to them. */
export function studioCanAccess(user: User, event: Pick<Event, 'assignedStaffId'>) {
  return user.role === 'admin' || (user.role === 'staff' && event.assignedStaffId === user.id);
}

export type AccessLevel = 'read' | 'write' | 'owner';

/** Load an event and enforce membership-based authorization. */
export async function requireEventAccess(req: FastifyRequest, eventId: string, level: AccessLevel = 'read') {
  const user = requireUser(req);
  const event = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null } });
  if (!event) throw notFound('Event');
  if (isStudio(user)) {
    if (!studioCanAccess(user, event)) throw notFound('Event');
    return { user, event, role: 'studio' as const };
  }
  const member = await prisma.eventMember.findUnique({ where: { eventId_userId: { eventId, userId: user.id } } });
  // Return 404 (not 403) to avoid leaking which events exist.
  if (!member) throw notFound('Event');
  const role: MemberRole = member.role;
  if (level === 'write' && role === 'viewer') throw forbidden('Your access to this event is read-only.');
  if (level === 'owner' && role !== 'owner') throw forbidden('Only the event owner can do this.');
  if (level !== 'read' && event.archiveAfter && event.archiveAfter < startOfToday()) {
    throw new AppError(403, 'FORBIDDEN', 'This event is archived and read-only.');
  }
  return { user, event, role };
}

function startOfToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ───────── one-time tokens (set password, reset, login link, co-host invite) ─────────
const TTL_MS: Record<TokenPurpose, () => number> = {
  set_password: () => config.SET_PASSWORD_TOKEN_TTL_HOURS * 3600_000,
  reset_password: () => config.RESET_TOKEN_TTL_MINUTES * 60_000,
  login: () => config.LOGIN_LINK_TTL_MINUTES * 60_000,
  cohost_invite: () => config.COHOST_INVITE_TTL_DAYS * 24 * 3600_000,
};

/** Issue a one-time token. Only its sha256 hash is stored; the raw value goes into the email link. */
export async function issueToken(input: { purpose: TokenPurpose; email: string; userId?: string | null; eventId?: string | null; data?: Record<string, unknown> }) {
  const raw = randomToken(32);
  // Invalidate older unused tokens for the same purpose/email (only the latest link works).
  await prisma.authToken.updateMany({
    where: { email: input.email, purpose: input.purpose, usedAt: null, ...(input.eventId ? { eventId: input.eventId } : {}) },
    data: { usedAt: new Date() },
  });
  await prisma.authToken.create({
    data: {
      purpose: input.purpose,
      email: input.email,
      userId: input.userId ?? null,
      eventId: input.eventId ?? null,
      data: (input.data ?? undefined) as any,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + TTL_MS[input.purpose]()),
    },
  });
  return raw;
}

export function tokenActionUrl(raw: string) {
  return `${config.WEB_URL}/auth/${encodeURIComponent(raw)}`;
}

export async function findValidToken(raw: string) {
  const token = await prisma.authToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!token || token.usedAt || token.expiresAt < new Date()) return null;
  return token;
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
