import { z } from 'zod'
import { artifactSchema, artifactSetSchema, commitSchema, digestSchema, nonBlank, referenceSchema } from './identity.ts'
import { executionRouteSchema } from './plan.ts'

const executionIdentitySchema = z.object({
  executionId: nonBlank,
  observerRef: referenceSchema,
  evidenceRef: referenceSchema,
  repository: z.object({ verifiedCommit: commitSchema, workspaceLeaseRef: referenceSchema }).strict(),
  buildDigest: digestSchema,
  profile: artifactSchema,
  configDigest: digestSchema,
  route: executionRouteSchema.nullable(),
  tools: artifactSetSchema,
  skills: artifactSetSchema,
}).strict()

/**
 * Recorded observations for one cell attempt. Observer/evidence references must be
 * resolved by a trusted Consumer; a valid document or matching digest is not attestation.
 * Subject identity is required; absent grader/verifier identities remain explicit nulls.
 */
export const resolvedExecutionManifestSchema = z.object({
  kind: z.literal('eval-execution-manifest'),
  schemaVersion: z.literal(1),
  id: nonBlank,
  version: nonBlank,
  planRef: referenceSchema,
  suiteRef: referenceSchema,
  runId: nonBlank,
  cell: z.object({
    caseId: nonBlank,
    routeId: nonBlank,
    repeatIndex: z.number().int().nonnegative(),
    attempt: z.number().int().positive(),
  }).strict(),
  subject: executionIdentitySchema.extend({ route: executionRouteSchema }),
  grader: executionIdentitySchema.nullable(),
  verifier: executionIdentitySchema.nullable(),
  verifierPlanRef: referenceSchema,
}).strict().superRefine((manifest, ctx) => {
  if (manifest.subject.route.id !== manifest.cell.routeId) {
    ctx.addIssue({ code: 'custom', path: ['cell', 'routeId'], message: 'subject route does not match cell' })
  }
  for (const role of ['grader', 'verifier'] as const) {
    if (manifest[role]?.executionId === manifest.subject.executionId) {
      ctx.addIssue({ code: 'custom', path: [role], message: 'subject cannot supply its own independent execution identity' })
    }
  }
})

/** Recorded role identities bound to a run, case, route, repeat and attempt. */
export type ResolvedExecutionManifest = z.infer<typeof resolvedExecutionManifestSchema>

/**
 * Parse recorded observations without upgrading caller assertions into trusted facts.
 * @param input Untrusted manifest document; legacy EvalRun records are not accepted.
 * @returns Structurally valid observations, with Tool/Skill sets sorted by unique id.
 * @throws {z.ZodError} On malformed identities, duplicate capabilities or role/cell conflicts.
 */
export function parseResolvedExecutionManifest(input: unknown): ResolvedExecutionManifest {
  return resolvedExecutionManifestSchema.parse(input)
}
