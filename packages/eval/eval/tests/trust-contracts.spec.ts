import { describe, expect, test } from 'vitest'
import * as api from '../src/index.ts'

const digest = 'a'.repeat(64)
const ref = (id: string) => ({ id, version: '1', digest })
const artifact = (id: string) => ({ id, source: 'package:test', digest })
const route = { id: 'route-a', provider: 'provider-a', model: 'model-a', preset: artifact('preset'), parameters: { temperature: 0 } }
const planInput = () => ({
  kind: 'eval-plan', schemaVersion: 1, id: 'plan', version: '1', suiteRef: ref('suite'),
  repository: { requestedRevision: 'main', expectedCommit: 'b'.repeat(40) },
  routes: [structuredClone(route)], repeatPolicy: { count: 1, seed: null, order: 'route-case-repeat' },
  baselineRef: null, workspacePolicy: 'per-cell', allowedEntrypoints: ['cli'],
  credentialAuthorizationRef: null, budget: { required: true, authorizationRef: ref('budget') },
  verifierPlanRef: ref('verifier-plan'),
})
const identity = (id: string) => ({
  executionId: id, observerRef: ref('host'), evidenceRef: ref(`observation-${id}`),
  repository: { verifiedCommit: 'b'.repeat(40), workspaceLeaseRef: ref(`lease-${id}`) },
  buildDigest: digest, profile: artifact('profile'), configDigest: digest,
  route: structuredClone(route), tools: [artifact('read'), artifact('write')], skills: [artifact('test')],
})
const contractRef = (value: { id: string; version: string }) => ({
  id: value.id, version: value.version, digest: api.evalContractDigest(value),
})

function context() {
  const plan = api.parseEvalPlan(planInput())
  const manifest = api.parseResolvedExecutionManifest({
    kind: 'eval-execution-manifest', schemaVersion: 1, id: 'manifest', version: '1',
    planRef: contractRef(plan), suiteRef: plan.suiteRef, runId: 'run',
    cell: { caseId: 'case', routeId: 'route-a', repeatIndex: 0, attempt: 1 },
    subject: identity('subject'), grader: identity('grader'), verifier: identity('verifier'),
    verifierPlanRef: plan.verifierPlanRef,
  })
  const manifestRefs = [contractRef(manifest)]
  const report = { ref: ref('report'), outcome: 'passed' as const }
  const decision = api.parseEvalGateDecision({
    kind: 'eval-gate-decision', schemaVersion: 1, id: 'gate', version: '1',
    decision: 'pass', reasonCode: 'criteria-satisfied', runId: 'run',
    planRef: contractRef(plan), suiteRef: plan.suiteRef, manifestRefs, report,
    verifier: {
      executionId: 'verifier', planRef: plan.verifierPlanRef, reportRef: report.ref,
      manifestRefs, evidenceRef: ref('verification'), outcome: 'approved',
    },
    evidenceIntegrity: { status: 'intact', receiptRef: ref('integrity') },
    budget: { status: 'within-limit', authorizationRef: ref('budget'), receiptRef: ref('settlement') },
    baselineDeltaRef: null, decidedAt: '2026-10-02T12:00:00.000Z',
  })
  return { plan, manifests: [manifest], decision }
}

describe('Eval trust contracts', () => {
  test('exports contract validation without a runtime authority factory', () => {
    expect(api.parseEvalPlan).toBeTypeOf('function')
    expect(api.parseResolvedExecutionManifest).toBeTypeOf('function')
    expect(api.parseEvalGateDecision).toBeTypeOf('function')
    expect(api.validateEvalDecisionContext).toBeTypeOf('function')
  })

  test('round-trips an internally consistent decision without authenticating its producer', () => {
    const value = context()
    expect(api.validateEvalDecisionContext(JSON.parse(JSON.stringify(value)))).toEqual(value)
    expect(api.formatEvalDecisionJson(value)).toBe(api.formatEvalDecisionJson(JSON.parse(JSON.stringify(value))))
    expect(api.formatEvalDecisionMarkdown(value)).toContain('Structural validation only')
  })

  test('rejects unknown versions, extra fields, duplicate routes and abbreviated commits', () => {
    expect(() => api.parseEvalPlan({ ...planInput(), schemaVersion: 2 })).toThrow()
    expect(() => api.parseEvalPlan({ ...planInput(), verified: true })).toThrow()
    expect(() => api.parseEvalPlan({ ...planInput(), routes: [route, route] })).toThrow()
    expect(() => api.parseEvalPlan({ ...planInput(), repository: { requestedRevision: 'main', expectedCommit: 'abcdef0' } })).toThrow()
  })

  test('normalizes capability sets but preserves execution and parameter array order', () => {
    const value = context()
    const changed = structuredClone(value.manifests[0]!)
    changed.subject.tools.reverse()
    expect(api.evalContractDigest(api.parseResolvedExecutionManifest(changed)))
      .toBe(api.evalContractDigest(value.manifests[0]))
    expect(api.evalContractDigest({ b: 1, a: 2 })).toBe(api.evalContractDigest({ a: 2, b: 1 }))
    const plan = api.parseEvalPlan({ ...planInput(), routes: [route, { ...route, id: 'route-b' }] })
    expect(api.evalContractDigest(plan)).not.toBe(api.evalContractDigest({ ...plan, routes: [...plan.routes].reverse() }))
    expect(api.evalContractDigest({ values: [1, 2] })).not.toBe(api.evalContractDigest({ values: [2, 1] }))
    expect(() => api.evalContractDigest({ invalid: undefined })).toThrow()
  })

  test('does not upgrade a legacy run or tool names into an observed manifest', () => {
    const value = context()
    expect(() => api.parseResolvedExecutionManifest({ schemaVersion: 1, sourceRevision: 'b'.repeat(40), visibleSurface: { tools: ['read'], skills: [] } })).toThrow()
    expect(() => api.parseResolvedExecutionManifest({ ...value.manifests[0], subject: { ...identity('subject'), tools: ['read'] } })).toThrow()
    expect(() => api.parseResolvedExecutionManifest({ ...value.manifests[0], subject: { ...identity('subject'), tools: [artifact('read'), artifact('read')] } })).toThrow()
  })

  test.each(['invalid', 'infrastructure-uncertain'])('never passes a %s report', (outcome) => {
    const { decision } = context()
    expect(() => api.parseEvalGateDecision({ ...decision, report: { ...decision.report, outcome } })).toThrow()
  })

  test('rejects missing verifier, evidence receipt, and unknown or exhausted budget for pass', () => {
    const { decision } = context()
    expect(() => api.parseEvalGateDecision({ ...decision, verifier: null })).toThrow()
    expect(() => api.parseEvalGateDecision({ ...decision, evidenceIntegrity: { status: 'intact', receiptRef: null } })).toThrow()
    for (const status of ['missing', 'corrupt', 'unknown']) {
      expect(() => api.parseEvalGateDecision({ ...decision, evidenceIntegrity: { status, receiptRef: null } })).toThrow()
    }
    for (const status of ['unknown', 'exhausted']) {
      expect(() => api.parseEvalGateDecision({ ...decision, budget: { ...decision.budget, status } })).toThrow()
    }
  })

  test('binds plan, suite, report, verifier policy, and exact manifest content', () => {
    const value = context()
    const mutations = [
      { ...value.decision, planRef: ref('different-plan') },
      { ...value.decision, suiteRef: ref('different-suite') },
      { ...value.decision, manifestRefs: [ref('manifest')] },
      { ...value.decision, report: { ...value.decision.report, ref: ref('other-report') } },
      { ...value.decision, verifier: { ...value.decision.verifier!, planRef: ref('changed-verifier-plan') } },
    ]
    for (const decision of mutations) {
      expect(() => api.validateEvalDecisionContext({ ...value, decision })).toThrow()
    }
  })

  test('rejects cell identity drift and duplicate attempts even when references are recomputed', () => {
    const value = context()
    for (const mutation of [
      { runId: 'other-run' },
      { cell: { ...value.manifests[0]!.cell, repeatIndex: 1 } },
      { subject: { ...identity('subject'), repository: { verifiedCommit: 'c'.repeat(40), workspaceLeaseRef: ref('lease') } } },
      { subject: { ...identity('subject'), route: { ...route, model: 'other-model' } } },
      { verifierPlanRef: ref('late-verifier-plan') },
    ]) {
      const manifest = api.parseResolvedExecutionManifest({ ...value.manifests[0], ...mutation })
      const manifestRefs = [contractRef(manifest)]
      const decision = { ...value.decision, manifestRefs, verifier: { ...value.decision.verifier!, manifestRefs } }
      expect(() => api.validateEvalDecisionContext({ ...value, manifests: [manifest], decision })).toThrow()
    }
    expect(() => api.validateEvalDecisionContext({ ...value, manifests: [value.manifests[0], value.manifests[0]] })).toThrow()
  })

  test('does not let an internally consistent budget exemption override the Plan', () => {
    const value = context()
    const decision = { ...value.decision, budget: { status: 'not-required', authorizationRef: null, receiptRef: null } }
    expect(() => api.validateEvalDecisionContext({ ...value, decision })).toThrow()
  })

  test('keeps non-pass records usable without claiming evidence or verifier availability', () => {
    const value = context()
    const { decision } = value
    const result = api.parseEvalGateDecision({
      ...decision, decision: 'needs-attention', reasonCode: 'evidence-missing', verifier: null,
      evidenceIntegrity: { status: 'missing', receiptRef: null },
      budget: { status: 'unknown', authorizationRef: null, receiptRef: null },
    })
    expect(result.decision).toBe('needs-attention')
    expect(api.validateEvalDecisionContext({ ...value, decision: result }).decision).toEqual(result)
  })

  test('rejects contradictory reasons, role reuse, malformed observation digests and route mismatch', () => {
    const { manifests, decision } = context()
    expect(() => api.parseEvalGateDecision({ ...decision, decision: 'block' })).toThrow(/reason/u)
    expect(() => api.parseEvalGateDecision({ ...decision, budget: { ...decision.budget, receiptRef: null } })).toThrow(/settlement/u)
    expect(() => api.parseEvalGateDecision({
      ...decision, budget: { ...decision.budget, authorizationRef: null },
    })).toThrow(/authorization/u)
    expect(() => api.parseEvalGateDecision({ ...decision, budget: { ...decision.budget, status: 'not-required' } })).toThrow(/exemption/u)
    for (const role of ['grader', 'verifier']) {
      expect(() => api.parseResolvedExecutionManifest({ ...manifests[0], [role]: identity('subject') })).toThrow(/independent/u)
    }
    expect(() => api.parseResolvedExecutionManifest({ ...manifests[0], cell: { ...manifests[0]!.cell, routeId: 'other' } })).toThrow(/route/u)
    expect(() => api.parseResolvedExecutionManifest({ ...manifests[0], subject: { ...identity('subject'), buildDigest: '' } })).toThrow()
    expect(() => api.parseEvalGateDecision({ ...decision, verifier: { ...decision.verifier!, outcome: 'rejected' } })).toThrow(/approved/u)
  })

  test('retains all attempts and normalizes reference sets independent of arrival order', () => {
    const value = context()
    const second = api.parseResolvedExecutionManifest({ ...value.manifests[0], id: 'second', cell: { ...value.manifests[0]!.cell, attempt: 2 } })
    const manifestRefs = [contractRef(second), contractRef(value.manifests[0]!)]
    const decision = { ...value.decision, manifestRefs, verifier: { ...value.decision.verifier!, manifestRefs } }
    const parsed = api.validateEvalDecisionContext({ ...value, manifests: [second, value.manifests[0]], decision })
    expect(parsed.decision.manifestRefs.map(item => item.id)).toEqual(['manifest', 'second'])
    expect(() => api.parseEvalGateDecision({ ...decision, manifestRefs: [manifestRefs[0], manifestRefs[0]] })).toThrow(/duplicate/u)
    expect(() => api.parseEvalGateDecision({
      ...decision, verifier: { ...decision.verifier, manifestRefs: [manifestRefs[0]] },
    })).toThrow(/references/u)
    const otherOrder = { ...parsed, manifests: [...parsed.manifests].reverse() }
    expect(api.validateEvalDecisionContext(otherOrder).decision).toEqual(parsed.decision)
  })

  test('binds required baseline results and explicit budget exemptions to the Plan', () => {
    const value = context()
    const plan = api.parseEvalPlan({ ...value.plan, budget: { required: false, authorizationRef: null }, baselineRef: ref('baseline') })
    const manifest = api.parseResolvedExecutionManifest({ ...value.manifests[0], planRef: contractRef(plan) })
    const manifestRefs = [contractRef(manifest)]
    const decision = {
      ...value.decision, planRef: contractRef(plan), manifestRefs,
      verifier: { ...value.decision.verifier!, manifestRefs },
      budget: { status: 'not-required', authorizationRef: null, receiptRef: null },
    }
    expect(() => api.validateEvalDecisionContext({ plan, manifests: [manifest], decision })).toThrow(/baseline/u)
    const valid = { ...decision, baselineDeltaRef: ref('delta') }
    expect(api.validateEvalDecisionContext({ plan, manifests: [manifest], decision: valid }).decision.decision).toBe('pass')
    expect(() => api.validateEvalDecisionContext({
      plan, manifests: [manifest], decision: { ...valid, budget: value.decision.budget },
    })).toThrow(/exemption/u)
  })

  test('rejects mismatched manifest provenance and missing deciding verifier after rehash', () => {
    const value = context()
    for (const patch of [{ planRef: ref('other') }, { suiteRef: ref('other') }, { verifier: null }, { verifier: identity('other-verifier') }]) {
      const manifest = api.parseResolvedExecutionManifest({ ...value.manifests[0], ...patch })
      const manifestRefs = [contractRef(manifest)]
      expect(() => api.validateEvalDecisionContext({
        ...value, manifests: [manifest],
        decision: { ...value.decision, manifestRefs, verifier: { ...value.decision.verifier!, manifestRefs } },
      })).toThrow()
    }
  })

  test('preserves JSON facts in Markdown even when identifiers contain fence delimiters', () => {
    const value = context()
    const changed = { ...value, decision: { ...value.decision, id: 'gate````identifier' } }
    const markdown = api.formatEvalDecisionMarkdown(changed)
    expect(markdown).toContain('`````json\n')
    expect(markdown).toContain(api.formatEvalDecisionJson(changed))
  })

  test('records a pre-execution refusal without manufacturing a manifest', () => {
    const value = context()
    const decision = {
      ...value.decision, decision: 'block', reasonCode: 'budget-exhausted', manifestRefs: [], verifier: null,
      budget: { ...value.decision.budget, status: 'exhausted' },
      evidenceIntegrity: { status: 'missing', receiptRef: null },
    }
    expect(api.validateEvalDecisionContext({ ...value, manifests: [], decision }).manifests).toEqual([])
    expect(() => api.parseEvalGateDecision({
      ...value.decision, manifestRefs: [], verifier: { ...value.decision.verifier!, manifestRefs: [] },
    })).toThrow(/manifest/u)
  })

  test('rejects one verifier execution identity carrying different observed configurations', () => {
    const value = context()
    const second = api.parseResolvedExecutionManifest({
      ...value.manifests[0], id: 'second', cell: { ...value.manifests[0]!.cell, attempt: 2 },
      verifier: { ...identity('verifier'), configDigest: 'e'.repeat(64) },
    })
    const manifestRefs = [contractRef(value.manifests[0]!), contractRef(second)]
    expect(() => api.validateEvalDecisionContext({
      ...value, manifests: [value.manifests[0], second],
      decision: { ...value.decision, manifestRefs, verifier: { ...value.decision.verifier!, manifestRefs } },
    })).toThrow(/execution identity/u)
  })
})
