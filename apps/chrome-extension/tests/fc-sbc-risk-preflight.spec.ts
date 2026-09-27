import { describe, expect, test } from 'vitest'
import { createSbcRiskPreflight } from '../src/fc-sbc-risk-preflight.js'

const dryRun = {
  schemaVersion: 1,
  kind: 'fc-sbc-execution-dry-run',
  status: 'ready',
  issues: [],
  summary: { planId: 'plan-a', groupId: 'marquee', platform: 'pc', purchaseCount: 4, submitCount: 2,
    maxSpend: 2600, reservedIfStarted: 2600, maxMarketSearches: 20, maxSearchesPerPurchase: 2 },
  purchaseQueue: [
    { order: 1, challengeId: 'a', planPurchaseId: 'p-a', cardVersionId: 'gold-a', maxPrice: 700, maxSearches: 2 },
    { order: 2, challengeId: 'a', planPurchaseId: 'p-b', cardVersionId: 'gold-b', maxPrice: 700, maxSearches: 2 },
    { order: 3, challengeId: 'b', planPurchaseId: 'p-c', cardVersionId: 'gold-c', maxPrice: 600, maxSearches: 2 },
    { order: 4, challengeId: 'b', planPurchaseId: 'p-d', cardVersionId: 'gold-d', maxPrice: 600, maxSearches: 2 },
  ],
  submitQueue: [{ order: 1, challengeId: 'a' }, { order: 2, challengeId: 'b' }],
  sideEffects: { browserWrites: false, purchases: false, squadFill: false, submits: false },
} as const

const codes = (rows: readonly { readonly code: string }[]) => rows.map(row => row.code)

describe('FC SBC 风险暴露预检', () => {
  test('量化购买、搜索和提交暴露量，但不宣称防封', () => {
    const report = createSbcRiskPreflight({ executionDryRun: dryRun, marketAccess: 'visible' })

    expect(report.status).toBe('caution')
    expect(report.summary).toMatchObject({
      purchaseCount: 4,
      submitCount: 2,
      plannedSearches: 8,
      maxSearchesPerPurchase: 2,
      maxTotalSearches: 20,
      unknownTransactionCount: 0,
    })
    expect(codes(report.issues)).toContain('automation-exposure-nonzero')
    expect(report.sideEffects).toEqual({ browserWrites: false, purchases: false, submits: false })
    expect(report.disclaimer).toContain('未统计页面读取或内部服务调用风险')
    expect(report.disclaimer).toContain('不能证明不会封禁')
  })

  test('超过购买数或搜索总量上限时阻塞批准', () => {
    const report = createSbcRiskPreflight({
      executionDryRun: dryRun,
      marketAccess: 'visible',
      maxPurchases: 3,
      maxTotalSearches: 6,
    })

    expect(report.status).toBe('blocked')
    expect(codes(report.issues)).toContain('purchase-count-limit')
    expect(codes(report.issues)).toContain('market-search-exposure-limit')
  })

  test('需要采购但市场权限未验证时阻塞，未知交易读回保持 caution', () => {
    const report = createSbcRiskPreflight({
      executionDryRun: dryRun,
      marketAccess: 'unknown',
      transactionReadback: { summary: { purchase: 'unknown', submission: 'not-run', issueCount: 0 }, issues: [] },
    })

    expect(report.status).toBe('blocked')
    expect(codes(report.issues)).toContain('market-access-unverified')
    expect(codes(report.issues)).toContain('transaction-readback-unknown')
    expect(report.summary.unknownTransactionCount).toBe(1)
  })
})
