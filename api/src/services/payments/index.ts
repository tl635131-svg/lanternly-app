import Stripe from 'stripe';
import { config } from '../../config.js';
import { randomToken } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';

export interface CheckoutLineItem {
  label: string;
  unitPriceCents: number;
  qty: number;
  code: string;
}
export interface CreateSessionInput {
  orderId: string;
  orderNumber: string;
  email: string;
  currency: string;
  items: CheckoutLineItem[];
  successUrl: string;
  cancelUrl: string;
}
export interface SessionStatus {
  sessionId: string;
  paid: boolean;
  status: 'open' | 'complete' | 'expired';
  amountTotal: number | null;
  amountTax: number | null;
  paymentIntentId: string | null;
}
export interface NormalizedWebhookEvent {
  id: string;
  type: string;
  object: any;
}

/** Payment driver interface. `mock` for local dev/tests, `stripe` for Stripe TEST mode. */
export interface PaymentDriver {
  readonly name: 'mock' | 'stripe';
  createCheckoutSession(input: CreateSessionInput): Promise<{ sessionId: string; url: string }>;
  retrieveSession(sessionId: string): Promise<SessionStatus | null>;
}

class MockPaymentDriver implements PaymentDriver {
  readonly name = 'mock' as const;
  async createCheckoutSession(input: CreateSessionInput) {
    const sessionId = `mock_cs_${randomToken(18)}`;
    return { sessionId, url: `${config.API_PUBLIC_URL}/api/dev/mock-checkout/${sessionId}` };
  }
  // Mock sessions are completed via the dev endpoint, which updates the order directly.
  async retrieveSession() {
    return null;
  }
}

class StripePaymentDriver implements PaymentDriver {
  readonly name = 'stripe' as const;
  constructor(private stripe: Stripe) {}
  async createCheckoutSession(input: CreateSessionInput) {
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer_email: input.email,
        client_reference_id: input.orderId,
        metadata: { orderId: input.orderId, orderNumber: input.orderNumber },
        payment_intent_data: { metadata: { orderId: input.orderId, orderNumber: input.orderNumber } },
        line_items: input.items.map((i) => ({
          quantity: i.qty,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: i.unitPriceCents,
            tax_behavior: 'exclusive',
            product_data: { name: i.label, metadata: { code: i.code }, tax_code: 'txcd_10000000' },
          },
        })),
        automatic_tax: { enabled: config.STRIPE_AUTOMATIC_TAX },
        billing_address_collection: 'required',
        allow_promotion_codes: true,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      },
      { idempotencyKey: `order-${input.orderId}` },
    );
    if (!session.url) throw new AppError(502, 'INTERNAL_ERROR', 'Payment provider did not return a checkout URL.');
    return { sessionId: session.id, url: session.url };
  }
  async retrieveSession(sessionId: string): Promise<SessionStatus | null> {
    const s = await this.stripe.checkout.sessions.retrieve(sessionId);
    return {
      sessionId: s.id,
      paid: s.payment_status === 'paid' || s.payment_status === 'no_payment_required',
      status: (s.status ?? 'open') as SessionStatus['status'],
      amountTotal: s.amount_total ?? null,
      amountTax: s.total_details?.amount_tax ?? null,
      paymentIntentId: typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent?.id ?? null),
    };
  }
}

// Stripe client: real test key when configured; otherwise a placeholder used ONLY for local webhook signature checks (no network calls).
const stripeClient = new Stripe(config.STRIPE_SECRET_KEY || 'sk_test_placeholder_not_used_for_api_calls');

export const payments: PaymentDriver = config.paymentDriver === 'stripe' ? new StripePaymentDriver(stripeClient) : new MockPaymentDriver();

/** Verify a Stripe webhook signature against the raw request body. Throws on invalid signature. */
export function verifyStripeWebhook(rawBody: Buffer, signature: string | undefined, secret = config.STRIPE_WEBHOOK_SECRET): NormalizedWebhookEvent {
  if (!secret) throw new AppError(503, 'INTERNAL_ERROR', 'Stripe webhook secret is not configured.');
  if (!signature) throw new AppError(400, 'WEBHOOK_SIGNATURE_INVALID', 'Missing Stripe-Signature header.');
  try {
    const evt = stripeClient.webhooks.constructEvent(rawBody, signature, secret);
    if ((evt as any).livemode === true) throw new Error('Live-mode events are rejected by this deployment.');
    return { id: evt.id, type: evt.type, object: (evt.data as any).object };
  } catch (err) {
    throw new AppError(400, 'WEBHOOK_SIGNATURE_INVALID', `Webhook signature verification failed: ${(err as Error).message}`);
  }
}

/** Test helper: build a valid signature header for a payload (used by automated tests and local tooling). */
export function signTestWebhook(payload: string, secret: string) {
  return stripeClient.webhooks.generateTestHeaderString({ payload, secret });
}
