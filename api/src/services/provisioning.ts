import type { PlanCode, ProductType, ServiceMode, User } from '@prisma/client';
import { config } from '../config.js';
import { prisma, type Tx } from '../db.js';
import { logActivity } from '../lib/activity.js';
import { issueToken, normalizeEmail, tokenActionUrl } from '../lib/auth.js';
import { defaultBriefSections } from '../lib/brief.js';
import { DEFAULT_RSVP_SETTINGS, EXTRA_BRIEF_SECTIONS } from '../lib/catalogue.js';
import { addMonths } from '../lib/format.js';
import { uniqueInvitationSlug } from '../lib/slug.js';
import { starterConfig, starterContent } from '../lib/theme-engine.js';
import { sendNow } from './messaging/index.js';

export interface ProvisionInput {
  email: string;
  name?: string | null;
  product: ProductType;
  planCode: PlanCode | null;
  serviceMode: ServiceMode;
  hostNames: Record<string, string>;
  eventDate: Date | null;
  timezone?: string;
  venueName?: string | null;
  venueAddress?: string | null;
  languages: string[];
  themeId?: string | null;
  sections: string[];
  customNames?: Record<string, string>;
  extras: string[];
  express?: boolean;
  maxRevisionRounds?: number;
  hasRsvp?: boolean;
  paid?: boolean;
  vision?: string | null;
}

export function eventTitle(product: ProductType, names: Record<string, string>) {
  if (product === 'birthday' || product === 'bridesmaid') return names.honoree || names.partner1 || 'Celebration';
  return [names.partner1, names.partner2].filter(Boolean).join(' & ') || 'Our celebration';
}

/** Create (or reuse) the host user, then the event, membership, brief (studio) and a draft invitation. */
export async function provisionEvent(tx: Tx, input: ProvisionInput) {
  const email = normalizeEmail(input.email);
  let user = await tx.user.findUnique({ where: { email } });
  const isNewUser = !user;
  if (!user) user = await tx.user.create({ data: { email, name: input.name ?? null, role: 'host' } });

  const title = eventTitle(input.product, input.hostNames);
  const languages = input.languages.length ? input.languages : ['en'];
  const event = await tx.event.create({
    data: {
      product: input.product,
      planCode: input.planCode,
      serviceMode: input.serviceMode,
      title,
      hostNames: input.hostNames,
      eventDate: input.eventDate,
      timezone: input.timezone ?? 'America/Toronto',
      venueName: input.venueName ?? null,
      venueAddress: input.venueAddress ?? null,
      primaryLanguage: languages[0]!,
      languages,
      express: input.express ?? false,
      maxRevisionRounds: input.maxRevisionRounds ?? 0,
      rsvpSettings: { ...DEFAULT_RSVP_SETTINGS },
      paidAt: input.paid ? new Date() : null,
      archiveAfter: input.eventDate ? addMonths(input.eventDate, config.ARCHIVE_AFTER_MONTHS) : null,
      adminNote: input.vision ? `Customer vision: ${input.vision}` : null,
    },
  });
  await tx.eventMember.create({ data: { eventId: event.id, userId: user.id, role: 'owner' } });

  if (input.serviceMode === 'studio') {
    const sections = defaultBriefSections(input.sections, input.extras, EXTRA_BRIEF_SECTIONS, input.hasRsvp ?? true);
    await tx.brief.create({ data: { eventId: event.id, sections, customBlockNames: input.customNames ?? {}, data: {} } });
  }

  const theme = input.themeId ? await tx.theme.findUnique({ where: { id: input.themeId } }) : null;
  const blocks = input.sections;
  const invitation = await tx.invitation.create({
    data: {
      eventId: event.id,
      kind: input.product,
      themeId: theme?.id ?? null,
      slug: await uniqueInvitationSlug(title, tx),
      status: 'draft',
      locale: languages[0]!,
      content: starterContent(event, blocks) as any,
      config: starterConfig(theme?.defaultConfig, blocks, input.product) as any,
    },
  });
  await logActivity({ eventId: event.id, actorType: 'system', action: 'event.created', data: { serviceMode: input.serviceMode, planCode: input.planCode } }, tx);
  return { user, event, invitation, isNewUser };
}

/** Email the host a one-time link: set-password for new accounts, sign-in link for existing ones. Never a password. */
export async function sendAccessEmail(user: User, opts: { template: 'order_confirmation' | 'set_password'; data?: Record<string, unknown>; eventId?: string | null }) {
  const needsPassword = !user.passwordHash;
  const raw = await issueToken({ purpose: needsPassword ? 'set_password' : 'login', email: user.email, userId: user.id });
  await sendNow({
    to: user.email,
    template: opts.template,
    data: { name: user.name, needsPassword, actionUrl: tokenActionUrl(raw), ...(opts.data ?? {}) },
    userId: user.id,
    eventId: opts.eventId ?? null,
  });
}

export const panelUrl = (eventId: string) => `${config.WEB_URL}/app/${eventId}`;
export const adminEventUrl = (eventId: string) => `${config.WEB_URL}/admin/events/${eventId}`;
export const inviteUrl = (slug: string, token?: string) => `${config.INVITE_BASE_URL}/${slug}${token ? `?g=${encodeURIComponent(token)}` : ''}`;

export async function studioPrismaUsers() {
  return prisma.user.findMany({ where: { role: 'admin', disabledAt: null }, select: { email: true } });
}
