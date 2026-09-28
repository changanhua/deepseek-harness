import { describe, expect, test } from 'vitest'
import { createSbcExecutionGate } from '../src/fc-sbc-execution-gate.js'

const now = new Date('2026-09-25T07:00:00.000Z').getTime()
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
const approvalPreview = {
  schemaVersion: 1,
  kind: 'fc-sbc-approval-preview',
  status: 'ready',
  reviewDigest: 'abc123ef',
  identity,
  notice: '只生成批准预览；不会购买、填阵或提交。',
  issues: [],
  approvalWindow: { approvedAt: now - 1_800_000, startBy: now + 300_000, expiresAt: now + 1_800_000,
    startWithinMs: 2_100_000, expiresInMs: 3_600_000 },
  requiredBindings: { session: true, installation: true, tab: true, club: true },
  scope: { planId: 'plan-a', groupId: 'marquee', platform: 'pc',
    purchaseScope: [{ challengeId: 'one', planPurchaseId: 'p-a', cardVersionId: 'buy-a', maxPrice: 700 }],
    submitChallengeIds: ['one'] },
  summary: { planId: 'plan-a', groupId: 'marquee', platform: 'pc', purchaseCount: 1, submitCount: 1,
    maxSpend: 700, reservedIfStarted: 700, plannedSearches: 2, riskStatus: 'caution',
    readinessStatus: 'ready-for-approval', executionStatus: 'ready' },
  sideEffects: { browserWrites: false, purchases: false, squadFill: false, submits: false },
} as const
const writeLease = { ...identity, acquiredAt: now - 1_000, expiresAt: now + 60_000, purpose: 'fc-sbc-execution' } as const

const codes = (rows: readonly { readonly code: string }[]) => rows.map(row => row.code)

describe('FC SBC 执行 gate', () => {
  test('同一批准摘要、身份和写租约匹配时，才允许批准范围内的购买动作进入执行队列', () => {
    const gate = createSbcExecutionGate({
      approvalPreview,
      expectedReviewDigest: 'abc123ef',
      currentIdentity: identity,
      writeLease,
      now,
      action: { kind: 'purchase', planPurchaseId: 'p-a', cardVersionId: 'buy-a', maxPrice: 650 },
    })

    expect(gate.status).toBe('ready')
    expect(gate.issues).toEqual([])
    expect(gate.summary).toMatchObject({
      action: 'purchase',
      reviewDigest: 'abc123ef',
      identityStatus: 'matched',
      writeLeaseStatus: 'valid',
    })
    expect(gate.scope).toMatchObject({ planId: 'plan-a', groupId: 'marquee', platform: 'pc' })
    expect(gate.sideEffects).toEqual({ browserWrites: false, purchases: false, squadFill: false, submits: false })
  })

  test('摘要、页面身份、租约或动作范围任一不匹配都会阻塞写动作', () => {
    const gate = createSbcExecutionGate({
      approvalPreview,
      expectedReviewDigest: 'changed',
      currentIdentity: { ...identity, documentId: 'doc-b' },
      writeLease: { ...writeLease, tabId: 8 },
      now,
      action: { kind: 'purchase', planPurchaseId: 'p-a', cardVersionId: 'buy-a', maxPrice: 800 },
    })

    expect(gate.status).toBe('blocked')
    expect(codes(gate.issues)).toEqual([
      'approval-digest-mismatch',
      'approval-identity-mismatch',
      'write-lease-mismatch',
      'purchase-price-over-preview-limit',
    ])
  })

  test('过期、未 ready 或未获批准的提交范围不能进入执行', () => {
    const gate = createSbcExecutionGate({
      approvalPreview: { ...approvalPreview, status: 'blocked' },
      expectedReviewDigest: 'abc123ef',
      currentIdentity: identity,
      writeLease: { ...writeLease, expiresAt: now - 1 },
      now: now + 2_000_000,
      action: { kind: 'submit', challengeId: 'two' },
    })

    expect(gate.status).toBe('blocked')
    expect(codes(gate.issues)).toEqual([
      'approval-preview-not-ready',
      'approval-expired',
      'write-lease-expired',
      'submit-not-approved',
    ])
  })

  test('已经释放的写租约不能继续放行购买动作', () => {
    const gate = createSbcExecutionGate({
      approvalPreview,
      expectedReviewDigest: 'abc123ef',
      currentIdentity: identity,
      writeLease: { ...writeLease, status: 'released', releasedAt: now + 10_000, releaseReason: 'stop-requested' },
      now,
      action: { kind: 'purchase', planPurchaseId: 'p-a', cardVersionId: 'buy-a', maxPrice: 650 },
    })

    expect(gate.status).toBe('blocked')
    expect(codes(gate.issues)).toEqual(['write-lease-released'])
    expect(gate.summary.writeLeaseStatus).toBe('released')
  })
})
