/** Compare authenticated core observations with approval expectations without rewriting actual identities. */
import { evalContractDigest, evalPlanSchema, resolvedExecutionManifestSchema } from '@changanhua/dsh-eval'
import type { ResolvedExecutionManifest } from '@changanhua/dsh-eval'

/** Capability identities sampled by the Host-pinned core in the exact Agent scope. */
export interface CoreObservation {
  readonly sessionId: string
  readonly preset: ResolvedExecutionManifest['subject']['route']['preset']
  readonly tools: ResolvedExecutionManifest['subject']['tools']
  readonly skills: ResolvedExecutionManifest['subject']['skills']
}

/**
 * Validate observed metadata and compare each identity independently.
 * @param input Authenticated core payload; parsing alone does not establish provenance.
 * @param expected Host-approved identity, used only for comparison.
 * @returns Actual values, including mismatches, for Manifest and failure evidence.
 */
export function compareCoreObservation(input: unknown, expected: CoreObservation): {
  readonly valid: boolean
  readonly actual: CoreObservation
  readonly mismatches: readonly string[]
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('eval-observation-invalid')
  const raw = input as Record<string, unknown>
  if (typeof raw.sessionId !== 'string' || !raw.sessionId
    || Object.keys(raw).some(key => !['sessionId', 'preset', 'tools', 'skills'].includes(key))) throw new Error('eval-observation-invalid')
  const shape = resolvedExecutionManifestSchema.shape.subject.shape
  const actual = { sessionId: raw.sessionId, preset: evalPlanSchema.shape.routes.element.shape.preset.parse(raw.preset),
    tools: shape.tools.parse(raw.tools), skills: shape.skills.parse(raw.skills) }
  const normalized = { ...expected, tools: shape.tools.parse(expected.tools), skills: shape.skills.parse(expected.skills) }
  const mismatches = (['sessionId', 'preset', 'tools', 'skills'] as const)
    .filter(key => evalContractDigest(actual[key]) !== evalContractDigest(normalized[key]))
  return { valid: mismatches.length === 0, actual, mismatches }
}
