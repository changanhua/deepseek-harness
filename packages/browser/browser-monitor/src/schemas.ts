import { z } from 'zod'

const timestamp = z.number().int().nonnegative()
const uuid = z.uuid({ version: 'v4' })
const url = z.url().max(8192).refine((value) => {
  const parsed = new URL(value)
  return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
})

/** A caller-selected change condition; the first valid sample establishes its baseline. */
export const MonitorMatchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('changed') }).strict(),
  z.object({ kind: z.enum(['appears', 'disappears']), text: z.string().min(1).max(1024) }).strict(),
])

/** Null interval means one finite background check; a recurring plan coalesces or skips overdue periods. */
export const CreateMonitorSchema = z.object({
  requestId: uuid, sessionId: z.string().min(1).max(128), installationId: uuid,
  title: z.string().trim().min(1).max(200), url, intervalMs: z.number().int().min(1000).max(86400000).nullable(),
  missedPolicy: z.enum(['latest', 'skip']), match: MonitorMatchSchema, firstDueAt: timestamp.optional(),
}).strict()

export const MonitorSampleSchema = z.object({
  digest: z.string().regex(/^[a-f0-9]{64}$/u), matched: z.boolean(), sampledAt: timestamp,
  page: z.object({ tabId: z.number().int().nonnegative(), frameId: z.number().int().nonnegative(),
    documentId: z.string().min(1).max(128), url }).strict(),
}).strict()

export const MonitorNoticeSchema = z.object({
  id: uuid, monitorId: uuid, sessionId: z.string().min(1).max(128), installationId: uuid,
  kind: z.enum(['changed', 'completed', 'failed', 'recovered']), title: z.string().max(200),
  message: z.string().max(1024), createdAt: timestamp, slot: timestamp,
}).strict()

export const MonitorFailureSchema = z.object({ code: z.string().min(1).max(128), message: z.string().max(1024), at: timestamp }).strict()

/** One atomic record owns plan, accepted sample, pending Queue admission and recoverable notification outbox. */
export const MonitorRecordSchema = z.object({
  id: uuid, createDigest: z.string().regex(/^[a-f0-9]{64}$/u), revision: uuid,
  sessionId: z.string().min(1).max(128), installationId: uuid, grantEpoch: z.number().int().positive(),
  title: z.string().max(200), url, intervalMs: z.number().int().min(1000).max(86400000).nullable(),
  missedPolicy: z.enum(['latest', 'skip']), match: MonitorMatchSchema,
  enabled: z.boolean(), createdAt: timestamp, anchorAt: timestamp, nextDue: timestamp,
  pending: z.object({ revision: uuid, slot: timestamp, workId: uuid.nullable(),
    recoveries: z.number().int().min(0).max(2) }).strict().nullable(),
  settlement: z.object({ revision: uuid, slot: timestamp, workId: uuid.nullable(),
    recoveries: z.number().int().min(0).max(2), failure: MonitorFailureSchema.nullable() }).strict().nullable(),
  lastCompletedSlot: timestamp.nullable(), lastSample: MonitorSampleSchema.nullable(), lastFailure: MonitorFailureSchema.nullable(),
  outbox: z.array(MonitorNoticeSchema).max(32),
}).strict()

/** Queue input addresses an already persisted due slot; it cannot supply an arbitrary browser action. */
export const MonitorCheckSchema = z.object({ monitorId: uuid, revision: uuid, slot: timestamp }).strict()
