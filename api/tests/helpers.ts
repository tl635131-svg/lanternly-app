import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { buildApp, type BuildOptions } from '../src/app.js';
import { prisma } from '../src/db.js';
import { hashPassword } from '../src/lib/password.js';
import { clearDevOutbox, getDevOutbox } from '../src/services/messaging/providers.js';

export { prisma, clearDevOutbox, getDevOutbox };

export async function makeApp(opts: BuildOptions = {}) {
  const app = await buildApp({ logger: false, ...opts });
  await app.ready();
  return app;
}

/** Tiny cookie-jar client around app.inject that also sends the CSRF header. */
export class Client {
  cookies: Record<string, string> = {};
  csrf: string | null = null;
  constructor(public app: FastifyInstance) {}

  async req(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown, headers: Record<string, string> = {}, opts: { csrf?: boolean } = {}): Promise<LightMyRequestResponse & { body: string; json: () => any }> {
    const h: Record<string, string> = { ...headers };
    const cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) h.cookie = cookie;
    if (method !== 'GET' && this.csrf && opts.csrf !== false) h['x-csrf'] = this.csrf;
    let payload: any = undefined;
    if (body !== undefined) {
      if (typeof body === 'string' || Buffer.isBuffer(body)) payload = body;
      else {
        payload = JSON.stringify(body);
        h['content-type'] ??= 'application/json';
      }
    }
    const res = await this.app.inject({ method, url, headers: h, payload });
    for (const c of ([] as string[]).concat((res.headers['set-cookie'] as any) ?? [])) {
      const [pair] = c.split(';');
      const idx = pair!.indexOf('=');
      const name = pair!.slice(0, idx);
      const value = pair!.slice(idx + 1);
      if (!value || /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)) delete this.cookies[name];
      else this.cookies[name] = value;
      if (name === 'csrf_token') this.csrf = value || null;
    }
    return res as any;
  }
  get = (url: string, headers?: Record<string, string>) => this.req('GET', url, undefined, headers);
  post = (url: string, body?: unknown, headers?: Record<string, string>) => this.req('POST', url, body ?? {}, headers);
  put = (url: string, body?: unknown) => this.req('PUT', url, body ?? {});
  patch = (url: string, body?: unknown) => this.req('PATCH', url, body ?? {});
  del = (url: string) => this.req('DELETE', url);
}

export const uniqueEmail = (prefix = 'user') => `${prefix}.${randomUUID().slice(0, 8)}@example.test`;
export const PASSWORD = 'Correct-Horse-42';

export async function createUser(opts: { email?: string; role?: UserRole; password?: string | null; name?: string } = {}) {
  return prisma.user.create({
    data: { email: opts.email ?? uniqueEmail(opts.role ?? 'host'), role: opts.role ?? 'host', name: opts.name ?? 'Test User', passwordHash: opts.password === null ? null : await hashPassword(opts.password ?? PASSWORD), emailVerifiedAt: new Date() },
  });
}

export async function login(app: FastifyInstance, email: string, password = PASSWORD) {
  const c = new Client(app);
  const res = await c.post('/api/auth/login', { email, password });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return c;
}

/** Create a host user, sign in, and create a self-serve event. */
export async function hostWithEvent(app: FastifyInstance, body: Record<string, unknown> = {}) {
  const user = await createUser();
  const client = await login(app, user.email);
  const res = await client.post('/api/events', { hostNames: { partner1: 'Ada', partner2: 'Grace' }, eventDate: '2027-08-14', venueName: 'Test Hall', ...body });
  if (res.statusCode !== 201) throw new Error(`create event failed: ${res.statusCode} ${res.body}`);
  return { user, client, event: res.json() };
}

/** Mark an event paid and publish its invitation (bypasses checkout for tests that need a live invite). */
export async function publishEvent(client: Client, eventId: string) {
  await prisma.event.update({ where: { id: eventId }, data: { paidAt: new Date() } });
  const res = await client.post(`/api/events/${eventId}/invitation/publish`);
  if (res.statusCode !== 200) throw new Error(`publish failed: ${res.statusCode} ${res.body}`);
  return res.json();
}

export function tokenFromOutbox(to: string, template?: string) {
  const msg = getDevOutbox().find((m) => m.to === to && (!template || m.templateKey === template));
  if (!msg) throw new Error(`no email to ${to}${template ? ` (${template})` : ''}`);
  const m = msg.text.match(/\/auth\/([A-Za-z0-9_\-%]+)/);
  if (!m) throw new Error('no token link in email');
  return decodeURIComponent(m[1]!);
}

/** Complete (or cancel) a mock checkout the way the mock checkout page does: with its HMAC pay token. */
export async function mockCheckout(app: FastifyInstance, sessionId: string, action: 'complete' | 'cancel' = 'complete', opts: { redirect?: boolean; headers?: Record<string, string> } = {}) {
  const { mockPayToken } = await import('../src/routes/dev.js');
  const qs = action === 'complete' && opts.redirect === false ? '?redirect=false' : '';
  return new Client(app).post(`/api/dev/mock-checkout/${sessionId}/${action}${qs}`, { token: mockPayToken(sessionId) }, opts.headers);
}
