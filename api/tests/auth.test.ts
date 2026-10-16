import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sha256 } from '../src/lib/crypto.js';
import { Client, PASSWORD, clearDevOutbox, createUser, getDevOutbox, login, makeApp, prisma, tokenFromOutbox, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => clearDevOutbox());

describe('login / session', () => {
  it('logs in with correct password, sets httpOnly session cookie + csrf token, and /me works', async () => {
    const user = await createUser();
    const c = new Client(app);
    const res = await c.post('/api/auth/login', { email: user.email.toUpperCase(), password: PASSWORD });
    expect(res.statusCode).toBe(200);
    const setCookie = ([] as string[]).concat(res.headers['set-cookie'] as any);
    const sid = setCookie.find((s) => s.startsWith('sid='))!;
    expect(sid).toMatch(/HttpOnly/i);
    expect(sid).toMatch(/SameSite=Lax/i);
    expect(res.json().csrfToken).toBe(c.csrf);
    expect(res.json().user.email).toBe(user.email);
    expect(JSON.stringify(res.json())).not.toMatch(/passwordHash|argon2/);

    const me = await c.get('/api/auth/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(user.id);

    // Only a hash of the session token is stored.
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).toBe(sha256(c.cookies.sid!));
  });

  it('stores passwords as argon2id hashes', async () => {
    const user = await createUser();
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);
  });

  it('rejects wrong password and unknown email with the same generic error', async () => {
    const user = await createUser();
    const a = await new Client(app).post('/api/auth/login', { email: user.email, password: 'wrong-password-1' });
    const b = await new Client(app).post('/api/auth/login', { email: uniqueEmail(), password: 'wrong-password-1' });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json().error.code).toBe('INVALID_CREDENTIALS');
    expect(a.json().error.message).toBe(b.json().error.message);
  });

  it('locks the account after 10 failed attempts', async () => {
    const user = await createUser();
    for (let i = 0; i < 10; i++) await new Client(app).post('/api/auth/login', { email: user.email, password: 'nope-nope-1' });
    const res = await new Client(app).post('/api/auth/login', { email: user.email, password: PASSWORD });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('returns 401 for /me without a session and logout clears it', async () => {
    expect((await new Client(app).get('/api/auth/me')).statusCode).toBe(401);
    const user = await createUser();
    const c = await login(app, user.email);
    expect((await c.post('/api/auth/logout')).statusCode).toBe(204);
    expect((await c.get('/api/auth/me')).statusCode).toBe(401);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('validates input with a structured error', async () => {
    const res = await new Client(app).post('/api/auth/login', { email: 'not-an-email', password: '' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(res.json().error.fields).toHaveProperty('email');
  });
});

describe('set-password flow (one-time, expiring, hashed tokens)', () => {
  it('register → email with set-password link (no password in email) → consume sets password and signs in', async () => {
    const email = uniqueEmail('new');
    const reg = await new Client(app).post('/api/auth/register', { email, name: 'New Host' });
    expect(reg.statusCode).toBe(202);
    const mail = getDevOutbox().find((m) => m.to === email)!;
    expect(mail.templateKey).toBe('set_password');
    const raw = tokenFromOutbox(email, 'set_password');

    // Token stored only as sha256 hash.
    const stored = await prisma.authToken.findFirst({ where: { email, purpose: 'set_password' } });
    expect(stored!.tokenHash).toBe(sha256(raw));
    expect(JSON.stringify(stored)).not.toContain(raw);
    expect(stored!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toBeNull();

    const inspect = await new Client(app).post('/api/auth/token/inspect', { token: raw });
    expect(inspect.json()).toMatchObject({ valid: true, purpose: 'set_password', requiresPassword: true, email });

    const c = new Client(app);
    const missing = await c.post('/api/auth/token/consume', { token: raw });
    expect(missing.statusCode).toBe(400);
    // The failed attempt rolled back, so the token still works:
    const weak = await c.post('/api/auth/token/consume', { token: raw, password: 'short' });
    expect(weak.statusCode).toBe(400);
    const ok = await c.post('/api/auth/token/consume', { token: raw, password: 'Brand-New-Pass-9' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().purpose).toBe('set_password');
    expect((await c.get('/api/auth/me')).statusCode).toBe(200);

    const updated = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(updated.passwordHash).toMatch(/^\$argon2id\$/);
    expect(getDevOutbox().some((m) => m.text.includes('Brand-New-Pass-9'))).toBe(false);

    // One-time: reuse fails.
    const reuse = await new Client(app).post('/api/auth/token/consume', { token: raw, password: 'Another-Pass-9' });
    expect(reuse.statusCode).toBe(400);
    expect(reuse.json().error.code).toBe('INVALID_TOKEN');
    expect((await new Client(app).post('/api/auth/token/inspect', { token: raw })).json()).toEqual({ valid: false });

    // Can now log in with the new password.
    await login(app, email, 'Brand-New-Pass-9');
  });

  it('expired tokens are rejected', async () => {
    const email = uniqueEmail('exp');
    await new Client(app).post('/api/auth/register', { email });
    const raw = tokenFromOutbox(email);
    await prisma.authToken.updateMany({ where: { tokenHash: sha256(raw) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await new Client(app).post('/api/auth/token/consume', { token: raw, password: 'Brand-New-Pass-9' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_TOKEN');
  });

  it('issuing a new link invalidates the previous one', async () => {
    const email = uniqueEmail('twice');
    await new Client(app).post('/api/auth/register', { email });
    const first = tokenFromOutbox(email);
    clearDevOutbox();
    await new Client(app).post('/api/auth/register', { email });
    const second = tokenFromOutbox(email);
    expect(first).not.toBe(second);
    expect((await new Client(app).post('/api/auth/token/consume', { token: first, password: 'Brand-New-Pass-9' })).statusCode).toBe(400);
    expect((await new Client(app).post('/api/auth/token/consume', { token: second, password: 'Brand-New-Pass-9' })).statusCode).toBe(200);
  });

  it('forgot password → reset link → old sessions revoked, old password stops working', async () => {
    const user = await createUser();
    const oldSession = await login(app, user.email);
    const res = await new Client(app).post('/api/auth/password/forgot', { email: user.email });
    expect(res.statusCode).toBe(204);
    const raw = tokenFromOutbox(user.email, 'password_reset');
    const c = new Client(app);
    expect((await c.post('/api/auth/token/consume', { token: raw, password: 'Reset-Pass-123' })).statusCode).toBe(200);
    expect((await oldSession.get('/api/auth/me')).statusCode).toBe(401);
    expect((await new Client(app).post('/api/auth/login', { email: user.email, password: PASSWORD })).statusCode).toBe(401);
    await login(app, user.email, 'Reset-Pass-123');
  });

  it('forgot password for unknown email is indistinguishable (204, no email)', async () => {
    const res = await new Client(app).post('/api/auth/password/forgot', { email: uniqueEmail('ghost') });
    expect(res.statusCode).toBe(204);
    expect(getDevOutbox()).toHaveLength(0);
  });

  it('change password requires the current password and CSRF header', async () => {
    const user = await createUser();
    const c = await login(app, user.email);
    const noCsrf = await c.req('POST', '/api/auth/password/change', { currentPassword: PASSWORD, newPassword: 'Changed-Pass-77' }, {}, { csrf: false });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().error.code).toBe('CSRF_FAILED');
    expect((await c.post('/api/auth/password/change', { currentPassword: 'wrong-one-1', newPassword: 'Changed-Pass-77' })).statusCode).toBe(401);
    expect((await c.post('/api/auth/password/change', { currentPassword: PASSWORD, newPassword: 'Changed-Pass-77' })).statusCode).toBe(204);
    await login(app, user.email, 'Changed-Pass-77');
  });

  it('magic login link signs in without a password', async () => {
    const user = await createUser();
    await new Client(app).post('/api/auth/magic-link', { email: user.email });
    const raw = tokenFromOutbox(user.email, 'login_link');
    const c = new Client(app);
    const res = await c.post('/api/auth/token/consume', { token: raw });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(user.id);
  });
});

describe('rate limiting on auth', () => {
  it('returns 429 after the per-minute limit', async () => {
    const limited = await makeApp({ rateLimits: { authPerMinute: 3, multiplier: 1 } });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await new Client(limited).post('/api/auth/login', { email: 'x@example.test', password: 'whatever-1' })).statusCode);
      expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
      expect(codes[4]).toBe(429);
      const last = await new Client(limited).post('/api/auth/login', { email: 'x@example.test', password: 'whatever-1' });
      expect(last.json().error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});
