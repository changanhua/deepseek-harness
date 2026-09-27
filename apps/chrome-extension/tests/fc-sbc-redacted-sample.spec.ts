import { describe, expect, test } from 'vitest'
import { createSbcRedactedSample, formatSbcRedactedSample } from '../src/fc-sbc-redacted-sample.js'

describe('FC SBC 脱敏样本包', () => {
  test('输出机器可读的字段缺口样本，同时排除私有卡牌和原始 DOM 文本', () => {
    const sample = createSbcRedactedSample({
      generatedAt: '2026-09-25T06:45:00.000Z',
      page: { title: 'FC Web App', url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/?sid=secret', documentId: 'doc-a' },
      pageModel: { page: { tabId: 7, frameId: 0, documentId: 'doc-a',
        url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/?sid=secret' },
      observedAt: '2026-09-25T06:30:00.000Z', view: { kind: 'sbc-group', selectedChallenge: { title: 'Second Match', visibleIndex: 1 } },
      group: { title: 'Marquee Matchups', signature: 'internal-fingerprint', visibleChallengeCount: 2,
        observedDetailCount: 2, coverage: 'visible-rows-read', challenges: [
          { title: 'Marquee Matchups', visibleIndex: 0, completed: false,
            requirements: ['Min. 2 Clubs'], rewards: ['Gold Pack'], observedAt: '2026-09-25T06:20:00.000Z' },
          { title: 'Second Match', visibleIndex: 1, completed: false,
            requirements: ['Min. 3 Nations'], rewards: ['Silver Pack'], observedAt: '2026-09-25T06:30:00.000Z' },
        ] }, inventory: { coverage: 'visible-only', visibleCardCount: 1, sbcStorageVisible: true,
        observedAt: '2026-09-25T06:20:00.000Z' } },
      probe: {
        url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/?sid=secret',
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
          textSample: 'raw DOM challenge text',
        }] },
        inventory: { coverage: 'visible-only', sbcStorageVisible: true, visibleCards: [{
          visibleId: 'visible-card-1',
          instanceId: 'private-instance-id',
          rating: 91,
          locked: true,
          textSample: 'Mbappe private card text',
        }] },
        warnings: [],
      },
      readiness: {
        status: 'draft-only',
        canApproveExecution: false,
        nextAction: 'read-complete-inventory',
        blockers: [{ code: 'inventory-visible-only', source: 'inventory' }],
        deferred: [{ code: 'complete-inventory-adapter', source: 'inventory' }],
        warnings: [],
        variants: [],
        executionDryRun: {
          schemaVersion: 1,
          kind: 'fc-sbc-execution-dry-run',
          status: 'ready',
          issues: [],
          summary: { planId: 'plan-a', groupId: 'marquee', platform: 'pc', purchaseCount: 1, submitCount: 0,
            maxSpend: 700, reservedIfStarted: 700, maxMarketSearches: 20, maxSearchesPerPurchase: 2 },
          purchaseQueue: [{ order: 1, challengeId: 'challenge-a', planPurchaseId: 'p-a', cardVersionId: 'buy-a',
            maxPrice: 700, maxSearches: 2 }],
          submitQueue: [],
          sideEffects: { browserWrites: false, purchases: false, squadFill: false, submits: false },
        },
        riskPreflight: {
          schemaVersion: 1,
          kind: 'fc-sbc-risk-preflight',
          status: 'caution',
          disclaimer: '该预检只量化自动化暴露量，不能证明不会封禁。',
          issues: [{ code: 'automation-exposure-nonzero', detail: '1 purchases, 0 submits' }],
          summary: { purchaseCount: 1, submitCount: 0, plannedSearches: 2, maxSearchesPerPurchase: 2,
            maxPurchases: 12, maxSubmits: 4, maxTotalSearches: 20, marketAccess: 'visible', unknownTransactionCount: 0 },
          sideEffects: { browserWrites: false, purchases: false, submits: false },
        },
        approvalPreview: {
          schemaVersion: 1,
          kind: 'fc-sbc-approval-preview',
          status: 'ready',
          reviewDigest: 'abc123ef',
          identity: { sessionId: 'session-1', installationId: 'install-1', grantEpoch: 4, tabId: 7,
            frameId: 0, documentId: 'doc-a', clubId: 'club-a', pageCapturedAt: '2026-09-25T06:20:00.000Z',
            inventoryCapturedAt: '2026-09-25T06:25:00.000Z' },
          notice: '只生成批准预览；不会购买、填阵或提交。',
          issues: [],
          approvalWindow: { approvedAt: 1, startBy: 601, expiresAt: 3601, startWithinMs: 600, expiresInMs: 3600 },
          requiredBindings: { session: true, installation: true, tab: true, club: true },
          scope: { planId: 'plan-a', groupId: 'marquee', platform: 'pc',
            purchaseScope: [{ challengeId: 'challenge-a', planPurchaseId: 'p-a', cardVersionId: 'buy-a', maxPrice: 700 }],
            submitChallengeIds: ['challenge-a'] },
          summary: { planId: 'plan-a', groupId: 'marquee', platform: 'pc', purchaseCount: 1, submitCount: 1,
            maxSpend: 700, reservedIfStarted: 700, plannedSearches: 2, riskStatus: 'caution',
            readinessStatus: 'ready-for-approval', executionStatus: 'ready' },
          sideEffects: { browserWrites: false, purchases: false, squadFill: false, submits: false },
        },
        summary: {
          taskType: 'puzzle',
          marketAccess: 'visible',
          inventoryCoverage: 'visible-only',
          visibleChallengeCount: 1,
          variantCount: 0,
          purchaseRange: null,
          maxSpendRange: null,
          planError: null,
          fieldCoverage: { covered: 10, partial: 4, missing: 5 },
          inventorySnapshot: { coverage: 'complete', cardCount: 42, clubCount: 40, sbcStorageCount: 2,
            visibleCount: 0, lockedCount: 3, tradeableCount: 9, duplicateInstanceCount: 0,
            invalidRowCount: 0, uniqueCardVersionCount: 30 },
          transactionReadback: { purchase: 'confirmed', submission: 'unknown', issues: ['submission-cardpool-unverified'] },
          quoteCoverage: { neededCardVersions: 1, freshQuotes: 1, missingQuotes: 0, staleQuotes: 0,
            invalidQuotes: 0, mismatchedQuotes: 0, maxMarketSearches: 20, purchaseRange: null, maxSpendRange: null },
        },
      },
    })
    const markdown = formatSbcRedactedSample(sample)

    expect(sample.source.url).toBe('https://www.ea.com/ea-sports-fc/ultimate-team/web-app/')
    expect(sample.inventorySample).toMatchObject({ visibleCardCount: 1, lockedVisibleCount: 1 })
    expect(sample.inventorySnapshot).toMatchObject({ coverage: 'complete', cardCount: 42, sbcStorageCount: 2 })
    expect(sample.transactionReadback).toMatchObject({ purchase: 'confirmed', submission: 'unknown',
      issues: ['submission-cardpool-unverified'] })
    expect(sample.inventorySample.ratingBands['88+']).toBe(1)
    expect(sample.quotePreflight?.summary).toMatchObject({ neededCardVersions: 1, freshQuotes: 1 })
    expect(sample.executionDryRun?.status).toBe('ready')
    expect(sample.executionDryRun?.summary).toMatchObject({ purchaseCount: 1, reservedIfStarted: 700 })
    expect(sample.executionDryRun?.sideEffects.purchases).toBe(false)
    expect(sample.riskPreflight?.summary).toMatchObject({ purchaseCount: 1, plannedSearches: 2 })
    expect(sample.riskPreflight?.disclaimer).toContain('不能证明不会封禁')
    expect(sample.approvalPreview?.summary).toMatchObject({ purchaseCount: 1, submitCount: 1, maxSpend: 700 })
    expect(sample.approvalPreview?.reviewDigest).toBe('abc123ef')
    expect(sample.approvalPreview?.identity).toMatchObject({ documentId: 'doc-a', clubId: 'club-a' })
    expect(sample.approvalPreview?.notice).toContain('只生成批准预览')
    expect(sample.fieldAudit.gaps.map(gap => gap.code)).toContain('purchase-result-readback')
    expect(sample.pageModel).toMatchObject({ view: 'sbc-group', group: { coverage: 'visible-rows-read',
      observedDetailCount: 2, visibleChallengeCount: 2 } })
    expect(sample.pageModel).not.toHaveProperty('group.challenges')
    expect(sample.challenges).toEqual([
      expect.objectContaining({ title: 'Marquee Matchups', requirementLines: ['Min. 2 Clubs'] }),
      expect.objectContaining({ title: 'Second Match', requirementLines: ['Min. 3 Nations'] }),
    ])
    expect(markdown).toContain('```json')
    expect(markdown).toContain('fc-sbc-redacted-sample')
    expect(markdown).toContain('"inventorySnapshot"')
    expect(markdown).toContain('"transactionReadback"')
    expect(markdown).toContain('"executionDryRun"')
    expect(markdown).toContain('"riskPreflight"')
    expect(markdown).toContain('"approvalPreview"')
    expect(markdown).toContain('"reviewDigest"')
    expect(markdown).toContain('"identity"')
    expect(markdown).toContain('Min. 2 Clubs')
    expect(markdown).not.toContain('sid=secret')
    expect(markdown).not.toContain('private-instance-id')
    expect(markdown).not.toContain('Mbappe')
    expect(markdown).not.toContain('raw DOM challenge text')
    expect(markdown).not.toContain('internal-fingerprint')
  })
})
