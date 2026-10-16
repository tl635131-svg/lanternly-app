import { z } from 'zod';
import type { Attendance, Prisma } from '@prisma/client';
import { prisma, type Tx } from '../db.js';
import { DIETARY_TAGS, type RsvpSettings } from '../lib/catalogue.js';
import { validation } from '../lib/errors.js';

const str = (max: number) => z.string().trim().max(max);
const optStr = (max: number) => str(max).nullish().transform((v) => (v ? v : null));

export const CompanionInput = z.object({
  type: z.enum(['adult', 'child']).default('adult'),
  fullName: str(100).min(1, 'Companion name is required'),
  meal: optStr(40),
  dietary: optStr(300),
});

const base = {
  fullName: str(100).min(1, 'Name is required'),
  email: z.string().trim().toLowerCase().email('Invalid email').max(255).nullish().or(z.literal('').transform(() => null)),
  primaryMeal: optStr(40),
  primaryDietary: optStr(300),
  dietaryTags: z.array(z.enum(DIETARY_TAGS)).max(DIETARY_TAGS.length).default([]),
  companions: z.array(CompanionInput).max(19).default([]),
  extraEvents: z.record(z.string().max(40), z.enum(['yes', 'no'])).default({}),
  answers: z.record(z.string().max(40), z.union([str(1000), z.boolean()])).default({}),
  message: optStr(1000),
  language: optStr(20),
};

export const RsvpInput = z.object({
  ...base,
  g: z.string().max(100).optional(),
  attendance: z.enum(['yes', 'no']),
  website: z.string().max(200).optional(), // honeypot — must stay empty
  captchaToken: z.string().max(4000).optional(),
});
export type RsvpInputT = z.infer<typeof RsvpInput>;

export const ManualGuestInput = z.object({
  ...base,
  phone: optStr(40),
  attendance: z.enum(['yes', 'no', 'pending']).default('pending'),
  notes: optStr(2000),
  inviteeId: z.string().uuid().nullish(),
});
export type ManualGuestInputT = z.infer<typeof ManualGuestInput>;

/** Validate an RSVP against the event's RSVP settings (server truth). Returns normalised data. */
export function applyRsvpRules(input: RsvpInputT, settings: RsvpSettings, opts: { maxPartySize?: number | null }) {
  const fields: Record<string, string> = {};
  // Only people who are coming need to leave an email (confirmation + updates). A decline needs just a name.
  if (settings.requireEmail && input.attendance === 'yes' && !input.email) fields.email = 'Email is required';
  let companions = input.companions;
  let primaryMeal = input.primaryMeal;
  let dietaryTags = input.dietaryTags;
  let primaryDietary = input.primaryDietary;
  let extraEvents = input.extraEvents;
  if (input.attendance === 'no') {
    companions = [];
    primaryMeal = null;
    dietaryTags = [];
    primaryDietary = null;
    extraEvents = {};
  } else {
    const meals = settings.mealOptions;
    if (meals.length > 0) {
      if (!primaryMeal) fields.primaryMeal = 'Please choose a meal';
      else if (!meals.includes(primaryMeal)) fields.primaryMeal = 'Unknown meal option';
    }
    const maxCompanions = opts.maxPartySize != null ? Math.max(opts.maxPartySize - 1, 0) : settings.maxCompanions;
    if (companions.length > maxCompanions) fields.companions = `You can add up to ${maxCompanions} companion(s)`;
    companions.forEach((c, i) => {
      if (meals.length > 0 && !c.meal) fields[`companions.${i}.meal`] = 'Meal is required';
      else if (c.meal && meals.length > 0 && !meals.includes(c.meal)) fields[`companions.${i}.meal`] = 'Unknown meal option';
      if (c.type === 'child' && !settings.allowChildren) fields[`companions.${i}.type`] = 'Children are not included in this invitation';
    });
    for (const key of Object.keys(extraEvents)) if (!settings.extraEvents.includes(key)) delete extraEvents[key];
  }
  const answers: Record<string, string | boolean> = {};
  for (const q of settings.customQuestions) {
    const v = input.answers[q.id];
    if (v === undefined || v === '') {
      if (q.required && input.attendance === 'yes') fields[`answers.${q.id}`] = 'This answer is required';
      continue;
    }
    answers[q.id] = v;
  }
  if (Object.keys(fields).length) throw validation('Please check the highlighted fields.', fields);
  return { companions, primaryMeal, dietaryTags, primaryDietary, extraEvents, answers, partySize: 1 + companions.length };
}

export function companionCreates(companions: z.infer<typeof CompanionInput>[]) {
  return companions.map((c, i) => ({ type: c.type, fullName: c.fullName, meal: c.meal, dietary: c.dietary, sort: i }));
}

/** When a guest is no longer attending (declined/deleted), free their seats. */
export async function unseatIfNotAttending(guestId: string, attendance: Attendance | null, db: Tx | typeof prisma = prisma) {
  if (attendance === 'yes') return;
  const companionIds = (await db.guestCompanion.findMany({ where: { guestId }, select: { id: true } })).map((c) => c.id);
  await db.seatAssignment.deleteMany({ where: { OR: [{ guestId }, { companionId: { in: companionIds } }] } });
}

export const guestInclude = { companions: true, invitee: true } satisfies Prisma.GuestInclude;
