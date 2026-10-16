/**
 * Deploy seed (Render start script): seeds the catalogue and demo data ONLY when the database has no users, so it is
 * safe to run on every start. Demo logins (admin@, designer@, host@, partner@, diy@example.com) all use DEMO_PASSWORD,
 * hashed with argon2id. The seed sends no email. On later starts it only re-copies the bundled library music files.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBRARY_MUSIC_PREFIX } from '../src/lib/music.js';
import { storage } from '../src/services/storage/index.js';

/** Local storage is wiped on every restart on Render's free plan: re-copy the bundled library tracks (files only, no DB writes). */
async function restoreLibraryMusic() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = [path.resolve(here, '../assets/music'), path.resolve(here, '../../assets/music')].find((d) => existsSync(d));
  if (!dir) return;
  const files = (await readdir(dir)).filter((f) => f.endsWith('.mp3'));
  for (const f of files) await storage.put(LIBRARY_MUSIC_PREFIX + f, await readFile(path.join(dir, f)), 'audio/mpeg');
  console.log(`[seed-if-empty] Library music restored (${files.length} file(s)).`);
}

const prisma = new PrismaClient();
try {
  const users = await prisma.user.count();
  if (users > 0) {
    console.log(`[seed-if-empty] ${users} user(s) found; skipping the demo seed.`);
    await restoreLibraryMusic();
  } else {
    const demo = process.env.DEMO_PASSWORD?.trim();
    if (!demo || demo.length < 12) {
      console.error('[seed-if-empty] DEMO_PASSWORD is missing or shorter than 12 characters; refusing to seed demo logins.');
      process.exit(1);
    }
    process.env.SEED_ADMIN_PASSWORD ||= demo;
    process.env.SEED_DEMO_PASSWORD ||= demo;
    console.log('[seed-if-empty] Empty database: seeding catalogue + demo data…');
    const { seed, disconnectSeed } = await import('../prisma/seed.js');
    try {
      await seed();
    } finally {
      await disconnectSeed();
    }
  }
} finally {
  await prisma.$disconnect();
}
