import type { ZApp } from './types.js';
import health from './health.js';
import publicRoutes from './public.js';
import checkout from './checkout.js';
import webhooks from './webhooks.js';
import auth from './auth.js';
import events from './events.js';
import brief from './brief.js';
import revisions from './revisions.js';
import invitation from './invitation.js';
import guests from './guests.js';
import invitees from './invitees.js';
import campaigns from './campaigns.js';
import seating from './seating.js';
import publicInvitations from './public-invitations.js';
import files from './files.js';
import admin from './admin.js';
import dev from './dev.js';
import { config } from '../config.js';

export async function registerRoutes(app: any) {
  const a = app as ZApp;
  await a.register(health);
  await a.register(publicRoutes);
  await a.register(checkout);
  await a.register(webhooks);
  await a.register(auth);
  await a.register(events);
  await a.register(brief);
  await a.register(revisions);
  await a.register(invitation);
  await a.register(guests);
  await a.register(invitees);
  await a.register(campaigns);
  await a.register(seating);
  await a.register(publicInvitations);
  await a.register(files);
  await a.register(admin);
  // Dev helpers: off in production (enforced in config), and admin-only where they expose data or run jobs.
  // Full dev helpers only outside production; a production demo deploy with mock payments gets just the mock checkout page.
  if (config.devRoutes) await a.register(dev, { mockCheckoutOnly: false });
  else if (config.mockCheckoutRoutes) await a.register(dev, { mockCheckoutOnly: true });
}
