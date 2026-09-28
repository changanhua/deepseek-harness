import { describe, expect, test } from 'vitest'
import {
  compileSbcPuzzleRequirements,
  createSbcPuzzlePlanInput,
  generateSbcPuzzleCandidates,
} from '../src/fc-sbc-puzzle-solver.js'

const card = (instanceId: string, overrides: Record<string, unknown> = {}) => ({
  instanceId, cardVersionId: `version-${instanceId}`, source: 'club', locked: false,
  reserveValue: 0, rating: 76, quality: 'gold', nationId: 'es', leagueId: 'laliga', clubId: 'club-a', chemistry: 3,
  ...overrides,
})

const requirements = {
  slotCount: 3,
  constraints: [
    { type: 'attribute-count', field: 'nationId', values: ['it', 'be'], min: 1 },
    { type: 'distinct-count', field: 'clubId', min: 2 },
    { type: 'quality-count', quality: 'silver', min: 1 },
    { type: 'minimum-quality', quality: 'bronze' },
    { type: 'chemistry', min: 7, model: 'verified-evaluator' },
  ],
}

describe('FC SBC 拼图求解输入', () => {
  test('编译已支持的结构化规则，并拒绝文本或未支持规则', () => {
    expect(compileSbcPuzzleRequirements(requirements)).toMatchObject({ status: 'ready', slotCount: 3 })
    expect(compileSbcPuzzleRequirements({ slotCount: 3, constraints: [{ type: 'text', value: '3 clubs' }] }))
      .toMatchObject({ status: 'blocked', issues: [{ code: 'unsupported-rule' }] })
  })

  test('只从可核验的已有卡生成符合国家、品质、俱乐部和化学要求的候选', () => {
    const result = generateSbcPuzzleCandidates({
      coverage: 'complete', requirements, candidateLimit: 4, evaluateChemistry: () => 9,
      cards: [
        card('it', { nationId: 'it', clubId: 'club-a', quality: 'silver', chemistry: 3 }),
        card('be', { nationId: 'be', clubId: 'club-b', quality: 'gold', chemistry: 3 }),
        card('es', { nationId: 'es', clubId: 'club-c', quality: 'gold', chemistry: 3 }),
      ],
    })

    expect(result.status).toBe('ready')
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].cards.map((row: { instanceId: string }) => row.instanceId).sort()).toEqual(['be', 'es', 'it'])
  })

  test('库存未完整、未验证队伍化学或评分算法未声明时明确阻断', () => {
    const incomplete = generateSbcPuzzleCandidates({ coverage: 'partial', requirements, cards: [] })
    expect(incomplete.status).toBe('blocked')
    expect(incomplete.issues.map((row: { code: string }) => row.code)).toContain('inventory-coverage-incomplete')
    const chemistryMissing = generateSbcPuzzleCandidates({ coverage: 'complete', requirements, cards: [
      card('it', { nationId: 'it', clubId: 'a', quality: 'silver', chemistry: undefined }),
      card('be', { nationId: 'be', clubId: 'b' }), card('es', { clubId: 'c' }),
    ] })
    expect(chemistryMissing.status).toBe('blocked')
    expect(chemistryMissing.issues.map((row: { code: string }) => row.code)).toContain('chemistry-evaluator-missing')
    expect(chemistryMissing.provisional).toMatchObject({ status: 'provisional', reasonCodes: ['chemistry-evaluator-missing'] })
    expect(chemistryMissing.provisional?.candidates).toHaveLength(1)
    expect(compileSbcPuzzleRequirements({ slotCount: 1, constraints: [{ type: 'squad-rating', min: 75 }] }))
      .toMatchObject({ status: 'blocked', issues: [{ code: 'squad-rating-model-unknown' }] })
  })

  test('部分库存仍展示已读卡池中可核验候选，但不生成整组计划或宣称无解', () => {
    const partial = generateSbcPuzzleCandidates({
      coverage: 'partial', requirements, evaluateChemistry: () => 9,
      cards: [
        card('it', { nationId: 'it', clubId: 'club-a', quality: 'silver' }),
        card('be', { nationId: 'be', clubId: 'club-b' }),
        card('es', { clubId: 'club-c' }),
      ],
    })
    expect(partial).toMatchObject({
      status: 'blocked',
      provisional: { status: 'provisional', reasonCodes: ['inventory-coverage-incomplete'] },
      summary: { inventoryCoverage: 'partial', poolComplete: true },
    })
    expect(partial.candidates[0].cards.map((row: { instanceId: string }) => row.instanceId).sort()).toEqual(['be', 'es', 'it'])

    const noCandidate = generateSbcPuzzleCandidates({
      coverage: 'partial', requirements: { slotCount: 1, constraints: [{ type: 'quality-count', quality: 'silver', min: 1 }] },
      cards: [card('gold-only')],
    })
    expect(noCandidate.issues.map((row: { code: string }) => row.code)).not.toContain('no-verifiable-candidate')

    const plan = createSbcPuzzlePlanInput({
      fcYear: 'FC27', platform: 'pc', groupId: 'partial', evaluateChemistry: () => 9,
      read: { inventory: { coverage: 'partial', cards: [
        card('it', { nationId: 'it', clubId: 'club-a', quality: 'silver' }),
        card('be', { nationId: 'be', clubId: 'club-b' }),
        card('es', { clubId: 'club-c' }),
      ] }, group: { sets: [{ challenges: [{ challengeId: 'one', requirements }] }] } },
    })
    expect(plan).toMatchObject({ status: 'blocked', planInput: null, provisionalByChallenge: [{
      challengeId: 'one', candidateCount: 1, reasonCodes: ['inventory-coverage-incomplete'],
    }] })
  })

  test('用确定性的属性分桶覆盖搜索候选，且临时候选不能生成计划输入', () => {
    const cards = Array.from({ length: 38 }, (_, index) => card(`common-${String(index).padStart(2, '0')}`, {
      nationId: 'common', leagueId: 'common', clubId: 'common', quality: 'gold', reserveValue: index,
    }))
    cards.push(card('rare', { nationId: 'rare', leagueId: 'rare', clubId: 'rare', quality: 'silver', reserveValue: 999 }))
    const result = generateSbcPuzzleCandidates({
      coverage: 'complete', cards, requirements: { slotCount: 1, constraints: [
        { type: 'attribute-count', field: 'nationId', values: ['rare'], min: 1 },
        { type: 'chemistry', min: 1, model: 'unknown' },
      ] }, candidateLimit: 2,
    })
    expect(result.status).toBe('blocked')
    expect(result.provisional?.candidates[0].cards).toEqual([{ instanceId: 'rare' }])
    expect(result.summary).toMatchObject({ poolCardCount: 36, poolStrategy: 'round-robin-attribute-buckets' })
    const plan = createSbcPuzzlePlanInput({ fcYear: 'FC27', platform: 'pc', groupId: 'one', read: {
      inventory: { coverage: 'complete', cards }, group: { sets: [{ challenges: [{ challengeId: 'one', requirements: {
        slotCount: 1, constraints: [{ type: 'chemistry', min: 1, model: 'unknown' }],
      } }] }] },
    } })
    expect(plan).toMatchObject({ status: 'blocked', planInput: null, provisionalByChallenge: [{
      challengeId: 'one', candidateCount: 12, reasonCodes: ['chemistry-model-unknown'],
    }] })
    expect(JSON.stringify(plan.provisionalByChallenge)).not.toContain('rare')
  })

  test('组装 MAIN 读取结果，并把四关候选转为核心跨关组合器输入', () => {
    const plan = createSbcPuzzlePlanInput({
      fcYear: 'FC27', platform: 'pc', groupId: 'marquee', candidateLimit: 2, evaluateChemistry: () => 9,
      read: { inventory: { coverage: 'complete', cards: [
        card('one-a', { nationId: 'it', clubId: 'a', quality: 'silver' }), card('one-b', { nationId: 'be', clubId: 'b' }), card('one-c', { clubId: 'c' }),
        card('two-a', { nationId: 'no', clubId: 'd', quality: 'silver' }), card('two-b', { nationId: 'pt', clubId: 'e' }), card('two-c', { clubId: 'f' }),
      ] }, group: { status: 'complete', sets: [{ setId: 'marquee', challenges: [
        { challengeId: 'one', requirements },
        { challengeId: 'two', requirements: { ...requirements, constraints: [{ type: 'attribute-count', field: 'nationId', values: ['no', 'pt'], min: 1 }, ...requirements.constraints.slice(1)] } },
      ] }] } },
    })
    expect(plan.status).toBe('ready')
    expect(plan.planInput?.challenges).toHaveLength(2)
    expect(plan.planInput?.inventory).toHaveLength(6)
  })

  test('跳过已完成关卡，并把截断卡池的无解标为搜索不完整', () => {
    const search = generateSbcPuzzleCandidates({
      coverage: 'complete', requirements: { slotCount: 1, constraints: [{ type: 'quality-count', quality: 'silver', min: 1 }] },
      cards: [...Array.from({ length: 36 }, (_, index) => card(`normal-${index}`, { nationId: `n${String(index).padStart(2, '0')}`, clubId: `club-${index}` })),
        card('outside-pool', { nationId: 'zz', clubId: 'club-zz', quality: 'silver' })],
    })
    expect(search.status).toBe('blocked')
    expect(search.issues.map((row: { code: string }) => row.code)).toContain('search-incomplete')
    expect(search.issues.map((row: { code: string }) => row.code)).not.toContain('no-verifiable-candidate')
    expect(search.summary.poolComplete).toBe(false)

    const plan = createSbcPuzzlePlanInput({ fcYear: 'FC27', platform: 'pc', groupId: 'one', evaluateChemistry: () => 9, read: {
      inventory: { coverage: 'complete', cards: [card('a', { nationId: 'it', clubId: 'a', quality: 'silver' }), card('b', { nationId: 'be', clubId: 'b' }), card('c', { clubId: 'c' })] },
      group: { sets: [{ challenges: [{ challengeId: 'done', completed: true, requirements }, { challengeId: 'pending', requirements }] }] },
    } })
    expect(plan.status).toBe('ready')
    expect(plan.planInput?.challenges.map(row => row.challengeId)).toEqual(['pending'])
    expect(plan.summary).toMatchObject({ challengeCount: 2, completedChallengeCount: 1, pendingChallengeCount: 1, readyChallengeCount: 1 })
  })

  test('跨关候选上限截断时不把遗漏的第十三个可行组合判为无解', () => {
    const cards = [
      card('shared', { nationId: 'x', leagueId: 'a-only', clubId: 'conflict' }),
      ...Array.from({ length: 12 }, (_, index) => card(`filler-${index}`, { nationId: 'y', leagueId: 'common', clubId: 'conflict' })),
      card('safe-x', { nationId: 'x', leagueId: 'common', clubId: 'safe', reserveValue: 100 }),
      card('safe-y', { nationId: 'y', leagueId: 'common', clubId: 'safe', reserveValue: 101 }),
    ]
    const first = { slotCount: 2, constraints: [
      { type: 'distinct-count', field: 'clubId', exact: 1 },
      { type: 'attribute-count', field: 'nationId', values: ['x'], exact: 1 },
    ] }
    const second = { slotCount: 1, constraints: [{ type: 'attribute-count', field: 'leagueId', values: ['a-only'], exact: 1 }] }
    const exhaustive = generateSbcPuzzleCandidates({ coverage: 'complete', requirements: first, cards, candidateLimit: 13 })
    expect(exhaustive.candidates).toHaveLength(13)
    expect(exhaustive.candidates.slice(0, 12).every(candidate => candidate.cards.some(card => card.instanceId === 'shared'))).toBe(true)
    expect(exhaustive.candidates[12].cards.map(card => card.instanceId).sort()).toEqual(['safe-x', 'safe-y'])

    const plan = createSbcPuzzlePlanInput({ fcYear: 'FC27', platform: 'pc', groupId: 'limited', read: {
      inventory: { coverage: 'complete', cards },
      group: { sets: [{ challenges: [{ challengeId: 'first', requirements: first }, { challengeId: 'second', requirements: second }] }] },
    } })
    expect(plan).toMatchObject({ status: 'blocked', planInput: null, issues: [expect.objectContaining({ code: 'cross-challenge-search-incomplete' })] })
    expect(plan.issues.map(issue => issue.code)).not.toContain('no-cross-challenge-plan')
    expect(plan.summary).toMatchObject({ searchComplete: false, searchIncompleteChallenges: [{ challengeId: 'first', reasonCodes: ['candidate-limit-reached'] }] })

    const exhaustiveConflict = createSbcPuzzlePlanInput({ fcYear: 'FC27', platform: 'pc', groupId: 'exhaustive', read: {
      inventory: { coverage: 'complete', cards: [card('only-card')] },
      group: { sets: [{ challenges: [
        { challengeId: 'one', requirements: { slotCount: 1, constraints: [{ type: 'quality-count', quality: 'gold', exact: 1 }] } },
        { challengeId: 'two', requirements: { slotCount: 1, constraints: [{ type: 'quality-count', quality: 'gold', exact: 1 }] } },
      ] }] },
    } })
    expect(exhaustiveConflict).toMatchObject({ status: 'blocked', issues: [expect.objectContaining({ code: 'no-cross-challenge-plan' })],
      summary: { searchComplete: true, searchIncompleteChallenges: [] } })
  })

  test('按关卡身份调用原生化学验证，不能把一关的结果复用到另一关', () => {
    const calls: string[] = []
    const plan = createSbcPuzzlePlanInput({
      fcYear: 'FC27', platform: 'pc', groupId: 'chemistry',
      evaluateChemistry: (_cards, challengeId) => {
        calls.push(challengeId)
        return challengeId === 'one' ? 9 : 0
      },
      read: { inventory: { coverage: 'complete', cards: [
        card('a', { nationId: 'it', clubId: 'a', quality: 'silver' }), card('b', { nationId: 'be', clubId: 'b' }), card('c', { clubId: 'c' }),
      ] }, group: { sets: [{ challenges: [{ challengeId: 'one', requirements }, { challengeId: 'two', requirements }] }] } },
    })
    expect(calls).toContain('one')
    expect(calls).toContain('two')
    expect(plan).toMatchObject({ status: 'blocked', planInput: null })
    expect(plan.issues).toEqual(expect.arrayContaining([expect.objectContaining({ challengeId: 'two', code: 'no-verifiable-candidate' })]))
  })

  test('原生非线性队伍评分可通过普通平均不足的候选，缺少回调则阻断', () => {
    const nativeRequirements = { slotCount: 1, constraints: [{ type: 'squad-rating', min: 75, model: 'verified-evaluator' }] }
    const cards = [card('low-average', { rating: 70 })]
    expect(generateSbcPuzzleCandidates({ coverage: 'complete', requirements: nativeRequirements, cards,
      evaluateSquadRating: () => 75 })).toMatchObject({ status: 'ready', candidates: [{ cards: [{ instanceId: 'low-average' }] }] })
    const missing = generateSbcPuzzleCandidates({ coverage: 'complete', requirements: nativeRequirements, cards })
    expect(missing.status).toBe('blocked')
    expect(missing.issues.map((row: { code: string }) => row.code)).toContain('squad-rating-evaluator-missing')
    expect(missing.provisional?.candidates).toHaveLength(1)
    const unknown = generateSbcPuzzleCandidates({ coverage: 'complete', requirements: nativeRequirements, cards,
      evaluateSquadRating: () => Number.NaN })
    expect(unknown.status).toBe('blocked')
    expect(unknown.issues.map((row: { code: string }) => row.code)).toContain('squad-rating-evaluator-unknown')
  })

  test('真实 Marquee 规则形状可编译，且大库存中的同俱乐部三人不会被候选池排除', () => {
    const marquee = [
      { slotCount: 11, constraints: [{ type: 'attribute-count', field: 'nationId', values: ['it', 'be'], min: 1 }, { type: 'distinct-count', field: 'clubId', min: 3 }, { type: 'quality-count', quality: 'silver', min: 3 }, { type: 'minimum-quality', quality: 'bronze' }] },
      { slotCount: 11, constraints: [{ type: 'attribute-count', field: 'nationId', values: ['no', 'pt'], min: 1 }, { type: 'same-count', field: 'clubId', min: 3 }, { type: 'distinct-count', field: 'leagueId', max: 5 }, { type: 'quality-count', quality: 'gold', min: 2 }, { type: 'minimum-quality', quality: 'silver' }] },
      { slotCount: 11, constraints: [{ type: 'attribute-count', field: 'nationId', values: ['nl', 'de'], min: 2 }, { type: 'same-count', field: 'clubId', max: 2 }, { type: 'same-count', field: 'leagueId', min: 4 }, { type: 'quality-count', quality: 'gold', min: 2 }, { type: 'minimum-quality', quality: 'silver' }] },
      { slotCount: 11, constraints: [{ type: 'attribute-count', field: 'nationId', values: ['en', 'es'], min: 2 }, { type: 'same-count', field: 'nationId', min: 4 }, { type: 'same-count', field: 'clubId', max: 3 }, { type: 'distinct-count', field: 'leagueId', max: 5 }, { type: 'squad-rating', min: 75, model: 'verified-evaluator' }] },
    ]
    expect(marquee.map(compileSbcPuzzleRequirements).every(result => result.status === 'ready')).toBe(true)

    const cards = Array.from({ length: 40 }, (_, index) => card(`filler-${index}`, { nationId: `n${index}`, leagueId: `l${index}`, clubId: `c${index}`, quality: 'silver', reserveValue: index }))
    cards.push(...['a', 'b', 'c'].map((id, index) => card(`target-${id}`, { nationId: 'pt', leagueId: 'target-league', clubId: 'target-club', quality: 'gold', reserveValue: 100 + index })))
    const result = generateSbcPuzzleCandidates({
      coverage: 'complete', cards, candidateLimit: 1,
      requirements: { slotCount: 3, constraints: [{ type: 'attribute-count', field: 'nationId', values: ['pt'], min: 1 }, { type: 'same-count', field: 'clubId', min: 3 }, { type: 'minimum-quality', quality: 'silver' }] },
    })
    expect(result.status).toBe('ready')
    expect(result.candidates[0].cards.map((row: { instanceId: string }) => row.instanceId).sort()).toEqual(['target-a', 'target-b', 'target-c'])
    expect(result.summary.poolComplete).toBe(false)
  })

  test('属性必需卡在后桶时，仍优先保留其同俱乐部的三人组合', () => {
    const cards = Array.from({ length: 13 }, (_, club) => Array.from({ length: 3 }, (_, member) => card(`club-${club}-${member}`, {
      nationId: 'es', leagueId: `league-${club}`, clubId: `club-${club}`, quality: 'silver', reserveValue: club * 10 + member,
    }))).flat()
    cards.push(...['a', 'b', 'c'].map((id, index) => card(`pt-target-${id}`, {
      nationId: 'pt', leagueId: 'pt-league', clubId: 'pt-target', quality: 'gold', reserveValue: 999 + index,
    })))
    const result = generateSbcPuzzleCandidates({ coverage: 'complete', cards, candidateLimit: 1,
      requirements: { slotCount: 3, constraints: [
        { type: 'attribute-count', field: 'nationId', values: ['pt'], min: 1 },
        { type: 'same-count', field: 'clubId', min: 3 },
        { type: 'minimum-quality', quality: 'silver' },
      ] } })
    expect(result.status).toBe('ready')
    expect(result.candidates[0].cards.map((row: { instanceId: string }) => row.instanceId).sort()).toEqual(['pt-target-a', 'pt-target-b', 'pt-target-c'])
  })
})
