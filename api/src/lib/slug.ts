import { randomBytes } from 'node:crypto';
import type { Tx } from '../db.js';
import { prisma } from '../db.js';

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export const RESERVED_SLUGS = new Set(['api', 'admin', 'app', 'login', 'auth', 'checkout', 'pricing', 'styles', 'blog', 'docs', 'health', 'static', 'i', 'demo']);

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const suffix = (n = 4) => Array.from(randomBytes(n), (b) => SUFFIX_ALPHABET[b % 36]).join('');

/**
 * Auto-generated invitation slug: the names plus a short random suffix, e.g. "maya-theo-7k2q".
 * Hosts with the custom_link add-on can pick their own (old slugs keep redirecting).
 */
export async function uniqueInvitationSlug(base: string, db: Tx | typeof prisma = prisma): Promise<string> {
  const root = slugify(base.replace(/&/g, ' ').replace(/\b(and|et)\b/gi, ' ')).slice(0, 50).replace(/-+$/g, '') || 'celebration';
  for (let i = 0; i < 20; i++) {
    const candidate = `${root}-${suffix(i < 10 ? 4 : 6)}`;
    if (RESERVED_SLUGS.has(candidate)) continue;
    const exists = (await db.invitation.findUnique({ where: { slug: candidate }, select: { id: true } })) ?? (await db.invitationSlugRedirect.findUnique({ where: { oldSlug: candidate }, select: { oldSlug: true } }));
    if (!exists) return candidate;
  }
  return `${root}-${suffix(8)}`;
}
