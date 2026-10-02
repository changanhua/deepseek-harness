import { z } from 'zod'
import { compareIdentity, contentReference, nonBlank, referenceSchema, referenceSetSchema, sameValue, serializeEvalContract, uniqueBy } from './identity.ts'
import { resolvedExecutionManifestSchema } from './manifest.ts'
import { evalPlanSchema } from './plan.ts'
import { evalOutcomeSchema } from './run.ts'

const verifierSchema = z.object({
  executionId: nonBlank,
  planRef: referenceSchema,
  reportRef: referenceSchema,
  manifestRefs: referenceSetSchema,
  evidenceRef: referenceSchema,
  outcome: z.enum(['approved', 'rejected', 'unknown']),
}).strict()

/**
 * A recorded gate conclusion, not permission to execute, retry, merge or spend.
 * Structural checks reject contradictory passes; trusted Consumers still verify
 * referenced evidence, the preapproved verifier policy and budget owner receipts.
 */
export const evalGateDecisionSchema = z.object({
  kind: z.literal('eval-gate-decision'),
  schemaVersion: z.literal(1),
  id: nonBlank,
  version: nonBlank,
  decision: z.enum(['pass', 'block', 'retry', 'needs-attention']),
  reasonCode: z.enum([
    'criteria-satisfied', 'criteria-failed', 'invalid-result', 'infrastructure-uncertain',
    'identity-mismatch', 'evidence-missing', 'evidence-corrupt', 'verifier-missing',
    'verifier-rejected', 'budget-unknown', 'budget-exhausted', 'non-comparable', 'pending-verification',
  ]),
  runId: nonBlank,
  planRef: referenceSchema,
  suiteRef: referenceSchema,
  manifestRefs: referenceSetSchema,
  report: z.object({ ref: referenceSchema, outcome: evalOutcomeSchema }).strict(),
  verifier: verifierSchema.nullable(),
  evidenceIntegrity: z.object({
    status: z.enum(['intact', 'missing', 'corrupt', 'unknown']),
    receiptRef: referenceSchema.nullable(),
  }).strict(),
  budget: z.object({
    status: z.enum(['within-limit', 'exhausted', 'unknown', 'not-required']),
    authorizationRef: referenceSchema.nullable(),
    receiptRef: referenceSchema.nullable(),
  }).strict(),
  baselineDeltaRef: referenceSchema.nullable(),
  decidedAt: z.iso.datetime(),
}).strict().superRefine((gate, ctx) => {
  const reject = (message: string): void => { ctx.addIssue({ code: 'custom', message }) }
  if ((gate.decision === 'pass') !== (gate.reasonCode === 'criteria-satisfied')) reject('decision and reason disagree')
  if (gate.verifier) {
    if (!sameValue(gate.verifier.reportRef, gate.report.ref)) reject('verifier report reference mismatch')
    if (!sameValue(gate.verifier.manifestRefs, gate.manifestRefs)) reject('verifier manifest references mismatch')
  }
  if (gate.budget.status === 'not-required' && (gate.budget.authorizationRef || gate.budget.receiptRef)) {
    reject('budget exemption cannot carry a settlement or authorization')
  }
  if (gate.decision !== 'pass') return
  if (gate.manifestRefs.length === 0) reject('pass requires observed manifest references')
  if (gate.report.outcome === 'invalid' || gate.report.outcome === 'infrastructure-uncertain') reject('uncertain or invalid report cannot pass')
  if (gate.verifier?.outcome !== 'approved') reject('pass requires an approved independent verifier result')
  if (gate.evidenceIntegrity.status !== 'intact' || !gate.evidenceIntegrity.receiptRef) reject('pass requires intact evidence and its receipt')
  if (gate.budget.status !== 'within-limit' && gate.budget.status !== 'not-required') reject('pass requires a known budget status')
  if (gate.budget.status === 'within-limit' && (!gate.budget.authorizationRef || !gate.budget.receiptRef)) reject('pass requires budget authorization and settlement references')
})

/** Structurally valid gate record; no runtime authority is created by parsing it. */
export type EvalGateDecision = z.infer<typeof evalGateDecisionSchema>

const decisionContextSchema = z.object({
  plan: evalPlanSchema,
  manifests: z.array(resolvedExecutionManifestSchema),
  decision: evalGateDecisionSchema,
}).strict().superRefine(({ plan, manifests, decision }, ctx) => {
  const reject = (message: string): void => { ctx.addIssue({ code: 'custom', message }) }
  const planRef = contentReference(plan)
  if (!sameValue(decision.planRef, planRef) || !sameValue(decision.suiteRef, plan.suiteRef)) reject('decision Plan/Suite identity mismatch')
  uniqueBy(manifests, manifest => manifest.id, ctx)
  uniqueBy(manifests, manifest => serializeEvalContract([manifest.runId, manifest.cell]), ctx)
  const refs = manifests.map(contentReference).sort(compareIdentity)
  if (!sameValue(refs, decision.manifestRefs)) reject('manifest content references mismatch')
  if (decision.verifier && !sameValue(decision.verifier.planRef, plan.verifierPlanRef)) reject('verifier policy differs from frozen Plan')
  if (decision.decision === 'pass') {
    if (plan.budget.required) {
      if (decision.budget.status !== 'within-limit' || !sameValue(decision.budget.authorizationRef, plan.budget.authorizationRef)) reject('required Plan budget is not satisfied')
    } else if (decision.budget.status !== 'not-required') reject('budget status differs from Plan exemption')
    if (plan.baselineRef && !decision.baselineDeltaRef) reject('baseline Plan requires a comparison result reference')
  }
  const executionIdentities = new Map<string, string>()
  for (const manifest of manifests) {
    for (const identity of [manifest.subject, manifest.grader, manifest.verifier]) {
      if (!identity) continue
      const serialized = serializeEvalContract(identity)
      const previous = executionIdentities.get(identity.executionId)
      if (previous !== undefined && previous !== serialized) reject('execution identity carries conflicting observations')
      executionIdentities.set(identity.executionId, serialized)
    }
    if (!sameValue(manifest.planRef, planRef) || !sameValue(manifest.suiteRef, plan.suiteRef)) reject('manifest Plan/Suite identity mismatch')
    if (manifest.runId !== decision.runId) reject('manifest belongs to a different run')
    if (manifest.cell.repeatIndex >= plan.repeatPolicy.count) reject('repeat index exceeds Plan')
    if (manifest.subject.repository.verifiedCommit !== plan.repository.expectedCommit) reject('observed commit differs from Plan')
    const route = plan.routes.find(candidate => candidate.id === manifest.cell.routeId)
    if (!route || !sameValue(route, manifest.subject.route)) reject('observed route differs from Plan')
    if (!sameValue(manifest.verifierPlanRef, plan.verifierPlanRef)) reject('manifest verifier policy differs from Plan')
    if (decision.decision === 'pass' && (!manifest.verifier || manifest.verifier.executionId !== decision.verifier?.executionId)) reject('manifest does not bind the deciding verifier')
  }
})

/** Plan, cell observations and gate record whose cross-references are structurally checked. */
export type EvalDecisionContext = z.infer<typeof decisionContextSchema>

/**
 * Parse a gate record and reject contradictory passes; does not compute a regression policy.
 * @param input Untrusted gate document.
 * @returns Parsed conclusion with normalized manifest reference sets.
 * @throws {z.ZodError} On malformed input, reference mismatch or fail-closed violations.
 */
export function parseEvalGateDecision(input: unknown): EvalGateDecision {
  return evalGateDecisionSchema.parse(input)
}

/**
 * Check exact Plan, manifest, run/cell and verifier bindings without authenticating records.
 *
 * Callers must obtain documents through trusted owners and verify referenced report,
 * observation, integrity and budget receipts independently. This function does not read
 * evidence, prove isolation, establish Suite case coverage, or grant execution authority.
 * @param input Object containing plan, manifests and decision.
 * @returns Normalized records whose internal identities and required pass conditions agree.
 * @throws {z.ZodError} On invalid records, content drift or mismatched execution context.
 */
export function validateEvalDecisionContext(input: unknown): EvalDecisionContext {
  return decisionContextSchema.parse(input)
}

/**
 * Render all structurally validated decision facts as deterministic JSON.
 * @param input Decision context; not an authenticated runtime result.
 * @returns Canonical JSON with a trailing newline.
 * @throws {z.ZodError} On invalid decision context.
 */
export function formatEvalDecisionJson(input: unknown): string {
  return `${serializeEvalContract(validateEvalDecisionContext(input))}\n`
}

/**
 * Render the same complete decision facts as JSON in a Markdown document.
 * @param input Decision context; not an authenticated runtime result.
 * @returns Markdown containing the complete canonical JSON and its trust limitation.
 * @throws {z.ZodError} On invalid decision context.
 */
export function formatEvalDecisionMarkdown(input: unknown): string {
  const value = validateEvalDecisionContext(input)
  const json = `${serializeEvalContract(value)}\n`
  const longest = Math.max(0, ...(json.match(/`+/gu) ?? []).map(run => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `# Eval decision\n\nDecision: **${value.decision.decision}** (${value.decision.reasonCode}).\n\nEvidence: ${value.decision.evidenceIntegrity.status}. Budget: ${value.decision.budget.status}. Cell attempts: ${value.manifests.length}.\n\nStructural validation only; referenced facts require trusted owner verification.\n\n${fence}json\n${json}${fence}\n`
}
