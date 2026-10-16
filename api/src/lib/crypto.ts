import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/** URL-safe random token. 16 bytes = 128 bits of entropy → 22 chars. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmac(value: string, purpose = 'default'): string {
  return createHmac('sha256', `${config.APP_SECRET}:${purpose}`).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Signed, expiring value: `${value}.${exp}.${sig}` */
export function signValue(value: string, purpose: string, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${value}.${exp}.${hmac(`${value}.${exp}`, purpose)}`;
}

export function verifySignedValue(signed: string, purpose: string): string | null {
  const parts = signed.split('.');
  if (parts.length !== 3) return null;
  const [value, expStr, sig] = parts as [string, string, string];
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  return safeEqual(sig, hmac(`${value}.${exp}`, purpose)) ? value : null;
}

/** Non-expiring signed value (used for unsubscribe links). */
export function signForever(value: string, purpose: string): string {
  return `${value}.${hmac(value, purpose)}`;
}
export function verifyForever(signed: string, purpose: string): string | null {
  const idx = signed.lastIndexOf('.');
  if (idx <= 0) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  return safeEqual(sig, hmac(value, purpose)) ? value : null;
}
