import { evalContractDigest } from '@changanhua/dsh-eval'
import type { GateCellIdentity, GateSnapshot } from '@changanhua/dsh-eval-gates'

/** Deterministic pre-verifier conclusion. A later verifier may only narrow this result. */
export type SnapshotDecision = {
  readonly decision: 'pass' | 'block' | 'needs-attention'
  readonly reasonCode: 'criteria-satisfied' | 'criteria-failed' | 'invalid-result' | 'identity-mismatch' | 'evidence-missing' | 'evidence-corrupt' | 'budget-unknown' | 'non-comparable'
}

function sameCell(left: GateCellIdentity, right: GateCellIdentity): boolean {
  return left.caseId === right.caseId && left.routeId === right.routeId && left.repeatIndex === right.repeatIndex
}
function cellKey(cell: GateCellIdentity): string { return JSON.stringify([cell.caseId, cell.routeId, cell.repeatIndex]) }

/**
 * Decide whether a frozen Snapshot is complete enough to enter a deterministic verifier.
 * @param snapshot Host-supplied original facts.
 * @param now Current Host time, used only for retention checks.
 * @returns A fail-closed preliminary conclusion; `pass` still requires a verifier result.
 */
export function decideSnapshot(snapshot: GateSnapshot, now: number): SnapshotDecision {
  if (snapshot.plan.baselineRef) return { decision: 'needs-attention', reasonCode: 'non-comparable' }
  if (snapshot.plan.suiteRef.id !== snapshot.suite.id || snapshot.plan.suiteRef.version !== snapshot.suite.version
    || snapshot.plan.suiteRef.digest !== evalContractDigest(snapshot.suite)
    || snapshot.plan.repository.expectedCommit !== snapshot.suite.sourceRevision
    || snapshot.plan.verifierPlanRef.id.length === 0 || snapshot.plan.verifierPlanRef.version.length === 0) {
    return { decision: 'needs-attention', reasonCode: 'identity-mismatch' }
  }
  const expected = snapshot.plan.routes.flatMap(route => snapshot.suite.cases.flatMap(evalCase =>
    Array.from({ length: snapshot.plan.repeatPolicy.count }, (_, repeatIndex) => ({ caseId: evalCase.id, routeId: route.id,
      repeatIndex }))))
  if (new Set(expected.map(cellKey)).size !== expected.length
    || new Set(snapshot.run.expectedCells.map(cellKey)).size !== snapshot.run.expectedCells.length
    || expected.length !== snapshot.run.expectedCells.length
    || expected.some(cell => !snapshot.run.expectedCells.some(item => sameCell(cell, item)))) {
    return { decision: 'needs-attention', reasonCode: 'identity-mismatch' }
  }
  if (snapshot.expiresAt <= now) return { decision: 'needs-attention', reasonCode: 'evidence-missing' }
  const seen = new Set<string>()
  for (const expected of snapshot.run.expectedCells) {
    const key = JSON.stringify(expected)
    if (seen.has(key)) return { decision: 'needs-attention', reasonCode: 'identity-mismatch' }
    seen.add(key)
    const matches = snapshot.cells.filter(cell => sameCell(cell.binding, expected))
    if (matches.length !== 1) return { decision: 'needs-attention', reasonCode: 'evidence-missing' }
    const cell = matches[0]
    if (!cell) return { decision: 'needs-attention', reasonCode: 'evidence-missing' }
    const { work, evidence } = cell
    if (work.status !== 'succeeded' || work.attempt?.status !== 'succeeded' || !work.output || !work.output.manifest) {
      return { decision: 'needs-attention', reasonCode: 'evidence-missing' }
    }
    const manifest = work.output.manifest
    if (manifest.runId !== snapshot.run.id || !sameCell(manifest.cell, expected) || manifest.cell.attempt !== work.attempt.ordinal) {
      return { decision: 'needs-attention', reasonCode: 'identity-mismatch' }
    }
    if (evidence.status === 'corrupt') return { decision: 'needs-attention', reasonCode: 'evidence-corrupt' }
    if (evidence.status !== 'intact' || !evidence.bundle || evidence.expiresAt === null || evidence.expiresAt <= now) {
      return { decision: 'needs-attention', reasonCode: 'evidence-missing' }
    }
    if (snapshot.plan.budget.required && cell.budget.some(receipt => receipt.phase !== 'settled' || !receipt.usage)) {
      return { decision: 'needs-attention', reasonCode: 'budget-unknown' }
    }
    if (snapshot.plan.budget.required && cell.budget.length === 0) return { decision: 'needs-attention', reasonCode: 'budget-unknown' }
    if (work.output.outcome === 'invalid') return { decision: 'block', reasonCode: 'invalid-result' }
    if (work.output.outcome === 'failed') return { decision: 'block', reasonCode: 'criteria-failed' }
  }
  return { decision: 'pass', reasonCode: 'criteria-satisfied' }
}
