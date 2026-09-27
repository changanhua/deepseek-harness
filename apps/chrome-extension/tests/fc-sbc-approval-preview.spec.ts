import { describe, expect, test } from 'vitest'
import { createSbcApprovalPreview } from '../src/fc-sbc-approval-preview.js'

const now = new Date('2026-09-25T06:30:00.000Z').getTime()

const plan = {
  fcYear: 'FC27',
  platform: 'pc',
  groupId: 'marquee',
  planId: 'plan-a',
  purchaseCount: 2,
  maxSpend: 1400,
  opportunityCost: 0,
  challenges: [
    { challengeId: 'one', candidateId: 'one-a', purchaseCount: 1, maxSpend: 500, opportunityCost: 0, score: 0,
      cards: [{ kind: 'purchase', cardVersionId: 'buy-a', planPurchaseId: 'p-a', maxPrice: 500 }] },
    { challengeId: 'two', candidateId: 'two-a', purchaseCount: 1, maxSpend: 900, opportunityCost: 0, score: 0,
      cards: [{ kind: 'purchase', cardVersionId: 'buy-b', planPurchaseId: 'p-b', maxPrice: 900 }] },
  ],
} as const

const executionDryRun = {
  schemaVersion: 1,
  kind: 'fc-sbc-execution-dry-run',
  status: 'ready',
  issues: [],
  summary: { planId: 'plan-a', groupId: 'marquee', platform: 'pc', purchaseCount: 2, submitCount: 1,
    maxSpend: 1400, reservedIfStarted: 1400, maxMarketSearches: 20, maxSearchesPerPurchase: 2 },
  purchaseQueue: [
    { order: 1, challengeId: 'two', planPurchaseId: 'p-b', cardVersionId: 'buy-b', maxPrice: 900, maxSearches: 2 },
    { order: 2, challengeId: 'one', planPurchaseId: 'p-a', cardVersionId: 'buy-a', maxPrice: 500, maxSearches: 2 },
  ],
  submitQueue: [{ order: 1, challengeId: 'one' }],
  sideEffects: { browserWrites: false, purchases: false, squadFill: false, submits: false },
} as const

const riskPreflight = {
  schemaVersion: 1,
  kind: 'fc-sbc-risk-preflight',
  status: 'caution',
  disclaimer: '该预检只量化自动化暴露量，不能证明不会封禁。',
  issues: [{ code: 'automation-exposure-nonzero', detail: '2 purchases, 1 submits' }],
  summary: { purchaseCount: 2, submitCount: 1, plannedSearches: 4, maxSearchesPerPurchase: 2,
    maxPurchases: 12, maxSubmits: 4, maxTotalSearches: 20, marketAccess: 'visible', unknownTransactionCount: 0 },
  sideEffects: { browserWrites: false, purchases: false, submits: false },
} as const

const ready = { status: 'ready-for-approval', canApproveExecution: true, blockers: [] } as const
const identity = {
  sessionId: 'session-1',
  installationId: 'install-1',
  grantEpoch: 4,
  tabId: 7,
  frameId: 0,
  documentId: 'doc-a',
  clubId: 'club-a',
  pageCapturedAt: '2026-09-25T06:20:00.000Z',
  inventoryCapturedAt: '2026-09-25T06:25:00.000Z',
} as const

const codes = (rows: readonly { readonly code: string }[]) => rows.map(row => row.code)

describe('FC SBC 批准预览', () => {
  test('把方案、预算、提交范围和有效期汇成无副作用的可审阅批准包', () => {
    const preview = createSbcApprovalPreview({
      readiness: ready,
      plan,
      executionDryRun,
      riskPreflight,
      now,
      identity,
      submitChallengeIds: ['one'],
    })

    expect(preview.status).toBe('ready')
    expect(preview.identity).toEqual(identity)
    expect(preview.reviewDigest).toMatch(/^[0-9a-f]{8}$/u)
    expect(preview.summary).toMatchObject({
      planId: 'plan-a',
      groupId: 'marquee',
      platform: 'pc',
      purchaseCount: 2,
      submitCount: 1,
      maxSpend: 1400,
      reservedIfStarted: 1400,
      plannedSearches: 4,
      riskStatus: 'caution',
    })
    expect(preview.scope.purchaseScope).toEqual([
      { challengeId: 'one', planPurchaseId: 'p-a', cardVersionId: 'buy-a', maxPrice: 500 },
      { challengeId: 'two', planPurchaseId: 'p-b', cardVersionId: 'buy-b', maxPrice: 900 },
    ])
    expect(preview.scope.submitChallengeIds).toEqual(['one'])
    expect(preview.approvalWindow).toEqual({
      approvedAt: now,
      startBy: now + 600_000,
      expiresAt: now + 3_600_000,
      startWithinMs: 600_000,
      expiresInMs: 3_600_000,
    })
    expect(preview.requiredBindings).toEqual({ session: true, installation: true, tab: true, club: true })
    expect(preview.sideEffects).toEqual({ browserWrites: false, purchases: false, squadFill: false, submits: false })
    expect(preview.notice).toContain('只生成批准预览')

    const changedSubmit = createSbcApprovalPreview({
      readiness: ready,
      plan,
      executionDryRun,
      riskPreflight,
      now,
      identity,
      submitChallengeIds: ['two'],
    })
    const changedDocument = createSbcApprovalPreview({
      readiness: ready,
      plan,
      executionDryRun,
      riskPreflight,
      now,
      identity: { ...identity, documentId: 'doc-b' },
      submitChallengeIds: ['one'],
    })
    expect(changedSubmit.reviewDigest).not.toBe(preview.reviewDigest)
    expect(changedDocument.reviewDigest).not.toBe(preview.reviewDigest)
  })

  test('readiness、执行预演或风险预检任一阻塞时不生成 ready 批准', () => {
    const preview = createSbcApprovalPreview({
      readiness: { status: 'draft-only', canApproveExecution: false, blockers: [{ code: 'inventory-visible-only' }] },
      plan,
      executionDryRun: { ...executionDryRun, status: 'blocked', issues: [{ code: 'budget-exceeded', detail: 'too high' }] },
      riskPreflight: { ...riskPreflight, status: 'blocked', issues: [{ code: 'market-access-unverified', detail: 'unknown' }] },
      now,
      submitChallengeIds: ['one'],
    })

    expect(preview.status).toBe('blocked')
    expect(codes(preview.issues)).toEqual([
      'readiness-not-approvable',
      'execution-dry-run-blocked',
      'risk-preflight-blocked',
    ])
  })

  test('提交范围必须属于当前方案，批准窗口必须有限且有效', () => {
    const preview = createSbcApprovalPreview({
      readiness: ready,
      plan,
      executionDryRun,
      riskPreflight,
      now,
      startWithinMs: 0,
      expiresInMs: 3_600_000,
      submitChallengeIds: ['missing'],
    })

    expect(preview.status).toBe('blocked')
    expect(codes(preview.issues)).toContain('approval-window-invalid')
    expect(codes(preview.issues)).toContain('submit-scope-invalid')
  })
})
