import { z } from 'zod'
import { artifactSchema, commitSchema, nonBlank, referenceSchema, uniqueBy } from './identity.ts'

export const executionRouteSchema = z.object({
  id: nonBlank,
  provider: nonBlank,
  model: nonBlank,
  preset: artifactSchema,
  parameters: z.record(z.string(), z.json()),
}).strict()

/**
 * Versioned evaluation intent. References and digests constrain a later execution;
 * parsing a Plan does not approve entrypoints, credentials, budget, or verifier policy.
 * Identity is the id/version plus evalContractDigest of the parsed document.
 */
export const evalPlanSchema = z.object({
  kind: z.literal('eval-plan'),
  schemaVersion: z.literal(1),
  id: nonBlank,
  version: nonBlank,
  suiteRef: referenceSchema,
  repository: z.object({ requestedRevision: nonBlank, expectedCommit: commitSchema }).strict(),
  routes: z.array(executionRouteSchema).min(1).superRefine((items, ctx) => { uniqueBy(items, item => item.id, ctx) }),
  repeatPolicy: z.object({
    count: z.number().int().positive(),
    seed: z.number().int().nullable(),
    order: z.literal('route-case-repeat'),
  }).strict(),
  baselineRef: referenceSchema.nullable(),
  workspacePolicy: z.literal('per-cell'),
  allowedEntrypoints: z.array(z.enum(['web', 'cli', 'ci'])).min(1)
    .superRefine((items, ctx) => { uniqueBy(items, item => item, ctx) })
    .transform(items => items.sort()),
  credentialAuthorizationRef: referenceSchema.nullable(),
  budget: z.discriminatedUnion('required', [
    z.object({ required: z.literal(true), authorizationRef: referenceSchema }).strict(),
    z.object({ required: z.literal(false), authorizationRef: z.null() }).strict(),
  ]),
  verifierPlanRef: referenceSchema,
}).strict()

/** Validated intent; it is not a Host authorization or an observed execution. */
export type EvalPlan = z.infer<typeof evalPlanSchema>

/**
 * Validate versioned intent without resolving a repository or approving its policy.
 * @param input Untrusted Plan document.
 * @returns Parsed intent with normalized entrypoint set and preserved route order.
 * @throws {z.ZodError} On unknown fields/version, duplicate identities or malformed references.
 */
export function parseEvalPlan(input: unknown): EvalPlan {
  return evalPlanSchema.parse(input)
}
