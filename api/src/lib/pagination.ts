import { z } from 'zod';

export const PaginationQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export function encodeCursor(id: string): string {
  return Buffer.from(id).toString('base64url');
}
export function decodeCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined;
  try {
    const id = Buffer.from(cursor, 'base64url').toString('utf8');
    return /^[0-9a-f-]{36}$/i.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Prisma args for id-cursor pagination; fetch limit+1 to know if there is a next page. */
export function pageArgs(cursor: string | undefined, limit: number) {
  const id = decodeCursor(cursor);
  return { take: limit + 1, ...(id ? { cursor: { id }, skip: 1 } : {}) };
}

export function pageResult<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]!.id) : null };
}
