import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { createReadStream, type ReadStream } from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { signValue, verifySignedValue } from '../../lib/crypto.js';

/** Storage driver interface. Local disk for dev; an S3-compatible driver can implement the same contract. */
export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Buffer, mime: string): Promise<void>;
  getStream(key: string): Promise<ReadStream | NodeJS.ReadableStream>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

class LocalDiskStorage implements StorageDriver {
  readonly name = 'local';
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key');
    return p;
  }
  async put(key: string, body: Buffer) {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  async getStream(key: string) {
    return createReadStream(this.resolve(key));
  }
  async read(key: string) {
    return readFile(this.resolve(key));
  }
  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
  async exists(key: string) {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

class S3StorageStub implements StorageDriver {
  readonly name = 's3';
  private fail(): never {
    throw new Error('S3 storage driver is not configured yet. Implement with @aws-sdk/client-s3 (put/get/delete) and presigned URLs.');
  }
  put(): Promise<void> { this.fail(); }
  getStream(): Promise<ReadStream> { this.fail(); }
  read(): Promise<Buffer> { this.fail(); }
  delete(): Promise<void> { this.fail(); }
  exists(): Promise<boolean> { this.fail(); }
}

export const storage: StorageDriver =
  config.STORAGE_DRIVER === 's3' ? new S3StorageStub() : new LocalDiskStorage(path.resolve(config.STORAGE_LOCAL_DIR));

/** Private files are served only through short-lived HMAC-signed URLs. */
export function signedAssetUrl(assetId: string, ttl = config.SIGNED_URL_TTL_SECONDS) {
  return `${config.API_PUBLIC_URL}/api/files/${encodeURIComponent(signValue(assetId, 'asset', ttl))}`;
}
export function verifyAssetSignature(token: string): string | null {
  return verifySignedValue(token, 'asset');
}

export const UPLOAD_RULES: Record<string, { mimes: string[]; maxBytes: number }> = {
  image: { mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'], maxBytes: 15 * 1024 * 1024 },
  audio: { mimes: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac'], maxBytes: 20 * 1024 * 1024 },
};
export const ASSET_KINDS = { brief_photo: 'image', illustration_ref: 'image', cover: 'image', gallery: 'image', music: 'audio' } as const;

/** Light magic-byte sniffing so a renamed file can't masquerade as an image/audio file. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (/hei|hev|mif1|msf1/.test(brand)) return 'image/heic';
    if (/M4A|mp4|isom|M4B/.test(brand)) return 'audio/mp4';
  }
  if (buf.toString('ascii', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0)) return 'audio/mpeg';
  return null;
}
