import { z } from 'zod';

/**
 * Strict boolean for query strings / form fields.
 * Accepts exactly "true" | "false" | "1" | "0" (anything else → 400 VALIDATION_ERROR).
 * Never use z.coerce.boolean() for query params: it turns the string "false" into true.
 */
export const queryBool = () =>
  z
    .enum(['true', 'false', '1', '0'], { error: 'Use true or false (or 1 / 0)' })
    .transform((v) => v === 'true' || v === '1');

/** Strict boolean query param with a default when the param is absent. */
export const queryBoolDefault = (def: boolean) => queryBool().optional().transform((v) => (v === undefined ? def : v));
