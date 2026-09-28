import { describe, expect, test } from 'vitest'
import { createFcSbcSliceReport, createFcSbcVerificationRequest } from '../src/fc-sbc-slice-report.js'

const probe = {
  url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/', supported: true, taskType: 'puzzle',
  marketAccess: { status: 'unknown', evidence: [] },
  challengeSet: { title: 'Marquee Matchups', visibleChallengeCount: 1, challenges: [] },
  inventory: { coverage: 'unread', visibleCards: [] }, warnings: [],
}

describe('FC SBC 纵切汇总', () => {
  test('服务读取不完整时只显示可证实的库存覆盖，不能把 DOM 当成完整方案', () => {
    const result = createFcSbcSliceReport({ probe, main: {
      status: 'partial', issues: [{ code: 'club-pagination-end-unverified', detail: 'more pages' }],
      group: { status: 'complete', selectedSetId: 'set-a', sets: [{ setId: 'set-a', title: 'Marquee Matchups', challenges: [] }] },
      inventory: { coverage: 'partial', cards: [{ instanceId: 'owned-a', cardVersionId: 'base-a', source: 'club', rating: 75 }] },
    } })

    expect(result.status).toBe('partial')
    expect(result.inventorySummary).toMatchObject({ coverage: 'partial', cardCount: 1 })
    expect(result.puzzle.status).toBe('blocked')
    expect(result.report.canApproveExecution).toBe(false)
    expect(result.report.variants).toEqual([])
  })

  test('只接受 MAIN 已确认的唯一当前群组，化学无法验证时不产出可审批方案', () => {
    const result = createFcSbcSliceReport({ probe, main: {
      status: 'complete', issues: [], platform: 'pc',
      group: { status: 'complete', selectedSetId: 'set-a', sets: [
        { setId: 'set-a', title: 'Marquee Matchups', challenges: [{ challengeId: 'one', title: 'One', requirements: {
          status: 'complete', slotCount: 1, constraints: [{ type: 'chemistry', minimum: 1 }],
        } }] },
      ] },
      inventory: { coverage: 'complete', cards: [{ instanceId: 'owned-a', cardVersionId: 'base-a', source: 'club', rating: 75 }] },
    } })

    expect(result.groupSummary).toMatchObject({ selectedSetId: 'set-a', challengeCount: 1 })
    expect(result.inventorySummary).toMatchObject({ coverage: 'complete', cardCount: 1 })
    expect(result.puzzle.issues.map(issue => issue.code)).toContain('chemistry-model-unknown')
    expect(result.puzzle.provisionalByChallenge).toEqual([{ challengeId: 'one', candidateCount: 1,
      reasonCodes: ['chemistry-model-unknown'] }])
    expect(result.report.canApproveExecution).toBe(false)
  })

  test('只把当前未完成关的有限候选送入原生复核，回读必须对应相同卡实例', () => {
    const main = {
      url: probe.url, status: 'complete', issues: [], platform: 'PC',
      group: { status: 'complete', selectedSetId: 'set-a', sets: [{ setId: 'set-a', title: 'Marquee Matchups', challenges: [
        { challengeId: 'one', title: 'One', completed: false, formationName: 'f442', requirements: {
          status: 'complete', slotCount: 11, constraints: [{ type: 'chemistry', minimum: 1 }],
        } },
      ] }] },
      inventory: { coverage: 'complete', cards: Array.from({ length: 11 }, (_, index) => ({
        instanceId: `owned-${index}`, cardVersionId: `base-${index}`, source: 'club', rating: 75,
        quality: 'gold', nationId: '7', leagueId: '13', clubId: '19',
      })) },
    }
    const request = createFcSbcVerificationRequest({ probe, main })
    expect(request).toMatchObject({ status: 'ready', groups: [{ challengeId: 'one', formationName: 'f442' }] })
    expect(request.groups[0].candidates[0].instanceIds).toContain('owned-0')
    expect(request.groups[0].candidates[0].instanceIds).toContain('owned-10')
    const candidateId = request.groups[0].candidates[0].candidateId
    const verified = createFcSbcSliceReport({ probe, main, verificationRequest: request, verification: {
      url: probe.url, status: 'complete', issues: [], results: [
        { challengeId: 'one', candidateId, instanceIds: request.groups[0].candidates[0].instanceIds,
          status: 'complete', chemistry: 2, squadRating: 75 },
      ],
    } })
    expect(verified.puzzle.status).toBe('ready')
    expect(verified.report.variants).toHaveLength(1)
    const mismatched = createFcSbcSliceReport({ probe, main, verificationRequest: request, verification: {
      url: probe.url, status: 'complete', issues: [], results: [
        { challengeId: 'one', candidateId: 'other', instanceIds: request.groups[0].candidates[0].instanceIds,
          status: 'complete', chemistry: 2, squadRating: 75 },
      ],
    } })
    expect(mismatched.puzzle.status).toBe('blocked')
    expect(mismatched.report.canApproveExecution).toBe(false)
    const changedCards = createFcSbcSliceReport({ probe, main, verificationRequest: request, verification: {
      url: probe.url, status: 'complete', issues: [], results: [
        { challengeId: 'one', candidateId, instanceIds: [...request.groups[0].candidates[0].instanceIds.slice(1), 'other-card'],
          status: 'complete', chemistry: 2, squadRating: 75 },
      ],
    } })
    expect(changedCards.puzzle.status).toBe('blocked')
  })
})
