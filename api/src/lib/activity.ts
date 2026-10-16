import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../db.js';

export async function logActivity(
  input: { eventId?: string | null; actorType: 'guest' | 'host' | 'admin' | 'system'; actorId?: string | null; action: string; data?: Prisma.InputJsonValue },
  db: Tx | typeof prisma = prisma,
) {
  await db.activityLog.create({
    data: { eventId: input.eventId ?? null, actorType: input.actorType, actorId: input.actorId ?? null, action: input.action, data: input.data ?? {} },
  });
}
