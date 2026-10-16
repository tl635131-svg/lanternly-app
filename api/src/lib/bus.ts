import { EventEmitter } from 'node:events';

/** In-process realtime bus for SSE. Swap for Postgres LISTEN/NOTIFY or Redis when running multiple API instances. */
export type RealtimeType =
  | 'guest.created'
  | 'guest.updated'
  | 'guest.deleted'
  | 'stats.updated'
  | 'stage.changed'
  | 'revision.updated'
  | 'brief.updated'
  | 'invitation.updated';

export interface RealtimeMessage {
  type: RealtimeType;
  eventId: string;
  data: Record<string, unknown>;
  at: string;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function publish(eventId: string, type: RealtimeType, data: Record<string, unknown> = {}) {
  const msg: RealtimeMessage = { type, eventId, data, at: new Date().toISOString() };
  emitter.emit(`event:${eventId}`, msg);
}

export function subscribe(eventId: string, fn: (m: RealtimeMessage) => void): () => void {
  emitter.on(`event:${eventId}`, fn);
  return () => emitter.off(`event:${eventId}`, fn);
}
