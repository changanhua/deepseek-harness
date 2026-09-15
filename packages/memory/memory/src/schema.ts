/** Project-memory wire values and durable record validation. @module @changanhua/dsh-memory/schema */
import { z } from 'zod'

const identity = z.string().trim().min(1).max(256)
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
/** UTC ISO timestamp shared by durable records and human review admission. */
export const memoryTimestampSchema = z.iso.datetime()
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const shortText = z.string().trim().min(1).max(200)
const statement = z.string().trim().min(1).refine(value => Array.from(value).length <= 2000, 'statement exceeds 2000 characters')
const relativePath = z.string().min(1).max(1024).transform(value => value.replaceAll('\\', '/')).refine(value =>
  !value.startsWith('/') && !value.includes(':') && !value.includes('\0')
  && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'source must be a project-relative file')
const fileLocator = z.strictObject({ kind: z.literal('file'), path: relativePath, line: positive.optional() })
const eventLocator = z.strictObject({ kind: z.literal('session-event'), sessionId: identity, seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })

/** A caller supplies locators, never hashes or proof of source validity. */
export const memorySourceInputSchema = z.discriminatedUnion('kind', [fileLocator, eventLocator])
/** Providers bind source identity to observed bytes or durable event text. */
export const memorySourceSchema = z.discriminatedUnion('kind', [
  fileLocator.extend({ sha256: digest }),
  eventLocator.extend({ sha256: digest, eventType: identity }),
])
/** The four supported forms of one reusable project claim. */
export const memoryKindSchema = z.enum(['fact', 'decision', 'preference', 'method'])

/** Untrusted input for creating a candidate or amending one memory. */
export const memoryProposalSchema = z.strictObject({
  topicKey: z.string().trim().min(1).max(128),
  kind: memoryKindSchema,
  title: shortText,
  statement,
  tags: z.array(shortText).max(20).default([]),
  conditions: z.string().trim().max(2000).default(''),
  sources: z.array(memorySourceInputSchema).min(1).max(5),
  idempotencyKey: identity,
  memoryId: identity.optional(),
  expectedVersion: positive.optional(),
}).refine(value => (value.memoryId === undefined) === (value.expectedVersion === undefined), 'amendment requires memoryId and expectedVersion together')

/** Immutable claim content; acceptance review dates belong to decisions. */
export const memoryRevisionSchema = z.strictObject({
  revision: positive,
  kind: memoryKindSchema,
  title: shortText,
  statement,
  tags: z.array(shortText).max(20),
  conditions: z.string().max(2000),
  sources: z.array(memorySourceSchema).min(1).max(5),
  createdBy: identity,
  createdAt: memoryTimestampSchema,
})

/** A human command's immutable decision on an exact content revision. */
export const memoryDecisionSchema = z.strictObject({
  action: z.enum(['accept', 'reject', 'retire']),
  revision: positive,
  commandId: identity,
  sessionId: identity,
  at: memoryTimestampSchema,
  reviewAfter: memoryTimestampSchema.optional(),
}).refine(value => (value.action === 'accept') === (value.reviewAfter !== undefined), 'only acceptance sets a review date')

/** Stable response retained for idempotent mutation retry. */
export const memoryMutationSchema = z.strictObject({ id: identity, recordVersion: positive, revision: positive })
/** Input identity and result commit together with the memory change. */
export const memoryReceiptSchema = z.strictObject({
  key: z.string().min(1).max(512),
  digest,
  operation: z.enum(['propose', 'accept', 'reject', 'retire']),
  result: memoryMutationSchema,
  at: memoryTimestampSchema,
})

/** One record is the atomic persistence unit for a memory and its history. */
export const memoryRecordSchema = z.strictObject({
  id: identity,
  workspaceId: identity,
  recordVersion: positive,
  topicKey: z.string().trim().min(1).max(128),
  revisions: z.array(memoryRevisionSchema).min(1).max(50),
  activeRevision: positive.nullable(),
  candidateRevision: positive.nullable(),
  decisions: z.array(memoryDecisionSchema).max(199),
  receipts: z.array(memoryReceiptSchema).min(1).max(200),
}).superRefine((record, ctx) => {
  const reject = (message: string): void => { ctx.addIssue({ code: 'custom', message }) }
  if (record.recordVersion !== record.receipts.length) reject('record version must equal committed receipt count')
  if (record.revisions.some((revision, index) => revision.revision !== index + 1)) reject('revision identities must be contiguous')
  const keys = new Set<string>()
  const commands = new Set<string>()
  let active: number | null = null
  let candidate: number | null = null
  let revisionCount = 0
  let decisionIndex = 0
  for (const [index, receipt] of record.receipts.entries()) {
    if (keys.has(receipt.key)) reject('duplicate receipt key')
    keys.add(receipt.key)
    if (receipt.result.id !== record.id || receipt.result.recordVersion !== index + 1) reject('receipt identity does not match its record')
    const revision = receipt.result.revision
    if (revision > record.revisions.length) reject('receipt references a missing revision')
    if (receipt.operation === 'propose') {
      if (candidate !== null || revision !== revisionCount + 1) reject('proposal must append one version without replacing a pending candidate')
      revisionCount++
      candidate = revision
      if (record.revisions[revision - 1]?.createdAt !== receipt.at) reject('proposal timestamp differs from its revision')
      continue
    }
    const decision = record.decisions[decisionIndex++]
    if (decision === undefined || decision.action !== receipt.operation || decision.revision !== revision || decision.at !== receipt.at) {
      reject('mutation has no matching human decision')
      continue
    }
    if (commands.has(decision.commandId)) reject('a human command cannot create multiple decisions')
    commands.add(decision.commandId)
    switch (decision.action) {
      case 'accept':
        if (revision !== candidate && revision !== active) reject('acceptance must target the candidate or current active version')
        if (decision.reviewAfter === undefined || Date.parse(decision.reviewAfter) <= Date.parse(decision.at)) reject('review date must follow acceptance')
        active = revision
        if (candidate === revision) candidate = null
        break
      case 'reject':
        if (revision !== candidate) reject('rejection must target a pending candidate')
        candidate = null
        break
      case 'retire':
        if (revision !== active) reject('retirement must target an active version')
        active = null
        break
    }
  }
  if (revisionCount !== record.revisions.length || decisionIndex !== record.decisions.length) reject('history has uncommitted versions or decisions')
  if (active !== record.activeRevision || candidate !== record.candidateRevision) reject('revision pointers differ from committed history')
})

/**
 * Serialize a strict JSON value with stable object order for input identity.
 * @param value - JSON data; undefined, non-finite numbers and object instances reject.
 * @returns canonical JSON retaining array order.
 */
export function canonicalMemoryJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${Array.from(value, canonicalMemoryJson).join(',')}]`
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalMemoryJson(record[key])}`).join(',')}}`
  }
  throw new TypeError('memory input must be strict JSON')
}
