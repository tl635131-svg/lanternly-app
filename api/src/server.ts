import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { startWorkerLoop } from './services/jobs/worker.js';

const app = await buildApp();
let stopWorker: (() => void) | null = null;

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  if (config.mockProvidersInProd.length) {
    const bar = '!'.repeat(78);
    app.log.warn(`\n${bar}\n!! DEMO DEPLOY: production is running with MOCK providers (${config.mockProvidersInProd.join(', ')}).\n!! No real payments are taken and no real emails are sent (ALLOW_MOCK_PROVIDERS_IN_PRODUCTION=true).\n${bar}`);
  }
  app.log.info(`API ready on ${config.API_PUBLIC_URL} (docs: ${config.API_PUBLIC_URL}/docs) — payments=${config.paymentDriver}, email=${config.EMAIL_DRIVER}`);
  if (config.RUN_WORKER_IN_PROCESS) {
    stopWorker = startWorkerLoop((m) => app.log.warn(m));
    app.log.info('In-process job worker started');
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    stopWorker?.();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
