import type { FastifyBaseLogger, FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';

export type ZApp = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, FastifyBaseLogger, ZodTypeProvider>;

/** Per-route rate limit config (no-op when rate limiting is disabled). `max` is scaled by RATE_LIMIT_MULTIPLIER. */
export function rl(app: ZApp, max: number, timeWindow: string, keyGenerator?: (req: any) => string): any {
  if (!app.limits.enabled) return {};
  return { rateLimit: { max: Math.max(1, Math.round(max * app.limits.multiplier)), timeWindow, ...(keyGenerator ? { keyGenerator } : {}) } };
}

/**
 * preValidation hook that rejects removed request fields with a clear 400 instead of silently dropping them.
 * `paths` are dot paths into the JSON body (e.g. "info.letter"); the value is the message shown to the client.
 */
export function rejectRemovedFields(paths: Record<string, string>) {
  return async (req: { body?: unknown }) => {
    const fields: Record<string, string> = {};
    for (const [path, message] of Object.entries(paths)) {
      let cur: unknown = req.body;
      const parts = path.split('.');
      for (const [i, part] of parts.entries()) {
        if (!cur || typeof cur !== 'object' || !(part in (cur as object))) break;
        if (i === parts.length - 1) fields[path] = message;
        cur = (cur as Record<string, unknown>)[part];
      }
    }
    if (Object.keys(fields).length) throw new AppError(400, 'VALIDATION_ERROR', Object.values(fields)[0]!, fields);
  };
}

export const EventParams = z.object({ id: z.string().uuid() });
export const uuid = z.string().uuid();

/**
 * Add-on selection: each item is a code or `{code, qty}` (qty only matters for repeatable add-ons such as
 * extra_language). Normalised to a flat code list with one entry per unit, e.g.
 * `["own_song", {code:"extra_language", qty:2}]` → `["own_song","extra_language","extra_language"]`.
 */
export const ExtraItem = z.union([z.string().max(40), z.object({ code: z.string().max(40), qty: z.number().int().min(1).max(20).optional() }).strict()]);
export const expandExtras = (items: z.infer<typeof ExtraItem>[]) => items.flatMap((i) => (typeof i === 'string' ? [i] : Array.from({ length: i.qty ?? 1 }, () => i.code)));
export const ExtrasField = z.array(ExtraItem).max(20).transform(expandExtras);
