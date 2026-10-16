import { z } from 'zod';
import { LANGUAGES } from '../lib/catalogue.js';

const LANGUAGE_CODES = new Set<string>(LANGUAGES.map((l) => l.code));
import { prisma } from '../db.js';
import { normalizeEmail, requireEventAccess } from '../lib/auth.js';
import { AppError, unprocessable } from '../lib/errors.js';
import { createAddonCheckout, createCheckout, fulfilOrder } from '../services/orders.js';
import { addonsInUse, paidExtras } from '../services/entitlements.js';
import { payments } from '../services/payments/index.js';
import { computeAddonQuote, computeQuote, publicQuote } from '../services/pricing.js';
import { ExtrasField, rejectRemovedFields, rl, type ZApp } from './types.js';

const SelectionBody = z.object({
  plan: z.enum(['diy', 'std', 'experience', 'premium', 'birthday', 'bridesmaid']),
  themeKey: z.string().max(80).nullish(),
  sections: z.array(z.string().max(80)).max(40).default([]),
  /** Codes or `{code, qty}`; repeatable add-ons (extra_language) count once per unit. */
  extras: ExtrasField.default([]),
  languages: z.array(z.string().max(30)).max(12).default(['en']),
});

/** N-32: the event's saved design (its first invitation's theme), used when a quote/checkout omits themeKey. */
async function eventThemeKey(eventId: string) {
  const inv = await prisma.invitation.findFirst({ where: { eventId }, orderBy: { createdAt: 'asc' }, select: { theme: { select: { key: true } } } });
  return inv?.theme?.key ?? null;
}

/**
 * What the checkout actually charges, after server-side add-back/trimming — the same shape as the quotes:
 * `extras` (flat codes, extra_language once per unit), `lines` [{kind, code, label, qty, unitPriceCents, totalCents}],
 * `subtotalCents` (= sum of lines; tax is added by the payment provider) and `currency`.
 */
type Line = { kind: string; code: string; label: string; qty: number; unitPriceCents: number; totalCents: number };
const charged = (q: { extras: string[]; lines: Line[]; subtotalCents: number; currency: string }) => ({ extras: q.extras, lines: q.lines, subtotalCents: q.subtotalCents, currency: q.currency });
async function chargedFromOrder(o: { id: string; extras: string[]; subtotalCents: number; currency: string }) {
  const items = await prisma.orderItem.findMany({ where: { orderId: o.id } });
  const lines = items.map((i) => ({ kind: i.kind, code: i.code, label: i.label, qty: i.qty, unitPriceCents: i.unitPriceCents, totalCents: i.qty * i.unitPriceCents }));
  return { extras: o.extras, lines, subtotalCents: o.subtotalCents, currency: o.currency };
}

const InfoFields = z.object({
  partner1: z.string().trim().max(80).optional(),
  partner2: z.string().trim().max(80).optional(),
  honoree: z.string().trim().max(80).optional(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullish(),
  venue: z.string().trim().max(200).nullish(),
  email: z.string().transform((v) => v.replace(/\s+/g, '').toLowerCase()).pipe(z.string().email('Invalid email').max(255)),
  phone: z.string().trim().max(40).nullish(),
  /** Personal message (birthday / bridal party plans). */
  message: z.string().trim().max(3000).nullish(),
});
/** `info.letter` was removed: reject it clearly instead of silently dropping the text. */
const noLetter = rejectRemovedFields({ 'info.letter': '"info.letter" was removed. Send the personal note as "info.message".' });
const Consents = z.object({ terms: z.literal(true, { error: 'You must accept the terms' }), privacy: z.literal(true, { error: 'You must accept the privacy policy' }) });

export default async function checkout(app: ZApp) {
  app.put(
    '/api/checkout/drafts/:draftId',
    {
      config: rl(app, 60, '1 minute'),
      preValidation: noLetter,
      schema: {
        tags: ['checkout'],
        summary: 'Upsert abandoned-cart draft (called on each wizard step)',
        params: z.object({ draftId: z.string().uuid() }),
        body: z.object({
          plan: SelectionBody.shape.plan.nullish(),
          lastStep: z.string().max(40).nullish(),
          themeKey: z.string().max(80).nullish(),
          sections: z.array(z.string().max(80)).max(40).default([]),
          extras: z.array(z.string().max(40)).max(20).default([]),
          languages: z.array(z.string().max(30)).max(12).default([]),
          info: InfoFields.partial().extend({ email: z.string().max(255).optional() }).nullish(),
          vision: z.string().max(1500).nullish(),
          utm: z.record(z.string().max(40), z.string().max(200)).nullish(),
          abandoned: z.boolean().optional(),
        }),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const email = b.info?.email && /.+@.+\..+/.test(b.info.email) ? normalizeEmail(b.info.email) : null;
      const data = {
        planCode: b.plan ?? null,
        lastStep: b.lastStep ?? null,
        themeKey: b.themeKey ?? null,
        sections: b.sections,
        extras: b.extras,
        languages: b.languages,
        info: (b.info ?? undefined) as any,
        email,
        vision: b.vision ?? null,
        utm: (b.utm ?? undefined) as any,
        abandoned: b.abandoned ?? false,
      };
      const existing = await prisma.checkoutDraft.findUnique({ where: { id: req.params.draftId } });
      if (existing?.convertedOrderId) return reply.code(204).send();
      await prisma.checkoutDraft.upsert({ where: { id: req.params.draftId }, create: { id: req.params.draftId, ...data }, update: data });
      return reply.code(204).send();
    },
  );

  const QuoteBody = SelectionBody.extend({
    /** Pay-to-publish preview for an existing event (owner/co-host): a missing themeKey, languages or extras fall back to the event's saved values (invitation theme, event languages, selectedExtras). */
    eventId: z.string().uuid().nullish(),
    extras: ExtrasField.optional(),
    languages: z.array(z.string().max(30)).max(12).optional(),
  });
  app.post(
    '/api/checkout/quote',
    { config: rl(app, 120, '1 minute'), schema: { tags: ['checkout'], summary: "Server-side price preview. Without themeKey, the event's saved theme is used when eventId is sent; with no theme at all → 422 'Please choose a design'", body: QuoteBody } },
    async (req) => {
      const b = req.body;
      if (b.eventId) {
        const { event } = await requireEventAccess(req, b.eventId, 'write');
        b.themeKey = b.themeKey ?? (await eventThemeKey(event.id));
        b.languages = b.languages ?? event.languages;
        b.extras = b.extras ?? event.selectedExtras;
      }
      return publicQuote(await computeQuote({ ...b, extras: b.extras ?? [], languages: b.languages ?? ['en'] }));
    },
  );

  app.post(
    '/api/checkout/session',
    {
      config: rl(app, 10, '1 minute'),
      preValidation: noLetter,
      schema: {
        tags: ['checkout'],
        summary: 'Create order + payment checkout session; returns redirect URL. Pay to publish: add-ons the event uses must be in extras, else 422 INVALID_SELECTION when extra_language units fall short: details.missing[].qty = units still short (not the total needed).',
        headers: z.object({ 'idempotency-key': z.string().max(200).optional() }).passthrough(),
        body: SelectionBody.extend({
          draftId: z.string().uuid().nullish(),
          eventId: z.string().uuid().nullish(),
          vision: z.string().trim().max(1500).nullish(),
          /** Self-serve pay-to-publish: defaults to the event's selectedExtras. Codes or `{code, qty}` (extra_language once per extra language). */
          extras: ExtrasField.optional(),
          info: InfoFields,
          consents: Consents,
          promoCode: z.string().max(60).nullish(),
        }),
      },
    },
    async (req) => {
      const b = req.body;
      if (b.eventId) {
        // Paying for an existing self-serve event: must be its owner, and only the self-serve plan applies.
        const { event, user } = await requireEventAccess(req, b.eventId, 'owner');
        if (event.serviceMode !== 'self_serve' || b.plan !== 'diy') throw unprocessable('INVALID_SELECTION', 'Only the self-serve plan can be purchased for an existing event.');
        if (event.paidAt) throw new AppError(409, 'CONFLICT', 'This event is already paid.');
        b.info.email = user.email;
        const inv = await prisma.invitation.findFirst({ where: { eventId: event.id }, orderBy: { createdAt: 'asc' }, include: { theme: true } });
        // N-32: an explicit themeKey wins (and is validated); otherwise the invitation's saved theme.
        b.themeKey = b.themeKey ?? inv?.theme?.key ?? null;
        b.languages = event.languages;
        b.extras = b.extras ?? event.selectedExtras;
        // Add-ons the invitation already uses must be paid for (they can't be unticked in the pay dialog).
        const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'diy' } });
        const need = Object.fromEntries((await addonsInUse(event, plan, inv)).map((n) => [n.code, n.qty]));
        const missing = Object.entries(need).filter(([code, n]) => b.extras!.filter((e) => e === code).length < n);
        if (missing.length) {
          throw new AppError(422, 'INVALID_SELECTION', `Your invitation uses ${missing.map(([c, n]) => (n > 1 ? `${n}× ${c}` : c)).join(', ')}; include ${missing.length > 1 ? 'them' : 'it'} in extras.`, Object.fromEntries(missing.map(([c]) => [`extras.${c}`, 'Required'])), { missing: missing.map(([code, n]) => ({ code, qty: n - b.extras!.filter((e) => e === code).length })) });
        }
      } else {
        const p = b.plan;
        const isSingle = p === 'birthday' || p === 'bridesmaid';
        const fields: Record<string, string> = {};
        if (isSingle ? !b.info.honoree && !b.info.partner1 : !b.info.partner1 || !b.info.partner2) fields[isSingle ? 'info.honoree' : 'info.partner1'] = 'Names are required';
        if (!b.info.eventDate) fields['info.eventDate'] = 'Date is required';
        if (Object.keys(fields).length) throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', fields);
      }
      const idemKey = req.headers['idempotency-key'] as string | undefined;
      if (idemKey && b.draftId) {
        const prior = await prisma.order.findFirst({ where: { checkoutDraftId: b.draftId, status: 'pending_payment' }, orderBy: { createdAt: 'desc' } });
        if (prior?.checkoutSessionId && prior.checkoutUrl && Date.now() - prior.createdAt.getTime() < 10 * 60_000) {
          // Re-use the pending session instead of creating duplicates on double-click / retries.
          return { url: prior.checkoutUrl, orderId: prior.id, orderNumber: prior.number, sessionId: prior.checkoutSessionId, ...(await chargedFromOrder(prior)) };
        }
      }
      const res = await createCheckout({ ...b, extras: b.extras ?? [], info: b.info });
      return { url: res.url, orderId: res.orderId, orderNumber: res.orderNumber, sessionId: res.sessionId, ...charged(res.quote) };
    },
  );

  // ── add-on-only checkout (after the plan is paid) ──
  // Spec: cohost of a paid event (self-serve or studio). Items are codes or {code, qty}; empty → 400.
  // `languages` (optional): the language list the host wants (e.g. after a 402 on PATCH languages). extra_language units
  // are trimmed to what that list needs beyond the plan cap and the units already paid; on payment the list is applied.
  const AddonBody = z.object({ eventId: z.string().uuid(), extras: ExtrasField, languages: z.array(z.string().trim().max(30)).min(1).max(8).optional() });
  const targetLanguages = (event: { languages: string[] }, langs?: string[]) => {
    if (!langs) return event.languages;
    const bad = langs.filter((l) => !LANGUAGE_CODES.has(l) && !/^x-[a-z0-9-]{1,20}$/.test(l));
    if (bad.length) throw unprocessable('INVALID_SELECTION', `Unsupported language "${bad[0]}".`, { languages: bad.join(', ') });
    return [...new Set(langs)];
  };
  async function addonContext(req: any, eventId: string) {
    const { event, user } = await requireEventAccess(req, eventId, 'write');
    if (!event.paidAt || !event.planCode) throw new AppError(409, 'PLAN_NOT_PAID', 'Pay for your plan first; add-ons are included in that checkout.', undefined, { eventId: event.id });
    return { event, user, owned: await paidExtras(event.id), delivered: event.productionStage === 'delivered' || !!event.designApprovedAt };
  }
  app.post('/api/checkout/addons/quote', { config: rl(app, 60, '1 minute'), schema: { tags: ['checkout'], summary: 'Price add-ons for an already paid event (owner).' + ' 422 INVALID_SELECTION when extra_language units fall short: details.missing[].qty = units still short (not the total needed).', body: AddonBody } }, async (req) => {
    const { event, owned, delivered } = await addonContext(req, req.body.eventId);
    const q = await computeAddonQuote({ planCode: event.planCode!, extras: req.body.extras, owned, delivered, languages: targetLanguages(event, req.body.languages) });
    return { plan: q.plan.code, extras: q.extras, lines: q.lines, subtotalCents: q.subtotalCents, currency: q.currency, taxNote: 'Sales tax is calculated at checkout based on your billing address.' };
  });
  app.post(
    '/api/checkout/addons',
    {
      config: rl(app, 10, '1 minute'),
      schema: {
        tags: ['checkout'],
        summary: 'Add-ons-only checkout for an already paid event (cohost); returns redirect URL.' + ' 422 INVALID_SELECTION when extra_language units fall short: details.missing[].qty = units still short (not the total needed).',
        headers: z.object({ 'idempotency-key': z.string().max(200).optional() }).passthrough(),
        body: AddonBody.extend({ consents: Consents }),
      },
    },
    async (req) => {
      const { event, user, owned, delivered } = await addonContext(req, req.body.eventId);
      if (req.headers['idempotency-key']) {
        // Re-use a pending identical add-ons session (double-click / retry) instead of creating another order.
        const prior = await prisma.order.findFirst({ where: { kind: 'addons', eventId: event.id, userId: user.id, status: 'pending_payment', createdAt: { gt: new Date(Date.now() - 10 * 60_000) } }, orderBy: { createdAt: 'desc' } });
        const same = prior && [...prior.extras].sort().join() === [...req.body.extras].sort().join();
        if (same && prior.checkoutSessionId && prior.checkoutUrl) return { url: prior.checkoutUrl, orderId: prior.id, orderNumber: prior.number, sessionId: prior.checkoutSessionId, ...(await chargedFromOrder(prior)) };
      }
      const res = await createAddonCheckout({ eventId: event.id, planCode: event.planCode!, extras: req.body.extras, owned, delivered, email: user.email, userId: user.id, languages: targetLanguages(event, req.body.languages) });
      return { url: res.url, orderId: res.orderId, orderNumber: res.orderNumber, sessionId: res.sessionId, ...charged(res.quote) };
    },
  );

  app.get('/api/checkout/session/:sessionId/verify', { config: rl(app, 60, '1 minute'), schema: { tags: ['checkout'], params: z.object({ sessionId: z.string().min(5).max(255) }) } }, async (req) => {
    let order = await prisma.order.findUnique({ where: { checkoutSessionId: req.params.sessionId }, include: { plan: true } });
    if (!order) return { valid: false, status: 'unknown', order: null };
    if (order.status === 'pending_payment' && payments.name === 'stripe') {
      const s = await payments.retrieveSession(order.checkoutSessionId!);
      if (s?.paid) {
        await fulfilOrder(order.id, { amountTotal: s.amountTotal, amountTax: s.amountTax, paymentIntentId: s.paymentIntentId });
        order = await prisma.order.findUnique({ where: { id: order.id }, include: { plan: true } });
      }
    }
    const o = order!;
    return {
      valid: o.status === 'paid',
      status: o.status,
      order: { id: o.id, number: o.number, kind: o.kind, plan: o.planCode, extras: o.extras, subtotalCents: o.subtotalCents, taxCents: o.taxCents, totalCents: o.totalCents, currency: o.currency, eventId: o.status === 'paid' ? o.eventId : null },
    };
  });
}
