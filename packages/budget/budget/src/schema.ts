import { z } from 'zod'

const id = z.string().min(1).max(256)
const count = z.number().int().nonnegative()

/** Strict immutable authorization identity, including its supported ledger version. */
export const budgetReferenceSchema = z.object({ id, version: z.literal('1'), digest: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()

/** Explicit request, Token and lifetime ceilings; null inherits without adding a local ceiling. */
export const budgetLimitsSchema = z.object({
  requests: count.nullable(), inputTokens: count.nullable(), outputTokens: count.nullable(),
  totalTokens: count.nullable(), wallTimeMs: count.nullable(),
}).strict()

/** Host-authorized scope creation input; creation time is stamped by the owning Provider. */
export const budgetScopeInputSchema = z.object({
  id, kind: z.enum(['session', 'goal', 'workflow']), subjectId: id, parentId: id.nullable(),
  limits: budgetLimitsSchema, onExhausted: z.enum(['deny', 'pause', 'ask']),
}).strict()

/** Exact model request/attempt reservation, including a non-secret input identity and explicit Token ceilings. */
export const budgetRequestSchema = z.object({
  requestId: id, attemptId: id, inputDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  inputTokens: count, outputTokens: count,
  inputMeasurement: z.enum(['measured', 'estimated']).default('estimated'),
}).strict()

/** Actual provider-reported usage; missing fields are represented by an unknown settlement instead. */
export const budgetUsageSchema = z.object({ inputTokens: count, outputTokens: count }).strict()

/** Resource ceilings of one scope. */
export type BudgetLimits = z.infer<typeof budgetLimitsSchema>
/** Creation input accepted only through a Host-authorized Consumer. */
export type BudgetScopeInput = z.infer<typeof budgetScopeInputSchema>
/** One exact provider dispatch reservation. */
export type BudgetRequest = z.input<typeof budgetRequestSchema>
/** Actual Token counts owned by a provider attempt. */
export type BudgetUsage = z.infer<typeof budgetUsageSchema>
