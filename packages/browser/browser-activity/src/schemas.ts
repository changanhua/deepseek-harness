import { z } from 'zod'

const uuid = z.uuid({ version: 'v4' })
const time = z.number().int().nonnegative()
const origin = z.url().refine((value) => {
  const parsed = new URL(value)
  return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin === value
})
const pageUrl = z.url().max(8192).refine((value) => {
  const parsed = new URL(value)
  return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
})

/** Explicit collection limits. No configuration means no collection. */
export const ActivitySettingsSchema = z.object({
  enabled: z.boolean(), sessionId: z.string().min(1).max(128), origins: z.array(origin).min(1).max(16),
  kinds: z.array(z.enum(['visit', 'dwell', 'dom-change'])).min(1).max(3),
  minIntervalMs: z.number().int().min(1000).max(60000), retentionDays: z.number().int().min(1).max(30),
  maxEvents: z.number().int().min(10).max(2000), maxTextChars: z.number().int().min(0).max(4000),
}).strict()
export const ActivityPolicySchema = ActivitySettingsSchema.extend({ revision: uuid, grantEpoch: z.number().int().positive() }).strict()
export const ConfigureActivitySchema = z.object({
  requestId: uuid, expectedRevision: uuid.nullable(), settings: ActivitySettingsSchema,
}).strict()
export const ActivityQuerySchema = z.object({
  sessionId: z.string().min(1).max(128).optional(), query: z.string().max(256).optional(),
  since: time.optional(), limit: z.number().int().min(1).max(100).default(50),
}).strict()

/** An extension-observed fact, never a model instruction or an inferred browsing intention. */
export const ActivityEventSchema = z.object({
  id: uuid, kind: z.enum(['visit', 'dwell', 'dom-change']), at: time,
  tabId: z.number().int().nonnegative(), documentId: z.string().max(128).optional(),
  url: pageUrl, title: z.string().max(256), durationMs: z.number().int().min(0).max(60000).optional(),
  text: z.string().max(4000).optional(),
}).strict()
export const ActivityBatchSchema = z.object({
  id: uuid, revision: uuid, sequence: z.number().int().positive(), events: z.array(ActivityEventSchema).min(1).max(32),
}).strict()
export const ActivityRecordSchema = z.object({
  installationId: uuid, policy: ActivityPolicySchema, sequence: z.number().int().nonnegative(),
  configuration: z.object({ id: uuid, digest: z.string().regex(/^[a-f0-9]{64}$/u) }).strict().nullable(),
  lastBatch: z.object({ id: uuid, digest: z.string().regex(/^[a-f0-9]{64}$/u),
    accepted: z.number().int().nonnegative() }).strict().nullable(),
  events: z.array(ActivityEventSchema.extend({ sessionId: z.string().min(1).max(128), receivedAt: time,
    grantEpoch: z.number().int().positive() }).strict()).max(2000),
}).strict()
