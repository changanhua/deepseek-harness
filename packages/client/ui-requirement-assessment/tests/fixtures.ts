import { assessmentDimensionKeys } from '@changanhua/dsh-requirement-assessment'
export const evaluation = {
  dimensions: assessmentDimensionKeys.map(dimension => ({ dimension, level: 'unknown' as const, confidence: 'low' as const, claim: 'Needs evidence', grounds: ['User material'], counterArguments: [], unknowns: ['Actual usage'] })),
  stressTests: [
    { kind: 'model_x2' as const, declines: ['Thin wrappers'], remains: ['State'], increases: [], durableCore: 'State history' },
    { kind: 'upstream_substitution' as const, deletable: ['Thin wrappers'], retained: ['History'], avoidOverbuilding: 'Avoid wrappers' },
    { kind: 'no_build' as const, workaround: 'Manual process', actualLoss: 'Unknown', investmentEvidence: 'Unknown', smallestExperiment: 'Observe usage' },
  ],
  allocation: { SYSTEM_OWNED: [{ component: 'State', rationale: 'Durable' }], MODEL_OWNED: [{ component: 'Judgment', rationale: 'Dynamic' }], EXPERIMENT: [{ component: 'Usage', rationale: 'Unknown' }] },
  route: 'EXPERIMENT' as const, routeRationale: 'Gather evidence', uncertainties: [],
}
export const input = {
  requestId: 'request-a', requestDigest: 'digest-a', subject: { kind: 'manual' as const, id: 'manual-a', title: 'A review' },
  baseline: { assessedAt: '2026-10-01T00:00:00.000Z', subject: { kind: 'manual' as const, id: 'manual-a', title: 'A review' }, dsh: 'unknown', workspace: 'unknown', capabilityRefs: [], evaluator: { provider: 'test', model: 'test', identity: 'fixture', promptVersion: '1' }, contextVersions: [] },
  actualInput: { text: 'Original text', evidence: [{ source: 'User', provenance: 'user_statement' as const, verification: 'unverified' as const, excerpt: 'Original evidence' }], selectedContext: [], omissions: [] },
  evaluation, rawOutput: JSON.stringify(evaluation),
}
