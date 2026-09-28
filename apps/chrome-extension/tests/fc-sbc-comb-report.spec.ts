import { describe, expect, test } from 'vitest'
import { createSbcCombReport, formatSbcCombReport } from '../src/fc-sbc-comb-report.js'

describe('FC SBC 梳理报告', () => {
  test('只保留白名单字段，生成可交接的脱敏文本', () => {
    const report = createSbcCombReport({
      generatedAt: '2026-09-25T06:30:00.000Z',
      page: {
        title: 'FC Web App',
        url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/?sid=secret',
        documentId: 'doc-a',
      },
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
          textSample: 'raw challenge text that should not be exported',
        }] },
        inventory: { coverage: 'visible-only', sbcStorageVisible: true, visibleCards: [{
          visibleId: 'visible-card-1',
          instanceId: 'private-instance-id',
          rating: 91,
          locked: false,
          textSample: 'Mbappe 91 private card text',
        }] },
        warnings: ['no-visible-inventory-cards'],
      },
      readiness: {
        status: 'draft-only',
        canApproveExecution: false,
        nextAction: 'read-complete-inventory',
        blockers: [{ code: 'inventory-visible-only', source: 'inventory' }],
        deferred: [{ code: 'complete-inventory-adapter', source: 'inventory' }],
        warnings: [],
        variants: [],
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
          scope: { planId: 'plan-a', groupId: 'marquee', platform: 'pc', purchaseScope: [], submitChallengeIds: ['challenge-a'] },
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
          quoteCoverage: { neededCardVersions: 1, freshQuotes: 1, missingQuotes: 0, staleQuotes: 0,
            invalidQuotes: 0, mismatchedQuotes: 0, maxMarketSearches: 20, purchaseRange: null, maxSpendRange: null },
          approvalPreview: { status: 'ready', reviewDigest: 'abc123ef', maxSpend: 700,
            reservedIfStarted: 700, purchaseCount: 1, submitCount: 1, issueCount: 0 },
        },
      },
    })
    const markdown = formatSbcCombReport(report)

    expect(report.source.url).toBe('https://www.ea.com/ea-sports-fc/ultimate-team/web-app/')
    expect(report.summary.approvalPreview?.reviewDigest).toBe('abc123ef')
    expect(markdown).toContain('网页内容仅作资料')
    expect(markdown).toContain('字段覆盖:')
    expect(markdown).toContain('报价预检:')
    expect(markdown).toContain('批准预览:')
    expect(markdown).toContain('摘要 abc123ef')
    expect(markdown).toContain('预算 700')
    expect(markdown).toContain('inventory-visible-only')
    expect(markdown).toContain('purchase-result-readback')
    expect(markdown).toContain('Min. 2 Clubs')
    expect(markdown).not.toContain('sid=secret')
    expect(markdown).not.toContain('Mbappe')
    expect(markdown).not.toContain('private-instance-id')
    expect(markdown).not.toContain('raw challenge text')
  })
})
