import { describe, expect, test } from 'vitest'
import { createSbcInventorySnapshot } from '../src/fc-sbc-inventory-snapshot.js'
import { createSbcReadinessReport } from '../src/fc-sbc-readiness.js'
import { createSbcTransactionReadback } from '../src/fc-sbc-transaction-readback.js'

const now = new Date('2026-09-25T06:20:00.000Z').getTime()
const puzzleProbe = {
  url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/',
  title: 'FC',
  capturedAt: '2026-09-25T06:20:00.000Z',
  supported: true,
  taskType: 'puzzle',
  marketAccess: { status: 'visible', evidence: ['transfer-market-visible'] },
  challengeSet: { title: 'Marquee Matchups', visibleChallengeCount: 1, challenges: [] },
  inventory: { coverage: 'visible-only', sbcStorageVisible: false, visibleCards: [] },
  warnings: [],
}
const planInput = {
  now,
  fcYear: 'FC27',
  platform: 'pc',
  groupId: 'marquee',
  inventory: [{ instanceId: 'owned-a', cardVersionId: 'gold-a' }],
  quotes: [{ platform: 'pc', cardVersionId: 'buy-a', price: 700, source: 'fixture', observedAt: now, validUntil: now + 300_000 }],
  challenges: [{ challengeId: 'one', slotCount: 2, candidates: [
    { cards: [{ instanceId: 'owned-a' }, { cardVersionId: 'buy-a', planPurchaseId: 'p-a' }] },
  ] }],
}
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

describe('FC SBC readiness comb', () => {
  test('real Web App login screen asks for sign-in before task interpretation', () => {
    const report = createSbcReadinessReport({
      probe: { ...puzzleProbe, loginRequired: true, supported: false, taskType: 'unknown',
        inventory: { ...puzzleProbe.inventory, coverage: 'unread' } },
    })

    expect(report.status).toBe('blocked')
    expect(report.canApproveExecution).toBe(false)
    expect(codes(report.blockers)).toContain('login-required')
    expect(codes(report.blockers)).not.toContain('unsupported-page')
    expect(report.nextAction).toBe('sign-in-to-fc-web-app')
  })

  test('keeps a plan draft when inventory is only visible, and records the deferred adapter gap', () => {
    const report = createSbcReadinessReport({ probe: puzzleProbe, planInput })

    expect(report.status).toBe('draft-only')
    expect(report.canApproveExecution).toBe(false)
    expect(codes(report.blockers)).toContain('inventory-visible-only')
    expect(codes(report.deferred)).toContain('complete-inventory-adapter')
    expect(report.summary).toMatchObject({ taskType: 'puzzle', marketAccess: 'visible', variantCount: 1 })
    expect(report.summary.fieldCoverage.partial).toBeGreaterThan(0)
    expect(report.summary.quoteCoverage).toMatchObject({ neededCardVersions: 1, freshQuotes: 1, missingQuotes: 0 })
    expect(report.executionDryRun?.summary).toMatchObject({ purchaseCount: 1, reservedIfStarted: 700 })
    expect(report.executionDryRun?.sideEffects.purchases).toBe(false)
    expect(report.riskPreflight?.summary).toMatchObject({ purchaseCount: 1, plannedSearches: 2, marketAccess: 'visible' })
    expect(report.summary.riskExposure).toMatchObject({ status: 'caution', plannedSearches: 2 })
    expect(codes(report.fieldAudit.gaps)).toContain('inventory-coverage')
    expect(report.summary.purchaseRange).toEqual({ min: 1, max: 1 })
  })

  test('allows approval only when page, inventory, market and solver inputs all clear the gate', () => {
    const report = createSbcReadinessReport({
      probe: { ...puzzleProbe, inventory: { ...puzzleProbe.inventory, coverage: 'complete' } },
      planInput,
      now,
      identity,
      submitChallengeIds: ['one'],
    })

    expect(report).toMatchObject({ status: 'ready-for-approval', canApproveExecution: true, nextAction: 'review-plan' })
    expect(report.blockers).toEqual([])
    expect(report.approvalPreview?.status).toBe('ready')
    expect(report.approvalPreview?.identity).toEqual(identity)
    expect(report.approvalPreview?.reviewDigest).toMatch(/^[0-9a-f]{8}$/u)
    expect(report.approvalPreview?.summary).toMatchObject({ purchaseCount: 1, submitCount: 1, maxSpend: 700 })
    expect(report.summary.approvalPreview).toMatchObject({ status: 'ready', submitCount: 1, maxSpend: 700,
      reviewDigest: report.approvalPreview?.reviewDigest })
  })

  test('uses a complete inventory snapshot to clear the visible-only page inventory blocker', () => {
    const inventorySnapshot = createSbcInventorySnapshot({
      coverage: 'complete',
      cards: [{ instanceId: 'owned-a', cardVersionId: 'gold-a', source: 'club' }],
    })
    const report = createSbcReadinessReport({
      probe: puzzleProbe,
      inventorySnapshot,
      planInput: { ...planInput, inventory: inventorySnapshot.solverInventory },
    })

    expect(report.status).toBe('ready-for-approval')
    expect(report.summary.inventoryCoverage).toBe('complete')
    expect(report.summary.inventorySnapshot).toMatchObject({ cardCount: 1, clubCount: 1, sbcStorageCount: 0 })
    expect(codes(report.blockers)).not.toContain('inventory-visible-only')
  })

  test('carries transaction readback into field coverage and redacted summary inputs', () => {
    const transactionReadback = createSbcTransactionReadback({
      purchase: { requestId: 'buy-1', planPurchaseId: 'p-a', cardVersionId: 'buy-a', maxPrice: 700,
        acquiredCards: [{ instanceId: 'private-buy-a', cardVersionId: 'buy-a', actualPrice: 650 }] },
      submission: { requestId: 'submit-1', challengeId: 'one', completedBefore: false, completedAfter: true,
        cardCountBefore: 1200, cardCountAfter: 1189 },
    })
    const report = createSbcReadinessReport({
      probe: { ...puzzleProbe, inventory: { ...puzzleProbe.inventory, coverage: 'complete' } },
      planInput,
      transactionReadback,
    })

    expect(report.summary.transactionReadback).toMatchObject({ purchase: 'confirmed', submission: 'completed', issues: [] })
    expect(report.fieldAudit.fields.find(row => row.code === 'purchase-result-readback')).toMatchObject({ status: 'covered' })
    expect(report.fieldAudit.fields.find(row => row.code === 'submission-result-readback')).toMatchObject({ status: 'covered' })
  })

  test('blocks approval when purchase candidates lack fresh same-platform quotes', () => {
    const report = createSbcReadinessReport({
      probe: { ...puzzleProbe, inventory: { ...puzzleProbe.inventory, coverage: 'complete' } },
      planInput: { ...planInput, quotes: [] },
    })

    expect(report.status).toBe('blocked')
    expect(codes(report.blockers)).toContain('quote-missing')
    expect(codes(report.deferred)).toContain('refresh-quotes-before-approval')
    expect(report.nextAction).toBe('refresh-quotes')
    expect(report.summary.quoteCoverage).toMatchObject({ neededCardVersions: 1, missingQuotes: 1 })
  })

  test('blocks purchases before approval when market access is unavailable or unverified', () => {
    const blocked = createSbcReadinessReport({
      probe: { ...puzzleProbe, marketAccess: { status: 'blocked', evidence: ['blocked-text'] },
        inventory: { ...puzzleProbe.inventory, coverage: 'complete' } },
      planInput,
    })
    const unknown = createSbcReadinessReport({
      probe: { ...puzzleProbe, marketAccess: { status: 'unknown', evidence: [] },
        inventory: { ...puzzleProbe.inventory, coverage: 'complete' } },
      planInput,
    })

    expect(codes(blocked.blockers)).toContain('market-access-blocked')
    expect(blocked.nextAction).toBe('stop-purchase-flow')
    expect(codes(unknown.blockers)).toContain('market-access-unverified')
    expect(unknown.nextAction).toBe('verify-market-access')
  })

  test('keeps final approval closed when risk exposure preflight is blocked', () => {
    const report = createSbcReadinessReport({
      probe: { ...puzzleProbe, inventory: { ...puzzleProbe.inventory, coverage: 'complete' } },
      planInput,
      maxPurchases: 0,
    })

    expect(report.canApproveExecution).toBe(false)
    expect(report.status).toBe('draft-only')
    expect(codes(report.blockers)).toContain('risk-preflight-blocked')
    expect(report.riskPreflight?.status).toBe('blocked')
    expect(report.approvalPreview?.status).toBe('blocked')
  })

  test('routes item score SBCs to the deferred executor instead of puzzle approval', () => {
    const report = createSbcReadinessReport({
      probe: { ...puzzleProbe, taskType: 'item-score', warnings: ['item-score-sbc-requires-separate-executor'],
        inventory: { ...puzzleProbe.inventory, coverage: 'complete' } },
      planInput,
    })

    expect(report.status).toBe('draft-only')
    expect(codes(report.blockers)).toContain('unsupported-task-type')
    expect(codes(report.deferred)).toContain('item-score-executor-deferred')
    expect(report.warnings).toContain('item-score-sbc-requires-separate-executor')
  })

  test('records invalid solver input without throwing through the runtime boundary', () => {
    const report = createSbcReadinessReport({
      probe: { ...puzzleProbe, inventory: { ...puzzleProbe.inventory, coverage: 'complete' } },
      planInput: { ...planInput, platform: '' },
    })

    expect(report.status).toBe('blocked')
    expect(codes(report.blockers)).toContain('plan-input-invalid')
    expect(report.summary.planError).toBeTruthy()
  })
})
