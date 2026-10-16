import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

/**
 * Shared RSVP definitions (N-40), used by the stats and the "not responded" campaign segment:
 * - invited  = guest-list entries (invitees, not deleted)
 * - replied  = invited guests with a response (a live RSVP with attendance yes/no)
 * - waiting  = invited guests with no response (invited − replied)
 * - general-link replies = RSVPs from the general link (no invitee) — reported separately, never in the rate.
 */
export const RESPONDED_GUEST: Prisma.GuestWhereInput = { deletedAt: null, attendance: { in: ['yes', 'no'] } };
export const inviteeRepliedWhere: Prisma.InviteeWhereInput = { guests: { some: RESPONDED_GUEST } };
export const inviteeWaitingWhere: Prisma.InviteeWhereInput = { guests: { none: RESPONDED_GUEST } };

export async function eventStats(eventId: string, invitesSentManual: number) {
  const invitees = { eventId, deletedAt: null } satisfies Prisma.InviteeWhereInput;
  const [inviteesSent, invited, replied, generalLinkReplies, groups, attendees] = await Promise.all([
    prisma.invitee.count({ where: { ...invitees, status: { not: 'not_sent' } } }),
    prisma.invitee.count({ where: invitees }),
    prisma.invitee.count({ where: { ...invitees, ...inviteeRepliedWhere } }),
    prisma.guest.count({ where: { eventId, inviteeId: null, source: 'rsvp_form', ...RESPONDED_GUEST } }),
    prisma.guest.groupBy({ by: ['attendance'], where: { eventId, deletedAt: null }, _count: { _all: true } }),
    prisma.guest.aggregate({ where: { eventId, deletedAt: null, attendance: 'yes' }, _sum: { partySize: true } }),
  ]);
  const count = (a: string) => groups.find((g) => g.attendance === a)?._count._all ?? 0;
  const confirmed = count('yes');
  const declined = count('no');
  const pending = count('pending');
  const responses = confirmed + declined;
  const invitesSent = inviteesSent > 0 ? inviteesSent : invitesSentManual;
  const totalAttendees = attendees._sum.partySize ?? 0;
  const waiting = invited - replied;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    invitesSent,
    invitesSentSource: inviteesSent > 0 ? 'invitees' : 'manual',
    /** Guest-list entries (the reply-rate denominator). */
    invited,
    /** Invited guests with an RSVP response. */
    replied,
    /** Invited guests with no response (= invited − replied). */
    waiting,
    /** Same as `waiting` (kept for existing clients). */
    awaiting: waiting,
    /** General-link RSVPs (no guest-list entry); not part of responseRate. */
    generalLinkReplies,
    /** All RSVP responses (yes + no), invited and general link. */
    responses,
    confirmed,
    declined,
    pending,
    totalAttendees,
    /** replied / invited (null without a guest list). */
    responseRate: invited > 0 ? round(replied / invited) : null,
    confirmedRate: responses > 0 ? round(confirmed / responses) : null,
    averageParty: confirmed > 0 ? round(totalAttendees / confirmed) : null,
    responsesExceedInvites: invitesSent > 0 && responses > invitesSent,
  };
}
