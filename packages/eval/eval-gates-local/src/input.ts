import { evalContractDigest } from '@changanhua/dsh-eval'
import type { GateSnapshot, GateVerifierInput, GateVerifierCell } from '@changanhua/dsh-eval-gates'

/** Derive checker input from Host-verified private execution material, never a safe view or recorded outcome. */
export function makeVerifierInput(snapshot: GateSnapshot): GateVerifierInput {
  if (snapshot.plan.baselineRef) throw new Error('eval-gate-input-baseline-unsupported')
  const cells: GateVerifierCell[] = snapshot.cells.map((cell) => {
    const manifest = cell.work.output?.manifest
    const subject = manifest?.subject
    if (!manifest || !subject || cell.evidence.status !== 'intact') throw new Error('eval-gate-input-evidence')
    const subjectMaterial = cell.evidence.materials.find(item => item.kind === 'execution' && item.role === 'subject'
      && item.executionId === subject.executionId)
    if (!subjectMaterial) throw new Error('eval-gate-input-subject-material')
    const protocol = JSON.parse(subjectMaterial.content) as { protocol?: { rawReports?: { complete?: { output?: unknown } } } }
    const output = protocol.protocol?.rawReports?.complete?.output
    if (typeof output !== 'string') throw new Error('eval-gate-input-subject-output')
    const graderMaterial = manifest.grader && cell.evidence.materials.find(item => item.kind === 'execution' && item.role === 'grader'
      && item.executionId === manifest.grader?.executionId)
    const graderProtocol = graderMaterial
      ? JSON.parse(graderMaterial.content) as { protocol?: { rawReports?: { complete?: { output?: unknown } } } } : undefined
    const grader = graderProtocol?.protocol?.rawReports?.complete?.output
    if (grader !== undefined && grader !== 'PASS' && grader !== 'FAIL') throw new Error('eval-gate-input-grader-output')
    if (snapshot.plan.budget.required && (cell.budget.length === 0 || cell.budget.some(row => row.phase !== 'settled' || !row.usage))) {
      throw new Error('eval-gate-input-budget')
    }
    return { caseId: cell.binding.caseId, routeId: cell.binding.routeId, repeatIndex: cell.binding.repeatIndex,
      manifestDigest: evalContractDigest(manifest), subjectOutput: output, graderOutput: grader ?? null,
      integrity: 'intact', budget: snapshot.plan.budget.required ? 'settled' : 'not-required' }
  })
  return { kind: 'eval-verifier-input', schemaVersion: 1, snapshotRevision: snapshot.revision,
    plan: { id: snapshot.plan.id, version: snapshot.plan.version, digest: evalContractDigest(snapshot.plan),
      expectedCommit: snapshot.plan.repository.expectedCommit, baseline: 'none' },
    suite: { id: snapshot.suite.id, version: snapshot.suite.version, digest: evalContractDigest(snapshot.suite),
      sourceRevision: snapshot.suite.sourceRevision },
    verifierPlan: snapshot.plan.verifierPlanRef, expectedCells: snapshot.run.expectedCells,
    cases: snapshot.suite.cases.map(item => ({ id: item.id, criteria: item.successCriteria.map((criterion) => {
      if (criterion.kind === 'session-snapshot') throw new Error('eval-gate-input-unsupported-criterion')
      return criterion
    }), requiresGrader: item.evaluator.kind === 'model-grader' })), cells }
}
