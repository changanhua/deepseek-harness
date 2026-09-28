import { describe, expect, test } from 'vitest'
import { createSbcQuotePreflight } from '../src/fc-sbc-quote-preflight.js'

const now = new Date('2026-09-25T06:50:00.000Z').getTime()

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

const codes = (rows: readonly { readonly code: string }[]) => rows.map(row => row.code)

describe('FC SBC 报价预检', () => {
  test('同平台新鲜报价和市场搜索上界通过预检', () => {
    const report = createSbcQuotePreflight({
      planInput,
      variants: [{ purchaseCount: 1, maxSpend: 700 }],
      maxMarketSearches: 2,
    })

    expect(report.status).toBe('ready')
    expect(report.summary).toMatchObject({ neededCardVersions: 1, freshQuotes: 1, missingQuotes: 0 })
    expect(report.summary.purchaseRange).toEqual({ min: 1, max: 1 })
    expect(report.issues).toEqual([])
  })

  test('缺价、过期价、错平台和无效价都会成为批准前阻塞', () => {
    const report = createSbcQuotePreflight({
      planInput: { ...planInput, quotes: [
        { platform: 'xbox', cardVersionId: 'buy-a', price: 700, observedAt: now, validUntil: now + 300_000 },
        { platform: 'pc', cardVersionId: 'buy-b', price: 500, observedAt: now - 30 * 60 * 1000, validUntil: now + 300_000 },
        { platform: 'pc', cardVersionId: 'buy-c', price: 0, observedAt: now, validUntil: now + 300_000 },
      ], challenges: [{ challengeId: 'one', slotCount: 4, candidates: [
        { cards: [
          { cardVersionId: 'buy-a' },
          { cardVersionId: 'buy-b' },
          { cardVersionId: 'buy-c' },
          { cardVersionId: 'buy-d' },
        ] },
      ] }] },
    })

    expect(report.status).toBe('blocked')
    expect(codes(report.issues)).toEqual(expect.arrayContaining([
      'quote-platform-mismatch',
      'quote-stale',
      'quote-invalid',
      'quote-missing',
    ]))
    expect(report.summary).toMatchObject({ missingQuotes: 1, staleQuotes: 1, invalidQuotes: 1, mismatchedQuotes: 1 })
  })

  test('候选采购量超过市场搜索上界时阻塞', () => {
    const report = createSbcQuotePreflight({
      planInput,
      variants: [{ purchaseCount: 3, maxSpend: 2100 }],
      maxMarketSearches: 2,
    })

    expect(codes(report.issues)).toContain('market-search-limit')
  })
})
