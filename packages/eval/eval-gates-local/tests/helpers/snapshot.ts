import { evalContractDigest, parseEvalPlan, parseEvalSuite, parseResolvedExecutionManifest } from '@changanhua/dsh-eval'
import type { GateSnapshot } from '@changanhua/dsh-eval-gates'
const digest = (char: string) => char.repeat(64)

export function snapshot(): GateSnapshot {
  const suite = parseEvalSuite({ schemaVersion: 1, id: 'suite', version: '1', sourceRevision: 'e'.repeat(40), title: 'suite', defaultRouteIds: ['route', 'route-b'],
    routes: [{ id: 'route', provider: 'mock', model: 'mock', preset: 'preset' }, { id: 'route-b', provider: 'mock', model: 'mock', preset: 'preset' }],
    cases: [{ id: 'case', title: 'case', prompt: 'p', workspace: { kind: 'empty' }, successCriteria: [{ kind: 'output-equals', text: 'READY' }], evaluator: { kind: 'deterministic' },
      replayFixtures: [{ routeId: 'route', binding: 'first-call-order', sessionFile: 'r' }, { routeId: 'route-b', binding: 'first-call-order', sessionFile: 'b' }] }] })
  const plan = parseEvalPlan({ kind: 'eval-plan', schemaVersion: 1, id: 'plan', version: '1', suiteRef: { id: suite.id, version: suite.version, digest: evalContractDigest(suite) },
    repository: { requestedRevision: 'main', expectedCommit: 'e'.repeat(40) }, routes: [{ id: 'route', provider: 'mock', model: 'mock', parameters: {}, preset: { id: 'preset', source: 'host', digest: digest('3') } }],
    repeatPolicy: { count: 1, seed: null, order: 'route-case-repeat' }, baselineRef: null, workspacePolicy: 'per-cell', allowedEntrypoints: ['cli'], credentialAuthorizationRef: null,
    budget: { required: true, authorizationRef: { id: 'budget', version: '1', digest: digest('7') } }, verifierPlanRef: { id: 'verifier-policy', version: '1', digest: digest('4') } })
  const manifest = parseResolvedExecutionManifest({
    kind: 'eval-execution-manifest', schemaVersion: 1, id: 'manifest', version: '1', planRef: { id: plan.id, version: plan.version, digest: evalContractDigest(plan) }, suiteRef: plan.suiteRef,
    runId: 'run', cell: { caseId: 'case', routeId: 'route', repeatIndex: 0, attempt: 1 },
    subject: { executionId: 'subject', observerRef: { id: 'subject-observer', version: '1', digest: digest('c') },
      evidenceRef: { id: 'subject-evidence', version: '1', digest: digest('d') }, repository: { verifiedCommit: 'e'.repeat(40), workspaceLeaseRef: { id: 'lease', version: '1', digest: digest('e') } },
      buildDigest: digest('f'), profile: { id: 'subject-profile', source: 'host', digest: digest('1') }, configDigest: digest('2'),
      route: { id: 'route', provider: 'mock', model: 'mock', preset: { id: 'preset', source: 'host', digest: digest('3') }, parameters: {} }, tools: [], skills: [] },
    grader: null, verifier: null, verifierPlanRef: { id: 'verifier-policy', version: '1', digest: digest('4') },
  })
  return {
    revision: digest('5'), observedAt: 1, expiresAt: 10_000, plan, suite,
    run: { id: 'run', expectedCells: [{ caseId: 'case', routeId: 'route', repeatIndex: 0 }] },
    cells: [{ binding: { runId: 'run', caseId: 'case', routeId: 'route', repeatIndex: 0 },
      work: { id: 'work', status: 'succeeded', attempt: { id: 'attempt', ordinal: 1, status: 'succeeded' },
        output: { outcome: 'passed', reason: null, manifest, evidenceDigest: digest('6') } },
      evidence: { status: 'intact', bundle: { id: 'bundle', version: '1', digest: digest('6') }, receivedAt: 1, expiresAt: 10_000, materials: [] },
      budget: [{ requestId: 'request', attemptId: 'attempt', provider: 'mock', model: 'mock', dispatched: true,
        phase: 'settled', usage: { inputTokens: 1, outputTokens: 1 } }] }],
  }
}
