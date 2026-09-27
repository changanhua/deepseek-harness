import { describe, expect, test } from 'vitest'
import { createSbcExecutionDryRun } from '../src/fc-sbc-execution-dry-run.js'

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
}

const approval = {
  approvalId: 'approval-a',
  planId: 'plan-a',
  groupId: 'marquee',
  platform: 'pc',
  approvedAt: 1,
  startBy: 2,
  expiresAt: 3,
  sessionId: 'session',
  installationId: 'install',
  tabId: 7,
  clubId: 'club',
  maxSpend: 1400,
  submitChallengeIds: ['one'],
  purchaseScope: [
    { challengeId: 'one', planPurchaseId: 'p-a', cardVersionId: 'buy-a', maxPrice: 500 },
    { challengeId: 'two', planPurchaseId: 'p-b', cardVersionId: 'buy-b', maxPrice: 900 },
  ],
}

const codes = (rows: readonly { readonly code: string }[]) => rows.map(row => row.code)

describe('FC SBC 执行 dry-run', () => {
  test('生成无副作用的购买和提交预演队列', () => {
    const dryRun = createSbcExecutionDryRun({ plan, approval, maxMarketSearches: 4, maxSearchesPerPurchase: 2 })

    expect(dryRun.status).toBe('ready')
    expect(dryRun.summary).toMatchObject({ purchaseCount: 2, submitCount: 1, maxSpend: 1400, reservedIfStarted: 1400 })
    expect(dryRun.purchaseQueue.map(row => row.planPurchaseId)).toEqual(['p-b', 'p-a'])
    expect(dryRun.purchaseQueue.every(row => row.maxSearches === 2)).toBe(true)
    expect(dryRun.submitQueue).toEqual([{ order: 1, challengeId: 'one' }])
    expect(dryRun.sideEffects).toEqual({ browserWrites: false, purchases: false, squadFill: false, submits: false })
  })

  test('预算或市场搜索量超限时保持 blocked', () => {
    const dryRun = createSbcExecutionDryRun({ plan, approval: { ...approval, maxSpend: 1000 }, maxMarketSearches: 1 })

    expect(dryRun.status).toBe('blocked')
    expect(codes(dryRun.issues)).toContain('budget-exceeded')
    expect(codes(dryRun.issues)).toContain('market-search-limit')
  })

  test('无采购方案仍可表达 no-purchases 且不触发副作用', () => {
    const dryRun = createSbcExecutionDryRun({ plan: { ...plan, maxSpend: 0, challenges: [] } })

    expect(dryRun.status).toBe('no-purchases')
    expect(dryRun.purchaseQueue).toEqual([])
    expect(dryRun.sideEffects.purchases).toBe(false)
  })
})
