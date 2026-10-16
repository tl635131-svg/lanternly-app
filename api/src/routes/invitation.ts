import { z } from 'zod';
import { requireEventAccess } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import {
  InvitationUpdateInput,
  assertAddonsPaid,
  setInvitationSlug,
  invitationForEvent,
  invitationFullDto,
  listVersions,
  discardDraft,
  publishInvitation,
  rollbackInvitation,
  rotatePreviewToken,
  unpublishInvitation,
  updateInvitation,
  linkState,
} from '../services/invitations.js';
import { SlugSchema } from '../lib/brief.js';
import { EventParams, rejectRemovedFields, type ZApp } from './types.js';

/** The deprecated `slug` in PUT was removed: the link has its own endpoint. */
const noSlug = rejectRemovedFields({ slug: 'The link is changed with PATCH /api/events/:id/invitation/slug.' });

/** Host access to the invitation. Self-serve hosts edit & publish; studio hosts view (and request revisions). */
export default async function invitation(app: ZApp) {
  async function editable(req: any, id: string) {
    const ctx = await requireEventAccess(req, id, 'write');
    if (ctx.event.serviceMode !== 'self_serve' && ctx.role !== 'studio') {
      throw new AppError(403, 'FORBIDDEN', 'Our studio designs this invitation. Use revisions to request changes.');
    }
    return ctx;
  }

  app.get('/api/events/:id/invitation', { schema: { tags: ['invitation'], params: EventParams } }, async (req) => {
    const { event, role } = await requireEventAccess(req, req.params.id, 'read');
    const inv = await invitationForEvent(event.id);
    // N-39: previousSlugs [{oldSlug, createdAt}] (newest first) + customLinkLocked, for owners/co-hosts (and studio), not viewers.
    const links = role === 'viewer' ? {} : await linkState(inv);
    return { ...invitationFullDto(inv), ...links, editable: event.serviceMode === 'self_serve', canPublish: event.serviceMode === 'self_serve' && !!event.paidAt };
  });

  app.put('/api/events/:id/invitation', { preValidation: noSlug, schema: { tags: ['invitation'], summary: 'Self-serve editor save. content/config/theme go to the draft; locale applies immediately. The link is changed with PATCH …/invitation/slug', params: EventParams, body: InvitationUpdateInput } }, async (req) => {
    const { user, role } = await editable(req, req.params.id);
    const inv = await invitationForEvent(req.params.id);
    return invitationFullDto(await updateInvitation(inv, req.body, { id: user.id, type: role === 'studio' ? 'admin' : 'host', req }));
  });

  app.patch(
    '/api/events/:id/invitation/slug',
    {
      schema: {
        tags: ['invitation'],
        summary: 'Custom link name (custom_link): change the invitation slug. Applies immediately; the old slug 301-redirects.' + ' 402 ADDON_PAYMENT_REQUIRED: details.missing[].qty = units still short (not the total needed).',
        params: EventParams,
        body: z.object({ slug: SlugSchema }).strict(),
      },
    },
    async (req) => {
      // Owner or co-host (self-serve and studio events), or studio staff/admin. Viewers get 403.
      const { user, role } = await requireEventAccess(req, req.params.id, 'write');
      const inv = await invitationForEvent(req.params.id);
      return setInvitationSlug(inv, req.body.slug, { id: user.id, type: role === 'studio' ? 'admin' : 'host', req });
    },
  );

  app.post('/api/events/:id/invitation/publish', { schema: { tags: ['invitation'], summary: 'Publish / Publish changes. Unpaid add-ons in use → 402 ADDON_PAYMENT_REQUIRED: details.missing[].qty = units still short (not the total needed).', params: EventParams } }, async (req) => {
    const { user, event, role } = await editable(req, req.params.id);
    const inv0 = await invitationForEvent(event.id);
    // Only the first publish of a self-serve event needs payment; "Publish changes" never does.
    if (!event.paidAt && inv0.publishedVersion == null) throw new AppError(402, 'PAYMENT_REQUIRED', 'Purchase the self-serve plan to publish your invitation.', undefined, { plan: 'diy', eventId: event.id });
    const inv = await invitationForEvent(event.id);
    // "Publish changes": every add-on the draft uses (own song, renamed link, languages over the cap) must be paid.
    if (event.serviceMode === 'self_serve' && role !== 'studio') await assertAddonsPaid(event, inv);
    return invitationFullDto(await publishInvitation(inv, { id: user.id, type: role === 'studio' ? 'admin' : 'host' }));
  });

  app.post('/api/events/:id/invitation/discard-draft', { schema: { tags: ['invitation'], summary: 'Reset the draft to the live version', params: EventParams } }, async (req) => {
    const { user, role } = await editable(req, req.params.id);
    const inv = await invitationForEvent(req.params.id);
    return invitationFullDto(await discardDraft(inv, { id: user.id, type: role === 'studio' ? 'admin' : 'host' }));
  });

  app.post('/api/events/:id/invitation/unpublish', { schema: { tags: ['invitation'], params: EventParams } }, async (req) => {
    const { user, role } = await editable(req, req.params.id);
    const inv = await invitationForEvent(req.params.id);
    return invitationFullDto(await unpublishInvitation(inv, { id: user.id, type: role === 'studio' ? 'admin' : 'host' }));
  });

  app.post('/api/events/:id/invitation/preview-token', { schema: { tags: ['invitation'], summary: 'Rotate the preview link', params: EventParams } }, async (req) => {
    await editable(req, req.params.id);
    const inv = await invitationForEvent(req.params.id);
    return invitationFullDto(await rotatePreviewToken(inv));
  });

  app.get('/api/events/:id/invitation/versions', { schema: { tags: ['invitation'], params: EventParams } }, async (req) => {
    await requireEventAccess(req, req.params.id, 'read');
    const inv = await invitationForEvent(req.params.id);
    return listVersions(inv.id);
  });

  app.post('/api/events/:id/invitation/rollback', { schema: { tags: ['invitation'], params: EventParams, body: z.object({ version: z.number().int().min(1) }) } }, async (req) => {
    const { user, role } = await editable(req, req.params.id);
    const inv = await invitationForEvent(req.params.id);
    return invitationFullDto(await rollbackInvitation(inv, req.body.version, { id: user.id, type: role === 'studio' ? 'admin' : 'host' }));
  });
}
