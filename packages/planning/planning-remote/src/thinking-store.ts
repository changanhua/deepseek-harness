import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { planningCommandSchema, planningDeltaOperationSchema, planningFocusSchema, planningProposedDeltaSchema, planningResourceLinkSchema,
  planningSubjectRefSchema, resourceRefSchema } from '@changanhua/dsh-planning'

const id = z.string().min(1).max(256)
const text = z.string().trim().max(8192)
const shortText = z.string().trim().max(2048)
const point = z.strictObject({ x: z.number().min(0).max(20000), y: z.number().min(0).max(20000) })
export const explorationNoteSchema = z.strictObject({
  id, title: shortText, body: text.optional(), source: z.literal('manual').optional(),
  sourceResultId: id.optional(), sourceResultVersion: z.number().int().positive().optional(),
  createdAt: z.iso.datetime(), position: point,
}).refine(note => note.source === 'manual'
  ? note.sourceResultId === undefined && note.sourceResultVersion === undefined
  : note.sourceResultId !== undefined && note.sourceResultVersion !== undefined, {
  message: 'Manual notes must not claim a model result; model notes require exact result provenance',
})
export const designContextSchema = z.strictObject({
  id, title: shortText, body: text, sourceRunId: id, sourceSessionId: id, sourceResultId: id,
  sourceResultVersion: z.number().int().positive(), caseVersionAtCreation: z.number().int().nonnegative(),
  planningRevisionAtCreation: id, createdAt: z.iso.datetime(),
})
export const thinkingResultDraftSchema = z.strictObject({
  summary: text, findings: z.array(text).max(32), openQuestions: z.array(text).max(32),
  explorationNotes: z.array(z.strictObject({ title: shortText, body: text.optional() })).max(32).optional(),
  designContext: z.strictObject({ title: shortText, body: text }).optional(),
  planningDelta: z.strictObject({ operations: z.array(planningDeltaOperationSchema).min(1).max(100),
    rationale: text.optional() }).optional(),
})
export const thinkingResultSchema = z.strictObject({
  id, version: z.number().int().positive(), createdAt: z.iso.datetime(), draft: thinkingResultDraftSchema,
  applied: z.strictObject({ explorationNoteIds: z.array(id).max(32), designContextId: id.optional(), planningProposalId: id.optional() }),
})
export const thinkingSubmissionSchema = z.strictObject({
  resultId: id, resultVersion: z.number().int().positive(), proposalId: id,
  attempts: z.array(z.strictObject({ command: planningCommandSchema, status: z.enum(['prepared', 'conflict', 'committed']),
    receipt: z.object({
      boardVersion: z.number().int().nonnegative(), itemId: id.optional(), revisionId: id.optional(), reviewId: id.optional(),
      proposalId: id.optional(), proposalVersion: z.number().int().positive().optional(),
    }).optional() })).max(16),
})
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
export const thinkingStateSchema = z.strictObject({ runs: z.array(thinkingRunSchema).max(100),
  designContexts: z.array(designContextSchema).max(64) })

export const now = () => new Date().toISOString()
export const resultId = () => `thinking-result-${randomUUID()}`
export const noteId = () => `thinking-note-${randomUUID()}`
export const contextId = () => `thinking-context-${randomUUID()}`
export const proposalId = () => `thinking-proposal-${randomUUID()}`
export const parseDraft = (value: unknown) => thinkingResultDraftSchema.parse(value)
export const parseDelta = (value: unknown) => planningProposedDeltaSchema.parse(value)
