import { describe, expect, test } from 'vitest'
import { createSbcTransactionReadback } from '../src/fc-sbc-transaction-readback.js'

const codes = (rows: readonly { readonly code: string }[]) => rows.map(row => row.code)

describe('FC SBC 交易读回合同', () => {
  test('购买只有在读到同版本新增卡且实际价格不超上限时才算 confirmed', () => {
    const readback = createSbcTransactionReadback({
      purchase: {
        requestId: 'buy-1',
        planPurchaseId: 'p-a',
        cardVersionId: 'gold-a',
        maxPrice: 700,
        observedAt: '2026-09-25T07:15:00.000Z',
        acquiredCards: [{ instanceId: 'private-instance-a', cardVersionId: 'gold-a', actualPrice: 650 }],
        balanceBefore: 10_000,
        balanceAfter: 9_350,
      },
    })

    expect(readback.purchase).toMatchObject({
      status: 'confirmed',
      requestId: 'buy-1',
      planPurchaseId: 'p-a',
      cardVersionId: 'gold-a',
      actualPrice: 650,
    })
    expect(readback.summary).toMatchObject({ purchase: 'confirmed', submission: 'not-run' })
    expect(readback.sideEffects).toEqual({ browserWrites: false, purchases: false, submits: false })
    expect(JSON.stringify(readback)).not.toContain('private-instance-a')
  })

  test('超价或版本错配的购买读回保持 blocked，不能当作成交', () => {
    const readback = createSbcTransactionReadback({
      purchase: {
        requestId: 'buy-2',
        planPurchaseId: 'p-b',
        cardVersionId: 'gold-b',
        maxPrice: 700,
        acquiredCards: [{ instanceId: 'private-instance-b', cardVersionId: 'gold-c', actualPrice: 750 }],
      },
    })

    expect(readback.purchase?.status).toBe('blocked')
    expect(codes(readback.issues)).toContain('purchase-version-mismatch')
    expect(codes(readback.issues)).toContain('purchase-price-over-limit')
  })

  test('提交必须同时读到关卡完成和卡池变化才算 completed', () => {
    const completed = createSbcTransactionReadback({
      submission: {
        requestId: 'submit-1',
        challengeId: 'challenge-a',
        completedBefore: false,
        completedAfter: true,
        cardCountBefore: 1200,
        cardCountAfter: 1189,
      },
    })
    const unverified = createSbcTransactionReadback({
      submission: {
        requestId: 'submit-2',
        challengeId: 'challenge-b',
        completedBefore: false,
        completedAfter: true,
        cardCountBefore: 1200,
        cardCountAfter: 1200,
      },
    })

    expect(completed.submission).toMatchObject({ status: 'completed', challengeId: 'challenge-a' })
    expect(unverified.submission?.status).toBe('unknown')
    expect(codes(unverified.issues)).toContain('submission-cardpool-unverified')
  })
})
