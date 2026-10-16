import { z } from 'zod';
import { prisma } from '../db.js';
import { createSession, destroySession, findValidToken, issueToken, normalizeEmail, requireUser, tokenActionUrl } from '../lib/auth.js';
import { sha256, verifyForever } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../lib/password.js';
import { userDto } from '../lib/serializers.js';
import { sendNow } from '../services/messaging/index.js';
import { logActivity } from '../lib/activity.js';
import { rl, type ZApp } from './types.js';

const Email = z.string().trim().toLowerCase().email('Invalid email').max(255);
export const Password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /[0-9\W_]/.test(p), 'Use letters plus at least one number or symbol');

const LOCK_AFTER = 10;
const LOCK_MINUTES = 15;

async function meResponse(userId: string, csrfToken?: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const memberships = await prisma.eventMember.findMany({ where: { userId, event: { deletedAt: null } }, include: { event: { select: { id: true, title: true, serviceMode: true, eventDate: true } } }, orderBy: { createdAt: 'asc' } });
  return {
    user: userDto(user),
    role: user.role,
    memberships: memberships.map((m) => ({ eventId: m.eventId, role: m.role, title: m.event.title, serviceMode: m.event.serviceMode })),
    ...(csrfToken ? { csrfToken } : {}),
  };
}

export default async function auth(app: ZApp) {
  const authLimit = rl(app, app.limits.authPerMinute, '1 minute');
  const emailLimit = rl(app, 5, '1 minute');

  app.post('/api/auth/login', { config: authLimit, schema: { tags: ['auth'], body: z.object({ email: Email, password: z.string().min(1).max(200) }) } }, async (req, reply) => {
    const email = normalizeEmail(req.body.email);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || user.disabledAt) {
      await burnPasswordCheck(req.body.password);
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts. Try again later or reset your password.');
    const ok = await verifyPassword(user.passwordHash, req.body.password);
    if (!ok) {
      const fails = user.failedLoginCount + 1;
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: fails >= LOCK_AFTER ? 0 : fails, lockedUntil: fails >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    const { csrfToken } = await createSession(req, reply, user);
    return meResponse(user.id, csrfToken);
  });

  app.post('/api/auth/logout', { schema: { tags: ['auth'] } }, async (req, reply) => {
    await destroySession(req, reply);
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { schema: { tags: ['auth'] } }, async (req) => {
    const user = requireUser(req);
    return meResponse(user.id, req.session!.csrfToken);
  });

  app.patch('/api/auth/me', { schema: { tags: ['auth'], body: z.object({ name: z.string().trim().min(1).max(100).optional(), locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional() }) } }, async (req) => {
    const user = requireUser(req);
    await prisma.user.update({ where: { id: user.id }, data: req.body });
    return meResponse(user.id);
  });

  app.post('/api/auth/password/change', { config: authLimit, schema: { tags: ['auth'], body: z.object({ currentPassword: z.string().max(200), newPassword: Password }) } }, async (req, reply) => {
    const user = requireUser(req);
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, req.body.currentPassword))) throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(req.body.newPassword) } });
    // Sign out every other session.
    await prisma.session.deleteMany({ where: { userId: user.id, NOT: { id: req.session!.id } } });
    return reply.code(204).send();
  });

  /** Self-serve sign-up: creates an account without a password and emails a set-password link. Always 202 (no account enumeration). */
  app.post('/api/auth/register', { config: emailLimit, schema: { tags: ['auth'], body: z.object({ email: Email, name: z.string().trim().max(100).optional(), locale: z.string().max(10).optional() }) } }, async (req, reply) => {
    const email = normalizeEmail(req.body.email);
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) user = await prisma.user.create({ data: { email, name: req.body.name ?? null, locale: req.body.locale ?? 'en' } });
    if (!user.disabledAt) {
      const purpose = user.passwordHash ? 'login' : 'set_password';
      const raw = await issueToken({ purpose, email, userId: user.id });
      await sendNow({ to: email, template: purpose === 'login' ? 'login_link' : 'set_password', data: { name: user.name, actionUrl: tokenActionUrl(raw) }, userId: user.id });
    }
    return reply.code(202).send({ ok: true });
  });

  app.post('/api/auth/magic-link', { config: emailLimit, schema: { tags: ['auth'], body: z.object({ email: Email }) } }, async (req, reply) => {
    const email = normalizeEmail(req.body.email);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.disabledAt) {
      const raw = await issueToken({ purpose: 'login', email, userId: user.id });
      await sendNow({ to: email, template: 'login_link', data: { actionUrl: tokenActionUrl(raw) }, userId: user.id });
    }
    return reply.code(204).send();
  });

  app.post('/api/auth/password/forgot', { config: emailLimit, schema: { tags: ['auth'], body: z.object({ email: Email }) } }, async (req, reply) => {
    const email = normalizeEmail(req.body.email);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.disabledAt) {
      const purpose = user.passwordHash ? 'reset_password' : 'set_password';
      const raw = await issueToken({ purpose, email, userId: user.id });
      await sendNow({ to: email, template: purpose === 'reset_password' ? 'password_reset' : 'set_password', data: { name: user.name, actionUrl: tokenActionUrl(raw) }, userId: user.id });
    }
    return reply.code(204).send();
  });

  app.post('/api/auth/token/inspect', { config: authLimit, schema: { tags: ['auth'], summary: 'Check a one-time link before showing the form', body: z.object({ token: z.string().min(10).max(200) }) } }, async (req) => {
    const token = await findValidToken(req.body.token);
    if (!token) return { valid: false };
    const user = token.userId ? await prisma.user.findUnique({ where: { id: token.userId } }) : await prisma.user.findUnique({ where: { email: token.email } });
    const event = token.eventId ? await prisma.event.findUnique({ where: { id: token.eventId }, select: { id: true, title: true } }) : null;
    const requiresPassword = token.purpose === 'set_password' || token.purpose === 'reset_password' || (token.purpose === 'cohost_invite' && !user?.passwordHash);
    return { valid: true, purpose: token.purpose, email: token.email, requiresPassword, expiresAt: token.expiresAt, event };
  });

  /**
   * Consume a one-time token. set_password / reset_password require `password`.
   * login signs in. cohost_invite joins the event (and sets a password if the account has none).
   * On success the user is signed in (session cookie set).
   */
  app.post(
    '/api/auth/token/consume',
    { config: authLimit, schema: { tags: ['auth'], body: z.object({ token: z.string().min(10).max(200), password: Password.optional(), name: z.string().trim().max(100).optional() }) } },
    async (req, reply) => {
      const result = await prisma.$transaction(async (tx) => {
        // Atomically mark used — a token can only ever be consumed once.
        const claimed = await tx.authToken.updateMany({ where: { tokenHash: sha256(req.body.token), usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
        if (claimed.count !== 1) throw new AppError(400, 'INVALID_TOKEN', 'This link is invalid or has expired. Request a new one.');
        const token = await tx.authToken.findUniqueOrThrow({ where: { tokenHash: sha256(req.body.token) } });
        let user = token.userId ? await tx.user.findUnique({ where: { id: token.userId } }) : await tx.user.findUnique({ where: { email: token.email } });
        if (!user && token.purpose === 'cohost_invite') user = await tx.user.create({ data: { email: token.email, name: req.body.name ?? null } });
        if (!user || user.disabledAt) throw new AppError(400, 'INVALID_TOKEN', 'This link is invalid or has expired.');

        const needsPassword = token.purpose === 'set_password' || token.purpose === 'reset_password' || (token.purpose === 'cohost_invite' && !user.passwordHash);
        if (needsPassword && !req.body.password) throw new AppError(400, 'VALIDATION_ERROR', 'Please choose a password.', { password: 'Required' });
        const data: Record<string, unknown> = { emailVerifiedAt: user.emailVerifiedAt ?? new Date(), failedLoginCount: 0, lockedUntil: null };
        if (needsPassword && req.body.password) data.passwordHash = await hashPassword(req.body.password);
        if (req.body.name && !user.name) data.name = req.body.name;
        user = await tx.user.update({ where: { id: user.id }, data });
        if (needsPassword) await tx.session.deleteMany({ where: { userId: user.id } }); // password changed → revoke old sessions

        let joinedEventId: string | null = null;
        if (token.purpose === 'cohost_invite' && token.eventId) {
          const role = ((token.data as any)?.role ?? 'cohost') as 'cohost' | 'viewer';
          await tx.eventMember.upsert({ where: { eventId_userId: { eventId: token.eventId, userId: user.id } }, create: { eventId: token.eventId, userId: user.id, role, invitedById: (token.data as any)?.invitedBy ?? null }, update: {} });
          joinedEventId = token.eventId;
          await logActivity({ eventId: token.eventId, actorType: 'host', actorId: user.id, action: 'member.joined', data: { role } }, tx);
        }
        return { user, purpose: token.purpose, joinedEventId };
      });
      const { csrfToken } = await createSession(req, reply, result.user);
      return { ...(await meResponse(result.user.id, csrfToken)), purpose: result.purpose, joinedEventId: result.joinedEventId };
    },
  );

  // Unsubscribe (guest/invitee messages). Token = signed "invitee:<id>".
  const resolveUnsub = (token: string) => {
    const v = verifyForever(token, 'unsubscribe');
    return v?.startsWith('invitee:') ? v.slice(8) : null;
  };
  app.get('/api/auth/unsubscribe', { schema: { tags: ['auth'], querystring: z.object({ token: z.string().max(300) }) } }, async (req) => {
    const id = resolveUnsub(req.query.token);
    const inv = id ? await prisma.invitee.findUnique({ where: { id } }) : null;
    if (!inv) return { status: 'invalid' };
    return { status: inv.optedOutAt ? 'already' : 'ready' };
  });
  app.post('/api/auth/unsubscribe', { config: emailLimit, schema: { tags: ['auth'], body: z.object({ token: z.string().max(300) }) } }, async (req) => {
    const id = resolveUnsub(req.body.token);
    const inv = id ? await prisma.invitee.findUnique({ where: { id } }) : null;
    if (!inv) return { status: 'invalid' };
    if (inv.optedOutAt) return { status: 'already' };
    await prisma.invitee.update({ where: { id: inv.id }, data: { optedOutAt: new Date(), status: 'opted_out' } });
    return { status: 'done' };
  });
}
