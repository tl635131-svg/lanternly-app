import 'dotenv/config';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));
const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number.parseInt(v, 10)));

/**
 * Hosted deploys (Render Blueprint, see render.yaml) can't interpolate env vars, so a bare hostname may be given instead
 * of a full URL: WEB_HOST (the web app's public hostname) fills WEB_URL, INVITE_BASE_URL and CORS_ORIGINS when those are
 * unset, and RENDER_EXTERNAL_URL (set by Render on the API service) fills API_PUBLIC_URL. Explicit values always win.
 */
function withHostedDefaults(src: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const e = { ...src };
  const blank = (k: string) => e[k] === undefined || e[k] === '';
  const webHost = e.WEB_HOST?.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (webHost) {
    const webUrl = `https://${webHost}`;
    if (blank('WEB_URL')) e.WEB_URL = webUrl;
    if (blank('INVITE_BASE_URL')) e.INVITE_BASE_URL = `${e.WEB_URL!.replace(/\/+$/, '')}/i`;
    if (blank('CORS_ORIGINS')) e.CORS_ORIGINS = new URL(e.WEB_URL!).origin;
  }
  if (blank('API_PUBLIC_URL') && e.RENDER_EXTERNAL_URL) e.API_PUBLIC_URL = e.RENDER_EXTERNAL_URL;
  return e;
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: int(4000),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),

  // Public URLs
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  // Base used for guest invitation links: `${INVITE_BASE_URL}/{slug}` (+ `?g=<token>` for personal links)
  INVITE_BASE_URL: z.string().url().default('http://localhost:3000/i'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  TRUST_PROXY: bool(false),
  // Dev helpers (/api/dev/*: mock checkout page, admin-only outbox and job runner). Never allowed in production.
  DEV_ROUTES_ENABLED: bool(process.env.NODE_ENV !== 'production'),
  // Feature flags. FEATURE_OWN_SONG=false hides the own_song add-on and makes every own-song path return 403 FEATURE_DISABLED.
  FEATURE_OWN_SONG: bool(true),

  // Security
  APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters'),
  SESSION_TTL_DAYS: int(30),
  COOKIE_SECURE: bool(process.env.NODE_ENV === 'production'),
  COOKIE_DOMAIN: z.string().optional(),
  SET_PASSWORD_TOKEN_TTL_HOURS: int(72),
  RESET_TOKEN_TTL_MINUTES: int(60),
  LOGIN_LINK_TTL_MINUTES: int(20),
  COHOST_INVITE_TTL_DAYS: int(7),
  RATE_LIMIT_ENABLED: bool(true),
  RATE_LIMIT_AUTH_PER_MIN: int(10),
  RATE_LIMIT_RSVP_PER_MIN: int(10),
  RATE_LIMIT_RSVP_PER_HOUR: int(100),
  RATE_LIMIT_MULTIPLIER: z.string().optional().transform((v) => (v ? Number(v) : 1)),

  // Payments
  PAYMENT_DRIVER: z.enum(['auto', 'mock', 'stripe']).default('auto'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_AUTOMATIC_TAX: bool(true),
  CURRENCY: z.string().length(3).default('CAD'),

  // Email
  EMAIL_DRIVER: z.enum(['console']).default('console'),
  EMAIL_FROM: z.string().default('Invitations <hello@example.com>'),
  STUDIO_INBOX: z.string().email().default('studio@example.com'),
  EMAIL_WEBHOOK_SECRET: z.string().optional(),

  // Storage
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./var/uploads'),
  SIGNED_URL_TTL_SECONDS: int(60 * 60 * 24 * 7),

  // Production with mock payments / console email (demo deploys only). Without it, production refuses to start with them.
  ALLOW_MOCK_PROVIDERS_IN_PRODUCTION: bool(false),

  // Jobs
  RUN_WORKER_IN_PROCESS: bool(true),
  WORKER_POLL_MS: int(2000),
  QUIET_HOURS_ENABLED: bool(true),

  // Product rules
  ARCHIVE_AFTER_MONTHS: int(2),
});

const parsed = EnvSchema.safeParse(withHostedDefaults(process.env));
if (!parsed.success) {
  // Fail fast with one line per missing/invalid variable.
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.input === undefined ? 'missing (required)' : i.message}`);
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${lines.join('\n')}\nSee api/.env.example (and README "Deploy to Render").`);
  throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
}

const env = parsed.data;

function resolvePaymentDriver(): 'mock' | 'stripe' {
  if (env.PAYMENT_DRIVER === 'mock') return 'mock';
  if (env.PAYMENT_DRIVER === 'stripe') return 'stripe';
  return env.STRIPE_SECRET_KEY ? 'stripe' : 'mock';
}

// Hard safety rail: this project must never use live Stripe keys.
for (const key of [env.STRIPE_SECRET_KEY]) {
  if (key && /^(sk|rk)_live_/.test(key)) {
    throw new Error('Live Stripe keys are not allowed. Use test-mode keys (sk_test_…) only.');
  }
}
if (env.NODE_ENV === 'production' && (!env.COOKIE_SECURE || /dev-only|change-me|test-only/i.test(env.APP_SECRET))) {
  throw new Error('Production requires COOKIE_SECURE=true and a real APP_SECRET.');
}
if (env.NODE_ENV === 'production' && env.DEV_ROUTES_ENABLED) {
  throw new Error('DEV_ROUTES_ENABLED must not be set in production.');
}
if (env.NODE_ENV === 'production') {
  const local = (['WEB_URL', 'API_PUBLIC_URL', 'INVITE_BASE_URL'] as const).filter((k) => /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(env[k]));
  if (local.length) throw new Error(`Production needs public URLs: ${local.join(', ')} still point at localhost. Set them (or WEB_HOST; API_PUBLIC_URL defaults to RENDER_EXTERNAL_URL on Render).`);
}
const corsOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
for (const o of corsOrigins) {
  // Credentialed CORS: only exact origins (scheme://host[:port]), never "*".
  if (!/^https?:\/\/[^/*\s]+$/.test(o)) throw new Error(`CORS_ORIGINS entry "${o}" must be an exact origin like https://app.example.com (no wildcard, no path).`);
}
if (resolvePaymentDriver() === 'stripe' && !env.STRIPE_SECRET_KEY) {
  throw new Error('PAYMENT_DRIVER=stripe requires STRIPE_SECRET_KEY (test mode key).');
}
/** Mock payments / console email in production: only with ALLOW_MOCK_PROVIDERS_IN_PRODUCTION=true (demo deploys). */
const mockProviders = [resolvePaymentDriver() === 'mock' ? 'payments=mock' : null, env.EMAIL_DRIVER === 'console' ? 'email=console' : null].filter((x): x is string => !!x);
if (env.NODE_ENV === 'production' && mockProviders.length && !env.ALLOW_MOCK_PROVIDERS_IN_PRODUCTION) {
  throw new Error(`Production refuses mock providers (${mockProviders.join(', ')}). Configure real providers, or set ALLOW_MOCK_PROVIDERS_IN_PRODUCTION=true for a demo deploy.`);
}

export const config = {
  ...env,
  paymentDriver: resolvePaymentDriver(),
  corsOrigins,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  devRoutes: env.DEV_ROUTES_ENABLED && env.NODE_ENV !== 'production',
  /** Mock providers active in production (demo deploy): startup banner, and the mock checkout page stays reachable. */
  mockProvidersInProd: env.NODE_ENV === 'production' ? mockProviders : [],
  /** The mock checkout page (+ complete/cancel) is served with dev routes, or in production when mock payments are explicitly allowed. */
  mockCheckoutRoutes: resolvePaymentDriver() === 'mock' && ((env.DEV_ROUTES_ENABLED && env.NODE_ENV !== 'production') || (env.NODE_ENV === 'production' && env.ALLOW_MOCK_PROVIDERS_IN_PRODUCTION)),
};

export type AppConfig = typeof config;

/** Feature flags, read at request time (tests may flip them). */
export const features = { ownSong: env.FEATURE_OWN_SONG };
