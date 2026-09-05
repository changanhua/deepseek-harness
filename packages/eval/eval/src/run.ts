import { z } from 'zod'
import { evalRouteSchema } from './schema.ts'

const nonBlankString = z.string().min(1).refine(value => value.trim().length > 0, {
  message: 'must not be blank',
})
const sourceRevision = z.string().regex(/^[0-9a-f]{7,64}$/iu, 'sourceRevision must be a fixed hexadecimal revision')
const countOrUnknown = z.number().int().nonnegative().nullable()
const durationOrUnknown = z.number().nonnegative().nullable()

/** Runtime schema for per-case Provider usage, with explicit unknown buckets. */
export const evalUsageSchema = z.object({
  inputTokens: countOrUnknown,
  outputTokens: countOrUnknown,
  cacheReadTokens: countOrUnknown,
  cacheWriteTokens: countOrUnknown,
  retryTokens: countOrUnknown,
}).strict()

/** Runtime schema separating Agent execution and evaluator latency. */
export const evalLatencySchema = z.object({
  agentMs: durationOrUnknown,
  evaluatorMs: durationOrUnknown,
}).strict()

/** Runtime schema for the environment snapshot retained by one route run. */
export const evalEnvironmentSchema = z.object({
  os: nonBlankString,
  arch: nonBlankString,
  nodeVersion: nonBlankString,
}).strict()

/** Runtime schema for the Tool and Skill names visible to the tested Agent. */
export const evalVisibleSurfaceSchema = z.object({
  tools: z.array(nonBlankString),
  skills: z.array(nonBlankString),
}).strict()

/** The four score classes retained by deterministic evaluation reports. */
export const evalOutcomeSchema = z.enum([
  'passed',
  'failed',
  'invalid',
  'infrastructure-uncertain',
])

/** Runtime schema for one case result produced under one compared route. */
export const evalCaseResultSchema = z.object({
  caseId: nonBlankString,
  replayFixture: nonBlankString,
  fixtureId: nonBlankString,
  sessionId: nonBlankString.nullable(),
  outcome: evalOutcomeSchema,
  reasonCode: nonBlankString.optional(),
  usage: evalUsageSchema,
  latency: evalLatencySchema,
  evidenceRefs: z.array(nonBlankString),
}).strict()

/** Runtime schema for one route-specific suite run. */
export const evalRunSchema = z.object({
  schemaVersion: z.literal(1),
  suiteId: nonBlankString,
  suiteVersion: nonBlankString,
  sourceRevision,
  route: evalRouteSchema,
  environment: evalEnvironmentSchema,
  visibleSurface: evalVisibleSurfaceSchema,
  results: z.array(evalCaseResultSchema),
}).strict()

/** One deterministic evaluation score class. */
export type EvalOutcome = z.infer<typeof evalOutcomeSchema>
/** One validated case result. */
export type EvalCaseResult = z.infer<typeof evalCaseResultSchema>
/** One validated route-specific evaluation run. */
export type EvalRun = z.infer<typeof evalRunSchema>
/** Provider usage buckets for one case. */
export type EvalUsage = z.infer<typeof evalUsageSchema>
/** Agent and evaluator latency for one case. */
export type EvalLatency = z.infer<typeof evalLatencySchema>
/** Captured execution environment for one route run. */
export type EvalEnvironment = z.infer<typeof evalEnvironmentSchema>
/** Tool and Skill names visible to the tested Agent. */
export type EvalVisibleSurface = z.infer<typeof evalVisibleSurfaceSchema>

/**
 * Parse an untrusted route-specific run document.
 *
 * @param input Untrusted run data.
 * @returns The validated route-specific evaluation run.
 * @throws {z.ZodError} when the run is malformed or contains unknown fields.
 */
export function parseEvalRun(input: unknown): EvalRun {
  return evalRunSchema.parse(input)
}

/**
 * Fold case outcomes without converting incomplete or invalid evidence into a score.
 * Invalid evidence dominates infrastructure uncertainty, which dominates a known
 * failure. An empty input is infrastructure-uncertain because no score exists.
 *
 * @param outcomes Ordered or unordered case outcomes to fold.
 * @returns The conservative aggregate outcome.
 */
export function foldEvalOutcomes(outcomes: readonly EvalOutcome[]): EvalOutcome {
  if (outcomes.length === 0) return 'infrastructure-uncertain'
  if (outcomes.includes('invalid')) return 'invalid'
  if (outcomes.includes('infrastructure-uncertain')) return 'infrastructure-uncertain'
  if (outcomes.includes('failed')) return 'failed'
  return 'passed'
}
