import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { AppError, notFound } from '../lib/errors.js';
import { requireRole } from '../lib/auth.js';
import { hmac, safeEqual } from '../lib/crypto.js';
import { getDevOutbox } from '../services/messaging/providers.js';
import { cancelOrderBySession, fulfilOrder } from '../services/orders.js';
import { payments } from '../services/payments/index.js';
import { runWorkerOnce } from '../services/jobs/worker.js';
import type { ZApp } from './types.js';
import { queryBoolDefault } from '../lib/query.js';

/**
 * Pay token for the mock checkout page: HMAC of the (already unguessable) session id. The page embeds it in its
 * forms; complete/cancel require it, so a bare session id (e.g. from a success URL or a log) can't settle an order.
 */
export const mockPayToken = (sessionId: string) => hmac(sessionId, 'mock-checkout-pay');
const checkPayToken = (sessionId: string, token: unknown) => {
  if (typeof token !== 'string' || !safeEqual(token, mockPayToken(sessionId))) throw new AppError(403, 'FORBIDDEN', 'Invalid or missing checkout token.');
};
const PayBody = z.object({ token: z.string().max(200).optional() }).default({});

/**
 * Development-only helpers. Registered only when config.devRoutes is true (never in production).
 * - Mock checkout page + complete/cancel: authorised by the session id + pay token (no login needed: it's the buyer's checkout).
 * - Outbox and job runner: admin session required (CSRF applies to the POST).
 */
export default async function dev(app: ZApp, opts: { mockCheckoutOnly?: boolean } = {}) {
  // The mock checkout page posts plain HTML forms: parse them into { token }.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

  // Mock payment page (only with the mock payment driver). Nothing is charged.
  app.get('/api/dev/mock-checkout/:sessionId', { schema: { hide: true, params: z.object({ sessionId: z.string().max(100) }) } }, async (req, reply) => {
    if (payments.name !== 'mock') throw notFound('Route');
    const order = await prisma.order.findUnique({ where: { checkoutSessionId: req.params.sessionId }, include: { items: true } });
    if (!order) throw notFound('Checkout session');
    // L-15: amounts as CA$249.00 in the order's currency (en-US formatting prefixes non-USD dollars, e.g. CA$).
    const fmt = (cents: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'symbol' }).format(cents / 100);
    const rows = order.items.map((i) => `<tr><td>${esc(i.label)}${i.qty > 1 ? ` x ${i.qty}` : ''}</td><td style="text-align:right">${fmt(i.unitPriceCents * i.qty, order.currency)}</td></tr>`).join('');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test checkout</title></head>
<body style="font-family:system-ui;max-width:460px;margin:40px auto;padding:0 16px">
<p style="background:#fff3cd;padding:8px 12px;border-radius:8px">TEST MODE - mock payment, nothing is charged.</p>
<h2>Order ${esc(order.number)}</h2><p>${esc(order.email)}</p>
<table style="width:100%">${rows}<tr><td><b>Subtotal</b></td><td style="text-align:right"><b>${fmt(order.subtotalCents, order.currency)}</b></td></tr></table>
<p style="color:#666;font-size:13px">Tax would be calculated by the payment provider.</p>
<p>Status: <b>${order.status}</b></p>
${order.status === 'pending_payment' ? `<form method="post" action="/api/dev/mock-checkout/${encodeURIComponent(req.params.sessionId)}/complete"><input type="hidden" name="token" value="${esc(mockPayToken(req.params.sessionId))}"><button style="padding:10px 18px">Pay (test)</button></form>
<form method="post" action="/api/dev/mock-checkout/${encodeURIComponent(req.params.sessionId)}/cancel" style="margin-top:8px"><input type="hidden" name="token" value="${esc(mockPayToken(req.params.sessionId))}"><button>Cancel</button></form>` : ''}
</body></html>`;
    // This page is the one HTML response; keep it un-frameable and inline-style only. form-action includes the web
    // origin because the form POST answers with a 303 to the web app's success/cancel page (browsers check redirects).
    return reply
      .header('content-security-policy', `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${new URL(config.WEB_URL).origin}; frame-ancestors 'none'; base-uri 'none'`)
      .header('cache-control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(html);
  });

  app.post('/api/dev/mock-checkout/:sessionId/complete', { schema: { hide: true, params: z.object({ sessionId: z.string().max(100) }), querystring: z.object({ redirect: queryBoolDefault(true) }), body: PayBody } }, async (req, reply) => {
    if (payments.name !== 'mock') throw notFound('Route');
    checkPayToken(req.params.sessionId, req.body?.token);
    const order = await prisma.order.findUnique({ where: { checkoutSessionId: req.params.sessionId } });
    if (!order) throw notFound('Checkout session');
    if (order.status !== 'pending_payment' && order.status !== 'paid') throw new AppError(409, 'CONFLICT', `This checkout is ${order.status}.`);
    // Simulated 13% tax so totals look realistic in dev (real tax comes from Stripe automatic tax).
    const tax = Math.round(order.subtotalCents * 0.13);
    const res = await fulfilOrder(order.id, { amountTotal: order.subtotalCents + tax, amountTax: tax, paymentIntentId: `mock_pi_${order.id.slice(0, 8)}` });
    const success = `${config.WEB_URL}/checkout/success?session_id=${encodeURIComponent(req.params.sessionId)}`;
    if (req.query.redirect && req.headers.accept?.includes('text/html')) return reply.redirect(success, 303);
    return { ok: true, orderId: res.order.id, status: res.order.status, eventId: res.order.eventId, successUrl: success };
  });

  app.post('/api/dev/mock-checkout/:sessionId/cancel', { schema: { hide: true, params: z.object({ sessionId: z.string().max(100) }), body: PayBody } }, async (req, reply) => {
    if (payments.name !== 'mock') throw notFound('Route');
    checkPayToken(req.params.sessionId, req.body?.token);
    await cancelOrderBySession(req.params.sessionId);
    if (req.headers.accept?.includes('text/html')) return reply.redirect(`${config.WEB_URL}/pricing?checkout=canceled`, 303);
    return { ok: true };
  });

  // Production demo deploys (ALLOW_MOCK_PROVIDERS_IN_PRODUCTION) get only the mock checkout routes above, never the outbox or job runner.
  if (opts.mockCheckoutOnly) return;

  /** Dev outbox: emails the console driver "sent" (newest first). Contains one-time sign-in links, so admins only. */
  app.get('/api/dev/outbox', { schema: { hide: true, querystring: z.object({ to: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(20) }) } }, async (req) => {
    requireRole(req, 'admin');
    const items = getDevOutbox().filter((m) => !req.query.to || m.to === req.query.to.toLowerCase());
    return { items: items.slice(0, req.query.limit) };
  });

  app.post('/api/dev/run-jobs', { schema: { hide: true } }, async (req) => {
    requireRole(req, 'admin');
    return { processed: await runWorkerOnce('dev-endpoint') };
  });
}
