import { prisma } from './db.js';
import { startWorkerLoop } from './services/jobs/worker.js';

// Standalone worker process (use when RUN_WORKER_IN_PROCESS=false, e.g. in production).
const stop = startWorkerLoop((m) => console.log(`[worker] ${m}`));
console.log('[worker] started');
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    stop();
    await prisma.$disconnect();
    process.exit(0);
  });
}
