import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { planningCommandSchema, planningDeltaOperationSchema, planningFocusSchema, planningProposedDeltaSchema, planningResourceLinkSchema,
  planningSubjectRefSchema, resourceRefSchema } from '@changanhua/dsh-planning'

const id = z.string().min(1).max(256)
const text = z.string().trim().max(8192)
const shortText = z.string().trim().max(2048)
const point = z.strictObject({ x: z.number().min(0).max(20000), y: z.number().min(0).max(20000) })
/** Validates manual or model-result provenance and bounded note coordinates. */
export const explorationNoteSchema = z.strictObject({
  id, title: shortText, body: text.optional(), source: z.literal('manual').optional(),
  sourceResultId: id.optional(), sourceResultVersion: z.number().int().positive().optional(),
  createdAt: z.iso.datetime(), position: point,
}).refine(note => note.source === 'manual'
  ? note.sourceResultId === undefined && note.sourceResultVersion === undefined
  : note.sourceResultId !== undefined && note.sourceResultVersion !== undefined, {
  message: 'Manual notes must not claim a model result; model notes require exact result provenance',
})
/** Persisted design rationale with exact run, result and Planning provenance. */
export const designContextSchema = z.strictObject({
  id, title: shortText, body: text, sourceRunId: id, sourceSessionId: id, sourceResultId: id,
  sourceResultVersion: z.number().int().positive(), caseVersionAtCreation: z.number().int().nonnegative(),
  planningRevisionAtCreation: id, createdAt: z.iso.datetime(),
})
/** Bounds each independent model output and validates proposed Planning operations. */
export const thinkingResultDraftSchema = z.strictObject({
  summary: text, findings: z.array(text).max(32), openQuestions: z.array(text).max(32),
  explorationNotes: z.array(z.strictObject({ title: shortText, body: text.optional() })).max(32).optional(),
  designContext: z.strictObject({ title: shortText, body: text }).optional(),
  planningDelta: z.strictObject({ operations: z.array(planningDeltaOperationSchema).min(1).max(100),
    rationale: text.optional() }).optional(),
})
/** Versioned draft with identifiers of explicitly applied products. */
export const thinkingResultSchema = z.strictObject({
  id, version: z.number().int().positive(), createdAt: z.iso.datetime(), draft: thinkingResultDraftSchema,
  applied: z.strictObject({ explorationNoteIds: z.array(id).max(32), designContextId: id.optional(), planningProposalId: id.optional() }),
})
/** Retained exact Planning commands and their recovery outcomes. */
export const thinkingSubmissionSchema = z.strictObject({
  resultId: id, resultVersion: z.number().int().positive(), proposalId: id,
  attempts: z.array(z.strictObject({ command: planningCommandSchema, status: z.enum(['prepared', 'conflict', 'committed']),
    receipt: z.object({
      boardVersion: z.number().int().nonnegative(), itemId: id.optional(), revisionId: id.optional(), reviewId: id.optional(),
      proposalId: id.optional(), proposalVersion: z.number().int().positive().optional(),
    }).optional() })).max(16),
})
/** Validates run identity, startup phase, result history and Proposal attempts. */
export const thinkingRunSchema = z.strictObject({
  id, version: z.number().int().nonnegative(), sessionId: id, presetId: z.literal('thinking-desk'), question: text,
  createdAt: z.iso.datetime(),
  subject: planningSubjectRefSchema, planningRevisionAtStart: id, caseResource: resourceRefSchema,
  caseVersionAtStart: z.number().int().nonnegative(), caseBaseRevision: id,
  context: z.unknown(), reviewSnapshot: z.strictObject({ planRevision: id, focuses: z.array(planningFocusSchema),
    resourceLinks: z.array(planningResourceLinkSchema) }),
  startup: z.strictObject({ phase: z.enum(['prepared', 'session-created', 'planning-bound', 'prompt-accepted', 'blocked']),
    bindRequestId: id, promptRequestId: id, promptText: text, bindCommand: planningCommandSchema,
    blockedReason: shortText.optional() }),
  results: z.array(thinkingResultSchema).max(64), proposalSubmissions: z.array(thinkingSubmissionSchema).max(64),
})
/** Bounded run and design-context history stored with an exploration. */
export const thinkingStateSchema = z.strictObject({ runs: z.array(thinkingRunSchema).max(100),
  designContexts: z.array(designContextSchema).max(64) })

/** UTC timestamp used when the exploration owner commits a new fact.
 * @returns Current UTC time as an ISO timestamp.
 */
export const now = (): string => new Date().toISOString()
/** Allocate an opaque identity for a new immutable Thinking result.
 * @returns Fresh opaque identifier.
 */
export const resultId = (): string => `thinking-result-${randomUUID()}`
/** Allocate an opaque identity for a new canvas note.
 * @returns Fresh opaque identifier.
 */
export const noteId = (): string => `thinking-note-${randomUUID()}`
/** Allocate an opaque identity for human-saved design rationale.
 * @returns Fresh opaque identifier.
 */
export const contextId = (): string => `thinking-context-${randomUUID()}`
/** Allocate a stable Proposal identity before the first cross-owner write.
 * @returns Fresh opaque identifier.
 */
export const proposalId = (): string => `thinking-proposal-${randomUUID()}`
/** Validate and detach a bounded draft; malformed model output throws.
 * @param value - Untrusted input to validate.
 * @returns Schema-validated detached value.
 */
export const parseDraft = (value: unknown): z.infer<typeof thinkingResultDraftSchema> => thinkingResultDraftSchema.parse(value)
/** Validate a canonical Planning delta without executing it.
 * @param value - Untrusted input to validate.
 * @returns Schema-validated detached value.
 */
export const parseDelta = (value: unknown): z.infer<typeof planningProposedDeltaSchema> => planningProposedDeltaSchema.parse(value)
