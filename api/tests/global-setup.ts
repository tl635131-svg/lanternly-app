import { execSync } from 'node:child_process';
import { TEST_ENV } from '../vitest.config.js';

/**
 * Prepare the dedicated test database without destroying anything:
 * apply pending migrations (non-destructive) and run the idempotent seed (catalogue + demo data).
 * Tests create their own uniquely-named records, so they don't depend on an empty database.
 * To wipe the test DB manually: `npm run db:test:reset` (a human decision — not run automatically).
 */
export default function setup() {
  if (!TEST_ENV.DATABASE_URL.includes('_test')) throw new Error('Refusing to use a database whose name does not contain "_test".');
  const env = { ...process.env, ...TEST_ENV };
  execSync('npx prisma migrate deploy', { env, stdio: 'pipe' });
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'pipe' });
}
