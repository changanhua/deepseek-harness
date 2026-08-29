/** Cross-object semantic checks that cannot be proven by one strict record schema. */

import { verificationCheckDigest } from './canonical.ts'
import type { RepositoryRelativePath } from './brand.ts'
import type {
  AcceptanceDecision,
  ChangedPathFinding,
  CompletionClaim,
  ContractReadiness,
  ContractRevision,
  EvidenceRef,
  PathRule,
  VerificationPlan,
  VerificationVerdict,
} from './types.ts'

/**
 * Test one normalized repository-relative path against an exact or subtree rule.
 * A subtree includes its root path and every slash-delimited descendant.
 * @param path - Normalized repository-relative path derived from Git.
 * @param rule - Packet-owned exact or subtree boundary.
 * @returns whether the path belongs to the rule.
 */
export function repositoryPathMatchesRule(
  path: RepositoryRelativePath,
  rule: PathRule,
): boolean {
  return path === rule.path
    || (rule.kind === 'subtree' && path.startsWith(`${rule.path}/`))
}

/**
 * Derive deterministic Packet path violations from Git changed paths.
 *
 * An empty allowlist permits every path not forbidden. Forbidden rules take
 * precedence over allow rules, and duplicate changed paths produce one finding.
 * @param changedPaths - Complete Git-derived changed-path set.
 * @param allowedPaths - Optional positive boundary; empty means unrestricted.
 * @param forbiddenPaths - Negative boundary evaluated first.
 * @returns one ordered finding per violating path.
 */
export function changedPathBoundaryFindings(
  changedPaths: readonly RepositoryRelativePath[],
  allowedPaths: readonly PathRule[],
  forbiddenPaths: readonly PathRule[],
): readonly ChangedPathFinding[] {
  const seen = new Set<RepositoryRelativePath>()
  const findings: ChangedPathFinding[] = []
  for (const path of changedPaths) {
    if (seen.has(path)) continue
    seen.add(path)
    if (forbiddenPaths.some(rule => repositoryPathMatchesRule(path, rule))) {
      findings.push({ path, kind: 'forbidden' })
    } else if (
      allowedPaths.length !== 0
      && !allowedPaths.some(rule => repositoryPathMatchesRule(path, rule))
    ) {
      findings.push({ path, kind: 'outside-allowed' })
    }
  }
  return findings
}

/**
 * Derive Contract readiness without persisting another mutable status.
 * @param contract - Immutable Contract revision to inspect.
 * @returns readiness plus deterministic blocking reasons.
 */
export function contractReadiness(contract: ContractRevision): ContractReadiness {
  const reasons: ContractReadiness['reasons'][number][] = []
  if (contract.outcome === null) reasons.push('missing-outcome')
  if (contract.repositoryId === null) reasons.push('missing-repository')
  if (contract.allowedScope.length === 0 && contract.forbiddenScope.length === 0) reasons.push('missing-scope')
  if (contract.acceptanceClauses.length === 0) reasons.push('missing-acceptance')
  if (contract.baseSelectionRule === null) reasons.push('missing-base-selection')
  if (contract.verificationSource === null) reasons.push('missing-verification-source')
  if (contract.openDecisions.length !== 0) reasons.push('open-decisions')
  return { ready: reasons.length === 0, reasons }
}

/**
 * Find completed-claim evidence violations that require related EvidenceRefs.
 * Non-completed dispositions have no Git-evidence eligibility obligation.
 * @param claim - Completion claim to validate.
 * @param evidence - Resolved evidence metadata referenced by the claim.
 * @returns human-readable cross-object findings.
 */
export function completionClaimEvidenceFindings(
  claim: CompletionClaim,
  evidence: readonly EvidenceRef[],
): readonly string[] {
  if (claim.disposition !== 'completed') return []
  const byId = new Map(evidence.map(reference => [reference.id, reference]))
  const missing = claim.evidenceIds.filter(id => !byId.has(id))
  const matchingGit = claim.evidenceIds.some((id) => {
    const reference = byId.get(id)
    return reference !== undefined
      && reference.provenance.kind === 'change-attempt'
      && reference.provenance.packetId === claim.packetId
      && reference.provenance.queueWorkId === claim.queueWorkId
      && reference.provenance.queueAttemptId === claim.queueAttemptId
      && (reference.kind === 'git-diff-metadata' || reference.kind === 'patch' || reference.kind === 'checkpoint-metadata')
  })
  return [
    ...missing.map(id => `completion claim references missing evidence ${id}`),
    ...matchingGit ? [] : ['completed claim requires matching Git evidence from its producing Queue Attempt'],
  ]
}

/**
 * Find plan/result mismatches that require both a verdict and its trusted plan.
 * @param verdict - Independent verification result.
 * @param plan - Trusted immutable plan used for comparison.
 * @returns human-readable cross-object findings.
 */
export function verificationVerdictPlanFindings(
  verdict: VerificationVerdict,
  plan: VerificationPlan,
): readonly string[] {
  const findings: string[] = []
  if (verdict.verificationPlanDigest !== plan.digest) findings.push('verdict plan digest does not match the trusted plan')
  const results = new Map(verdict.checkResults.map(result => [result.checkId, result]))
  for (const check of plan.checks) {
    const result = results.get(check.id)
    if (result === undefined) {
      findings.push(`verdict is missing check result ${check.id}`)
      continue
    }
    if (result.checkDigest !== verificationCheckDigest(check)) findings.push(`check result ${check.id} has the wrong command digest`)
    if (result.severity !== check.severity) findings.push(`check result ${check.id} has the wrong severity`)
    if (result.status === 'exited') {
      const expected = check.expectedExitCodes.includes(result.exitCode)
      if (result.expected !== expected) findings.push(`check result ${check.id} has an inconsistent expected flag`)
    }
  }
  const plannedIds = new Set(plan.checks.map(check => check.id))
  for (const result of verdict.checkResults) {
    if (!plannedIds.has(result.checkId)) findings.push(`verdict contains unplanned check result ${result.checkId}`)
  }
  return findings
}

/**
 * Find a decision/verdict identity or authorization mismatch.
 * @param decision - Human-authored delivery disposition.
 * @param verdict - Exact verifier result named by the decision.
 * @returns human-readable cross-object findings.
 */
export function acceptanceDecisionFindings(
  decision: AcceptanceDecision,
  verdict: VerificationVerdict,
): readonly string[] {
  const findings: string[] = []
  if (decision.verdictId !== verdict.id) findings.push('decision verdict id does not match the supplied verdict')
  if (decision.packetId !== verdict.packetId) findings.push('decision packet id does not match the verdict')
  if (decision.targetCommit !== verdict.targetCommit) findings.push('decision target commit does not match the verdict')
  if (decision.decision === 'accepted' && verdict.status !== 'passed') {
    findings.push('accepted decision requires a matching passed verdict')
  }
  return findings
}
