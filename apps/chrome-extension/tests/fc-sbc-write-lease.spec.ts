import { describe, expect, test } from 'vitest'
import { createSbcWriteLease, releaseSbcWriteLease, validateSbcWriteLease } from '../src/fc-sbc-write-lease.js'

const now = new Date('2026-09-25T07:15:00.000Z').getTime()
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

const codes = (rows: readonly { readonly code: string }[]) => rows.map(row => row.code)

describe('FC SBC 写租约合同', () => {
  test('为同一批准预览签发有期限且无副作用的写租约', () => {
    const lease = createSbcWriteLease({
      approvalPreview,
      now,
      ttlMs: 120_000,
      purpose: 'fc-sbc-execution',
    })

    expect(lease.status).toBe('active')
    expect(lease.leaseId).toMatch(/^[0-9a-f]{8}$/u)
    expect(lease.reviewDigest).toBe('abc123ef')
    expect(lease.identity).toEqual(identity)
    expect(lease.acquiredAt).toBe(now)
    expect(lease.expiresAt).toBe(now + 120_000)
    expect(lease.sideEffects).toEqual({ browserWrites: false, purchases: false, squadFill: false, submits: false })

    const validation = validateSbcWriteLease({
      lease,
      expectedReviewDigest: 'abc123ef',
      currentIdentity: identity,
      now,
      purpose: 'fc-sbc-execution',
    })
    expect(validation.status).toBe('valid')
    expect(validation.issues).toEqual([])
  })

  test('摘要、页面身份、用途或过期任一不匹配都会阻塞租约', () => {
    const lease = createSbcWriteLease({ approvalPreview, now, ttlMs: 120_000, purpose: 'fc-sbc-execution' })
    const validation = validateSbcWriteLease({
      lease,
      expectedReviewDigest: 'changed',
      currentIdentity: { ...identity, documentId: 'doc-b' },
      now: now + 121_000,
      purpose: 'other-purpose',
    })

    expect(validation.status).toBe('blocked')
    expect(codes(validation.issues)).toEqual([
      'write-lease-digest-mismatch',
      'write-lease-identity-mismatch',
      'write-lease-purpose-mismatch',
      'write-lease-expired',
    ])
  })

  test('释放后的租约不能再被执行 gate 当成有效写权限', () => {
    const lease = createSbcWriteLease({ approvalPreview, now, ttlMs: 120_000, purpose: 'fc-sbc-execution' })
    const released = releaseSbcWriteLease({ lease, now: now + 30_000, reason: 'stop-requested' })
    const validation = validateSbcWriteLease({
      lease: released,
      expectedReviewDigest: 'abc123ef',
      currentIdentity: identity,
      now: now + 31_000,
      purpose: 'fc-sbc-execution',
    })

    expect(released.status).toBe('released')
    expect(released.releasedAt).toBe(now + 30_000)
    expect(released.releaseReason).toBe('stop-requested')
    expect(validation.status).toBe('blocked')
    expect(codes(validation.issues)).toEqual(['write-lease-released'])
  })
})
