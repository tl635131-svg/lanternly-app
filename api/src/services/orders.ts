import type { Order } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { conflict, notFound } from '../lib/errors.js';
import { i18nName, isoDate, money, parseDateOnly } from '../lib/format.js';
import { publish } from '../lib/bus.js';
import { enqueueMessage } from './messaging/index.js';
import { payments } from './payments/index.js';
import { computeAddonQuote, computeQuote, type QuoteInput } from './pricing.js';
import type { Tx } from '../db.js';
import { EXTRA_BRIEF_SECTIONS, isRushAddon } from '../lib/addons.js';
import { adminEventUrl, provisionEvent, sendAccessEmail } from './provisioning.js';

export interface CheckoutInput extends QuoteInput {
  draftId?: string | null;
  eventId?: string | null; // pay for an existing self-serve event (diy plan)
  vision?: string | null;
  info: { partner1?: string; partner2?: string; honoree?: string; eventDate?: string | null; venue?: string | null; email: string; phone?: string | null; message?: string | null };
}

async function nextOrderNumber() {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('order_number_seq') AS n`;
  return `ORD-${new Date().getUTCFullYear()}-${String(rows[0]!.n).padStart(5, '0')}`;
}

export async function createCheckout(input: CheckoutInput) {
  const q = await computeQuote(input);
  const number = await nextOrderNumber();
  const now = new Date();
  const order = await prisma.order.create({
    data: {
      number,
      email: input.info.email,
      planCode: q.plan.code,
      themeId: q.theme?.id ?? null,
      eventId: input.eventId ?? null,
      sections: q.sections,
      extras: q.extras,
      languages: q.languages,
      vision: input.vision ?? null,
      buyerInfo: { ...input.info, customBlockNames: q.customNames },
      subtotalCents: q.subtotalCents,
      totalCents: q.subtotalCents, // tax added by the payment provider; final total stored on payment
      currency: q.currency,
      status: 'pending_payment',
      paymentProvider: payments.name,
      consentTermsAt: now,
      consentPrivacyAt: now,
      checkoutDraftId: input.draftId ?? null,
      express: q.express,
      items: { create: q.lines.map((l) => ({ kind: l.kind, code: l.code, label: l.label, qty: l.qty, unitPriceCents: l.unitPriceCents })) },
    },
  });
  const session = await payments.createCheckoutSession({
    orderId: order.id,
    orderNumber: number,
    email: order.email,
    currency: q.currency,
    items: q.lines.filter((l) => l.totalCents > 0).map((l) => ({ code: l.code, label: l.label, qty: l.qty, unitPriceCents: l.unitPriceCents })),
    successUrl: `${config.WEB_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${config.WEB_URL}/pricing?checkout=canceled${input.draftId ? `&draft=${input.draftId}` : ''}`,
  });
  await prisma.order.update({ where: { id: order.id }, data: { checkoutSessionId: session.sessionId, checkoutUrl: session.url } });
  if (input.draftId) await prisma.checkoutDraft.updateMany({ where: { id: input.draftId }, data: { lastStep: 'payment' } });
  return { orderId: order.id, orderNumber: number, url: session.url, sessionId: session.sessionId, quote: q };
}

/**
 * Manual admin sale (phone / bank transfer): a real paid order with payment_provider 'manual', the admin who made it,
 * server-priced plan / add-on lines (extra_language as one line with qty n) and an audit entry. Its add-ons count as
 * purchased like any paid order; refunds follow refundOrder.
 */
export async function createManualOrder(tx: Tx, input: { quote: Awaited<ReturnType<typeof computeQuote>>; eventId: string; userId: string; email: string; adminId: string }) {
  const q = input.quote;
  const now = new Date();
  const order = await tx.order.create({
    data: {
      number: await nextOrderNumber(),
      kind: 'plan',
      email: input.email,
      userId: input.userId,
      eventId: input.eventId,
      planCode: q.plan.code,
      themeId: q.theme?.id ?? null,
      sections: q.sections,
      extras: q.extras,
      languages: q.languages,
      buyerInfo: { email: input.email, customBlockNames: q.customNames },
      subtotalCents: q.subtotalCents,
      totalCents: q.subtotalCents,
      currency: q.currency,
      status: 'paid',
      paidAt: now,
      paymentProvider: 'manual',
      createdByAdminId: input.adminId,
      consentTermsAt: now,
      consentPrivacyAt: now,
      express: q.express,
      items: { create: q.lines.map((l) => ({ kind: l.kind, code: l.code, label: l.label, qty: l.qty, unitPriceCents: l.unitPriceCents })) },
    },
  });
  await tx.activityLog.create({ data: { eventId: input.eventId, actorType: 'admin', actorId: input.adminId, action: 'order.manual_created', data: { orderId: order.id, orderNumber: order.number, totalCents: order.totalCents, extras: order.extras } } });
  return order;
}

/** Add-on-only checkout for an already paid event (the owner buys e.g. own_song or custom_link after paying). */
export async function createAddonCheckout(input: { eventId: string; planCode: NonNullable<Order['planCode']>; extras: string[]; owned: string[]; delivered?: boolean; email: string; userId: string; languages: string[] }) {
  const q = await computeAddonQuote({ planCode: input.planCode, extras: input.extras, owned: input.owned, delivered: input.delivered, languages: input.languages });
  const number = await nextOrderNumber();
  const now = new Date();
  const order = await prisma.order.create({
    data: {
      number,
      kind: 'addons',
      email: input.email,
      userId: input.userId,
      planCode: null, // spec: add-on-only orders carry no plan; event_id identifies the event
      eventId: input.eventId,
      sections: [],
      extras: q.extras,
      languages: input.languages,
      buyerInfo: { email: input.email },
      subtotalCents: q.subtotalCents,
      totalCents: q.subtotalCents,
      currency: q.currency,
      status: 'pending_payment',
      paymentProvider: payments.name,
      consentTermsAt: now,
      consentPrivacyAt: now,
      express: q.express,
      items: { create: q.lines.map((l) => ({ kind: l.kind, code: l.code, label: l.label, qty: l.qty, unitPriceCents: l.unitPriceCents })) },
    },
  });
  const session = await payments.createCheckoutSession({
    orderId: order.id,
    orderNumber: number,
    email: order.email,
    currency: q.currency,
    items: q.lines.filter((l) => l.totalCents > 0).map((l) => ({ code: l.code, label: l.label, qty: l.qty, unitPriceCents: l.unitPriceCents })),
    successUrl: `${config.WEB_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${config.WEB_URL}/events/${input.eventId}?addons=canceled`,
  });
  await prisma.order.update({ where: { id: order.id }, data: { checkoutSessionId: session.sessionId, checkoutUrl: session.url } });
  return { orderId: order.id, orderNumber: number, url: session.url, sessionId: session.sessionId, quote: q };
}

/** Effects of add-ons bought after the event exists: rush → express; studio brief sections are added for the host to fill. */
async function applyAddonEffects(tx: Tx, eventId: string, extras: string[]) {
  if (extras.some(isRushAddon)) await tx.event.update({ where: { id: eventId }, data: { express: true } });
  const brief = await tx.brief.findUnique({ where: { eventId } });
  if (!brief) return;
  const add = [...new Set(extras.map((e) => EXTRA_BRIEF_SECTIONS[e]).filter((k): k is string => !!k && !brief.sections.includes(k)))];
  if (!add.length) return;
  const rsvpAt = brief.sections.indexOf('rsvp');
  const sections = rsvpAt >= 0 ? [...brief.sections.slice(0, rsvpAt), ...add, ...brief.sections.slice(rsvpAt)] : [...brief.sections, ...add];
  await tx.brief.update({ where: { eventId }, data: { sections, newSections: brief.locked ? [...brief.newSections, ...add] : brief.newSections } });
}

/**
 * Mark an order paid and provision everything. Idempotent: safe to call from webhook, verify endpoint and retries.
 */
export async function fulfilOrder(orderId: string, payment: { amountTotal?: number | null; amountTax?: number | null; paymentIntentId?: string | null } = {}) {
  const result = await prisma.$transaction(async (tx) => {
    // Row lock to serialize concurrent webhook + verify calls.
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { plan: true } });
    if (!order) throw notFound('Order');
    if (order.status === 'paid' || order.status === 'refunded') return { order, provisioned: null, already: true };
    if (order.status === 'canceled') throw conflict('CONFLICT', 'Order was canceled.');

    const paidAt = new Date();
    const taxCents = payment.amountTax ?? 0;
    const totalCents = payment.amountTotal ?? order.subtotalCents + taxCents;
    let provisioned: Awaited<ReturnType<typeof provisionEvent>> | null = null;
    let eventId = order.eventId;
    let userId = order.userId;

    if (order.kind === 'addons' && order.eventId) {
      // Add-on-only purchase: the event is already paid; entitlements come from paid orders.
      await applyAddonEffects(tx, order.eventId, order.extras);
      // Extra languages bought for a target language list (sent with the add-ons checkout): apply that list now.
      if (order.extras.includes('extra_language') && order.languages.length) {
        const ev = await tx.event.findUnique({ where: { id: order.eventId } });
        if (ev && order.languages.join() !== ev.languages.join() && order.languages.length > ev.languages.length) {
          await tx.event.update({ where: { id: order.eventId }, data: { languages: order.languages, primaryLanguage: order.languages[0] } });
        }
      }
    } else if (order.eventId) {
      // Self-serve event paying to unlock publishing. Selected add-ons are now purchased.
      await tx.event.update({ where: { id: order.eventId }, data: { paidAt, planCode: order.planCode ?? undefined, selectedExtras: [], languages: order.languages.length ? order.languages : undefined } });
      if (!userId) userId = (await tx.eventMember.findFirst({ where: { eventId: order.eventId, role: 'owner' } }))?.userId ?? null;
    } else {
      if (!order.plan || !order.planCode) throw conflict('CONFLICT', 'Order has no plan.');
      const plan = order.plan;
      const info = order.buyerInfo as Record<string, any>;
      provisioned = await provisionEvent(tx, {
        email: order.email,
        name: info.partner1 ?? info.honoree ?? null,
        product: plan.product,
        planCode: order.planCode,
        serviceMode: plan.serviceMode,
        hostNames: plan.product === 'birthday' || plan.product === 'bridesmaid' ? { honoree: info.honoree ?? info.partner1 ?? '' } : { partner1: info.partner1 ?? '', partner2: info.partner2 ?? '' },
        eventDate: parseDateOnly(info.eventDate),
        venueName: info.venue ?? null,
        languages: order.languages,
        themeId: order.themeId,
        sections: order.sections,
        customNames: info.customBlockNames ?? {},
        extras: order.extras,
        express: order.express,
        maxRevisionRounds: plan.revisionRounds,
        hasRsvp: plan.hasRsvp,
        paid: true,
        vision: order.vision,
      });
      eventId = provisioned.event.id;
      userId = provisioned.user.id;
    }
    const updated = await tx.order.update({
      where: { id: order.id },
      data: { status: 'paid', paidAt, taxCents, totalCents, paymentIntentId: payment.paymentIntentId ?? order.paymentIntentId, eventId, userId },
      include: { plan: true },
    });
    if (order.checkoutDraftId) await tx.checkoutDraft.updateMany({ where: { id: order.checkoutDraftId }, data: { convertedOrderId: order.id, abandoned: false, lastStep: 'paid' } });
    await logActivity({ eventId, actorType: 'system', action: 'order.paid', data: { orderNumber: order.number, totalCents } }, tx);
    if (provisioned) {
      await enqueueMessage(
        {
          to: config.STUDIO_INBOX,
          template: 'new_order_studio',
          data: { orderNumber: order.number, planName: i18nName(order.plan?.nameI18n), email: order.email, title: provisioned.event.title, eventDate: isoDate(provisioned.event.eventDate), total: money(totalCents, order.currency), adminUrl: adminEventUrl(provisioned.event.id) },
          eventId,
          idempotencyKey: `new-order-studio:${order.id}`,
        },
        tx,
      );
    }
    return { order: updated, provisioned, already: false };
  });

  if (!result.already) {
    const user = result.order.userId ? await prisma.user.findUnique({ where: { id: result.order.userId } }) : null;
    if (user) {
      await sendAccessEmail(user, {
        template: 'order_confirmation',
        eventId: result.order.eventId,
        data: { orderNumber: result.order.number, planName: result.order.kind === 'addons' ? `Add-ons (${result.order.extras.join(', ')})` : i18nName(result.order.plan?.nameI18n), total: money(result.order.totalCents, result.order.currency) },
      });
    }
    if (result.order.eventId) publish(result.order.eventId, 'stage.changed', { paid: true });
  }
  return result;
}

export async function cancelOrderBySession(sessionId: string) {
  const order = await prisma.order.findUnique({ where: { checkoutSessionId: sessionId } });
  if (!order || order.status !== 'pending_payment') return order;
  if (order.checkoutDraftId) await prisma.checkoutDraft.updateMany({ where: { id: order.checkoutDraftId }, data: { abandoned: true } });
  return prisma.order.update({ where: { id: order.id }, data: { status: 'canceled', canceledAt: new Date() } });
}

export async function refundOrder(order: Order) {
  if (order.status === 'refunded') return order;
  const updated = await prisma.order.update({ where: { id: order.id }, data: { status: 'refunded', refundedAt: new Date() } });
  if (order.kind === 'addons') {
    // Refunding an add-on order revokes only those add-ons (entitlements count paid orders); the invitation stays live.
    if (order.eventId) await logActivity({ eventId: order.eventId, actorType: 'system', action: 'order.refunded', data: { orderNumber: order.number, extras: order.extras } });
    await enqueueMessage({ to: config.STUDIO_INBOX, template: 'custom', data: { subject: `Order ${order.number} refunded`, body: `Add-on order ${order.number} (${order.email}) was refunded; its add-ons (${order.extras.join(', ')}) are revoked. The invitation was not changed.` } });
    return updated;
  }
  if (order.eventId) {
    await prisma.invitation.updateMany({ where: { eventId: order.eventId }, data: { status: 'archived', archivedAt: new Date() } });
    await prisma.event.update({ where: { id: order.eventId }, data: { paidAt: null } });
    await logActivity({ eventId: order.eventId, actorType: 'system', action: 'order.refunded', data: { orderNumber: order.number } });
  }
  await enqueueMessage({ to: config.STUDIO_INBOX, template: 'custom', data: { subject: `Order ${order.number} refunded`, body: `Order ${order.number} (${order.email}) was refunded; its invitation has been archived.` } });
  return updated;
}
