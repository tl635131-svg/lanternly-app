import { z } from 'zod';
import { prisma } from '../db.js';
import { notFound } from '../lib/errors.js';
import { storage, verifyAssetSignature } from '../services/storage/index.js';
import type { ZApp } from './types.js';

export default async function files(app: ZApp) {
  /** Serve a private file through a signed, expiring URL (see `url` on asset objects). */
  app.get('/api/files/:token', { schema: { tags: ['assets'], params: z.object({ token: z.string().max(400) }) } }, async (req, reply) => {
    const assetId = verifyAssetSignature(req.params.token);
    if (!assetId) throw notFound('File');
    const asset = await prisma.asset.findFirst({ where: { id: assetId, deletedAt: null } });
    if (!asset || !(await storage.exists(asset.storageKey))) throw notFound('File');
    reply.header('cache-control', 'private, max-age=3600');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('content-disposition', `inline; filename="${asset.originalName.replace(/[^\w.\- ]/g, '_')}"`);
    return reply.type(asset.mime).send(await storage.getStream(asset.storageKey));
  });
}
