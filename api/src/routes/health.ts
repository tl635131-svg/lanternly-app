import { prisma } from '../db.js';
import { config } from '../config.js';
import type { ZApp } from './types.js';

export default async function health(app: ZApp) {
  app.get('/health', { schema: { tags: ['system'], summary: 'Liveness + DB check' } }, async (_req, reply) => {
    let db = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'error';
    }
    return reply.code(db === 'ok' ? 200 : 503).send({
      status: db === 'ok' ? 'ok' : 'degraded',
      db,
      time: new Date().toISOString(),
      version: '0.1.0',
      paymentDriver: config.paymentDriver,
      emailDriver: config.EMAIL_DRIVER,
      storageDriver: config.STORAGE_DRIVER,
    });
  });
  app.get('/api/health', { schema: { hide: true } }, async (_req, reply) => reply.redirect('/health'));
}
