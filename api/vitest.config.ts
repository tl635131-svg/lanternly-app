import { defineConfig } from 'vitest/config';

export const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://digital_invite:devpassword@localhost:5432/digital_invite_test?schema=public',
  APP_SECRET: 'test-only-secret-0123456789abcdef0123456789abcdef',
  API_PUBLIC_URL: 'http://localhost:4000',
  WEB_URL: 'http://localhost:3000',
  INVITE_BASE_URL: 'http://localhost:3000/i',
  CORS_ORIGINS: 'http://localhost:3000',
  PAYMENT_DRIVER: 'mock',
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_only_not_a_real_secret',
  EMAIL_DRIVER: 'console',
  EMAIL_WEBHOOK_SECRET: 'test-email-webhook-secret',
  STORAGE_LOCAL_DIR: './var/test-uploads',
  RUN_WORKER_IN_PROCESS: 'false',
  QUIET_HOURS_ENABLED: 'false',
  RATE_LIMIT_ENABLED: 'true',
  RATE_LIMIT_AUTH_PER_MIN: '1000',
  RATE_LIMIT_RSVP_PER_MIN: '1000',
  RATE_LIMIT_MULTIPLIER: '100',
  LOG_LEVEL: 'silent',
  SEED_ADMIN_PASSWORD: 'Test-Admin-Password-1',
  SEED_DEMO_PASSWORD: 'Test-Demo-Password-1',
};

export default defineConfig({
  test: {
    env: TEST_ENV,
    globalSetup: ['./tests/global-setup.ts'],
    include: ['tests/**/*.test.ts'],
    fileParallelism: false, // one shared test database
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
