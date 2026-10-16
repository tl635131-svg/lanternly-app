import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../../db.js';

export type JobType = 'send_message' | 'dispatch_campaign' | 'archive_events' | 'rsvp_deadline_reminders' | 'cleanup_tokens';

export async function enqueueJob(type: JobType, payload: Prisma.InputJsonValue, opts: { runAt?: Date; uniqueKey?: string; maxAttempts?: number } = {}, db: Tx | typeof prisma = prisma) {
  if (opts.uniqueKey) {
    const existing = await db.job.findUnique({ where: { uniqueKey: opts.uniqueKey } });
    if (existing) return existing;
  }
  return db.job.create({ data: { type, payload, runAt: opts.runAt ?? new Date(), uniqueKey: opts.uniqueKey ?? null, maxAttempts: opts.maxAttempts ?? 4 } });
}

// Prisma stores DateTime as UTC in `timestamp(3)` columns, so compare against UTC now (independent of the DB session time zone).
/** Claim due jobs atomically (Postgres SKIP LOCKED) so multiple workers can run safely. */
export async function claimJobs(workerId: string, limit = 10) {
  return prisma.$queryRaw<{ id: string; type: string; payload: any; attempts: number; max_attempts: number }[]>`
    UPDATE jobs SET status = 'running', locked_by = ${workerId}, locked_at = (now() AT TIME ZONE 'UTC'), attempts = attempts + 1, updated_at = (now() AT TIME ZONE 'UTC')
    WHERE id IN (
      SELECT id FROM jobs WHERE status = 'scheduled' AND run_at <= (now() AT TIME ZONE 'UTC')
      ORDER BY run_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts, max_attempts`;
}

const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000];

export async function completeJob(id: string) {
  await prisma.job.update({ where: { id }, data: { status: 'done', lockedBy: null, lastError: null } });
}

export async function failJob(id: string, attempts: number, maxAttempts: number, error: string) {
  const final = attempts >= maxAttempts;
  await prisma.job.update({
    where: { id },
    data: { status: final ? 'failed' : 'scheduled', lastError: error.slice(0, 1000), lockedBy: null, runAt: final ? undefined : new Date(Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!) },
  });
}

/** Release jobs stuck in "running" (worker crashed) after 10 minutes. */
export async function releaseStaleJobs() {
  await prisma.job.updateMany({ where: { status: 'running', lockedAt: { lt: new Date(Date.now() - 10 * 60_000) } }, data: { status: 'scheduled', lockedBy: null } });
}
