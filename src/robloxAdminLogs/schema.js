// Roblox admin logs → Discord: the request and event schema (strict; anything unexpected is refused).
//
// Request body: { v: 1, sentAt: <unix seconds>, events: [ <event>, ... ] }   (1-25 events)
// Event: built by ServerScriptService.AdminAudit.DiscordAuditLogger in the Roblox game.

import { z } from 'zod';

export const CATEGORIES = ['Moderation', 'AntiCheat', 'AdminCommand', 'AdminAccess', 'Audit'];
export const OUTCOMES = ['Success', 'Failed', 'Denied', 'Partial', 'Warning', 'Observed', 'Info'];

const unixSeconds = z.number().int().min(1_500_000_000).max(4_000_000_000);
const shortText = (max) => z.string().max(max);

const person = z
  .object({
    userId: z.number().int().min(0).max(9_007_199_254_740_991),
    username: shortText(40).optional(),
    displayName: shortText(40).optional(),
    role: shortText(30).optional(),
  })
  .strict();

const server = z
  .object({
    placeId: z.number().int().min(0).max(9_007_199_254_740_991),
    universeId: z.number().int().min(0).max(9_007_199_254_740_991),
    jobId: z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/),
    placeVersion: z.number().int().min(0).max(1_000_000_000).optional(),
    privateServer: z.boolean().optional(),
    studio: z.boolean().optional(),
  })
  .strict();

const detailValue = z.union([shortText(300), z.number().finite(), z.boolean()]);

const details = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/), detailValue)
  .refine((value) => Object.keys(value).length <= 20, { message: 'at most 20 details' });

const occurrences = z
  .object({
    count: z.number().int().min(1).max(1_000_000),
    repeats: z.number().int().min(0).max(1_000_000),
    firstAt: unixSeconds,
    lastAt: unixSeconds,
  })
  .strict();

export const eventSchema = z
  .object({
    v: z.literal(1),
    eventId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
    category: z.enum(CATEGORIES),
    action: z.string().min(1).max(60),
    outcome: z.enum(OUTCOMES),
    timestamp: unixSeconds,
    actor: person.optional(),
    target: person.optional(),
    reason: shortText(300).optional(),
    details: details.optional(),
    auditId: shortText(80).optional(),
    server,
    occurrences: occurrences.optional(),
  })
  .strict();

// The envelope is checked first; each event is then checked on its own, so one bad event never
// costs the good ones in the same request.
export const envelopeSchema = z
  .object({
    v: z.literal(1),
    sentAt: unixSeconds,
    events: z.array(z.unknown()).min(1).max(25),
  })
  .strict();

export function describeZodError(error) {
  const issue = error?.issues?.[0];
  if (!issue) {
    return 'invalid';
  }
  const where = issue.path?.length ? issue.path.join('.') : 'body';
  return `${where}: ${issue.message}`.slice(0, 160);
}
