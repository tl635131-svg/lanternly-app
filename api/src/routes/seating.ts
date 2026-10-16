import { z } from 'zod';
import { requireEventAccess } from '../lib/auth.js';
import { autoArrange, getSeating, putSeating, SeatingPutInput } from '../services/seating.js';
import { EventParams, type ZApp } from './types.js';

export default async function seating(app: ZApp) {
  app.get('/api/events/:id/seating', { schema: { tags: ['seating'], summary: 'Tables, floor layout, assignments and confirmed parties', params: EventParams } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'read');
    return getSeating(event.id);
  });

  app.put('/api/events/:id/seating', { bodyLimit: 2 * 1024 * 1024, schema: { tags: ['seating'], summary: 'Full replace with optimistic version check (409 VERSION_CONFLICT)', params: EventParams, body: SeatingPutInput } }, async (req) => {
    const { event } = await requireEventAccess(req, req.params.id, 'write');
    return putSeating(event.id, req.body);
  });

  app.post(
    '/api/events/:id/seating/auto-arrange',
    { schema: { tags: ['seating'], summary: 'Propose (or apply) seats for unseated guests', params: EventParams, body: z.object({ keepPartiesTogether: z.boolean().default(true), apply: z.boolean().default(false) }) } },
    async (req) => {
      const { event } = await requireEventAccess(req, req.params.id, req.body.apply ? 'write' : 'read');
      const proposal = await autoArrange(event.id, { keepPartiesTogether: req.body.keepPartiesTogether });
      if (!req.body.apply) return { applied: false, ...proposal };
      const current = await getSeating(event.id);
      const saved = await putSeating(event.id, {
        version: current.version,
        layout: current.layout as any,
        tables: current.tables.map((t) => ({ id: t.id, label: t.label, shape: t.shape, seats: t.seats, note: t.note, x: t.x, y: t.y, rotation: t.rotation })),
        assignments: proposal.assignments,
      });
      return { applied: true, unseated: proposal.unseated, seating: saved };
    },
  );
}
