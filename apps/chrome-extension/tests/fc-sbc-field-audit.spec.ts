import { describe, expect, test } from 'vitest'
import { createSbcFieldAudit } from '../src/fc-sbc-field-audit.js'
import { createSbcInventorySnapshot } from '../src/fc-sbc-inventory-snapshot.js'
import { createSbcTransactionReadback } from '../src/fc-sbc-transaction-readback.js'

const probe = {
  url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/',
  title: 'FC Web App',
  capturedAt: '2026-09-25T06:20:00.000Z',
  supported: true,
  taskType: 'puzzle',
  marketAccess: { status: 'visible', evidence: ['transfer-market-visible'] },
  challengeSet: { title: 'Marquee Matchups', visibleChallengeCount: 1, challenges: [{
    challengeId: 'challenge-a',
    title: 'Marquee Matchups',
    completed: false,
    requirementLines: ['Min. 2 Clubs'],
    rewardLines: ['Gold Pack'],
    textSample: 'raw challenge text',
  }] },
  inventory: { coverage: 'visible-only', sbcStorageVisible: false, visibleCards: [{
    visibleId: 'visible-card-a',
    instanceId: 'private-card-instance',
    rating: 82,
    locked: false,
    textSample: 'private card text',
  }] },
  warnings: [],
}

const codes = (rows: readonly { readonly code: string }[]) => rows.map(row => row.code)

describe('FC SBC 字段覆盖审计', () => {
  test('把当前可见页面样本和后续缺口分开标注', () => {
    const audit = createSbcFieldAudit({ probe })

    expect(audit.status).toBe('needs-samples')
    expect(audit.summary.covered).toBeGreaterThan(0)
    expect(codes(audit.gaps)).toContain('inventory-coverage')
    expect(codes(audit.gaps)).toContain('purchase-result-readback')
    expect(codes(audit.gaps)).toContain('submission-result-readback')
    expect(audit.fields.find(row => row.code === 'requirement-lines')).toMatchObject({ status: 'covered' })
    expect(audit.fields.find(row => row.code === 'visible-card-count')).toMatchObject({ status: 'partial' })
  })

  test('完整库存和交易读回同时存在时，对应字段才算 covered', () => {
    const transactionReadback = createSbcTransactionReadback({
      purchase: { requestId: 'buy-1', planPurchaseId: 'p-a', cardVersionId: 'gold-a', maxPrice: 700,
        acquiredCards: [{ instanceId: 'private-buy-a', cardVersionId: 'gold-a', actualPrice: 650 }] },
      submission: { requestId: 'submit-1', challengeId: 'challenge-a', completedBefore: false, completedAfter: true,
        cardCountBefore: 1200, cardCountAfter: 1189 },
    })
    const audit = createSbcFieldAudit({
      probe: { ...probe, inventory: { ...probe.inventory, coverage: 'complete', sbcStorageVisible: true } },
      transactionReadback,
    })

    expect(audit.fields.find(row => row.code === 'inventory-coverage')).toMatchObject({ status: 'covered' })
    expect(audit.fields.find(row => row.code === 'sbc-storage-visibility')).toMatchObject({ status: 'covered' })
    expect(audit.fields.find(row => row.code === 'purchase-result-readback')).toMatchObject({ status: 'covered' })
    expect(audit.fields.find(row => row.code === 'submission-result-readback')).toMatchObject({ status: 'covered' })
  })

  test('完整库存快照能补齐页面可见库存无法证明的实例与 Storage 覆盖', () => {
    const inventorySnapshot = createSbcInventorySnapshot({
      coverage: 'complete',
      cards: [
        { instanceId: 'club-a', cardVersionId: 'gold-a', source: 'club', rating: 84 },
        { instanceId: 'storage-a', cardVersionId: 'gold-b', source: 'sbc-storage', rating: 82 },
      ],
    })
    const audit = createSbcFieldAudit({ probe, inventorySnapshot })

    expect(audit.fields.find(row => row.code === 'inventory-coverage')).toMatchObject({ status: 'covered' })
    expect(audit.fields.find(row => row.code === 'sbc-storage-visibility')).toMatchObject({ status: 'covered' })
    expect(audit.fields.find(row => row.code === 'card-instance-ids')).toMatchObject({ status: 'covered' })
    expect(audit.fields.find(row => row.code === 'card-ratings')).toMatchObject({ status: 'covered' })
  })
})
