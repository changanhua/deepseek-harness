import { afterEach, describe, expect, test, vi } from 'vitest'
import { readFcSbcMain } from '../src/fc-sbc-main-read.js'

const originalServices = (globalThis as { services?: unknown }).services
const originalClubSearchModel = (globalThis as { UTBucketedItemSearchViewModel?: unknown }).UTBucketedItemSearchViewModel
const originalStorageCriteria = (globalThis as { UTSearchCriteriaDTO?: unknown }).UTSearchCriteriaDTO
const originalSearchType = (globalThis as { SearchType?: unknown }).SearchType
const originalSearchCategory = (globalThis as { SearchCategory?: unknown }).SearchCategory
const originalEligibilityKey = (globalThis as { SBCEligibilityKey?: unknown }).SBCEligibilityKey
const originalEligibilityScope = (globalThis as { SBCEligibilityScope?: unknown }).SBCEligibilityScope
const originalEligibilityQuality = (globalThis as { SBCEligibilityQualityType?: unknown }).SBCEligibilityQualityType

afterEach(() => {
  vi.useRealTimers()
  if (originalServices === undefined) delete (globalThis as { services?: unknown }).services
  else (globalThis as { services?: unknown }).services = originalServices
  if (originalClubSearchModel === undefined) {
    delete (globalThis as { UTBucketedItemSearchViewModel?: unknown }).UTBucketedItemSearchViewModel
  }
  else (globalThis as { UTBucketedItemSearchViewModel?: unknown }).UTBucketedItemSearchViewModel = originalClubSearchModel
  if (originalStorageCriteria === undefined) delete (globalThis as { UTSearchCriteriaDTO?: unknown }).UTSearchCriteriaDTO
  else (globalThis as { UTSearchCriteriaDTO?: unknown }).UTSearchCriteriaDTO = originalStorageCriteria
  if (originalSearchType === undefined) delete (globalThis as { SearchType?: unknown }).SearchType
  else (globalThis as { SearchType?: unknown }).SearchType = originalSearchType
  if (originalSearchCategory === undefined) delete (globalThis as { SearchCategory?: unknown }).SearchCategory
  else (globalThis as { SearchCategory?: unknown }).SearchCategory = originalSearchCategory
  if (originalEligibilityKey === undefined) delete (globalThis as { SBCEligibilityKey?: unknown }).SBCEligibilityKey
  else (globalThis as { SBCEligibilityKey?: unknown }).SBCEligibilityKey = originalEligibilityKey
  if (originalEligibilityScope === undefined) delete (globalThis as { SBCEligibilityScope?: unknown }).SBCEligibilityScope
  else (globalThis as { SBCEligibilityScope?: unknown }).SBCEligibilityScope = originalEligibilityScope
  if (originalEligibilityQuality === undefined) delete (globalThis as { SBCEligibilityQualityType?: unknown }).SBCEligibilityQualityType
  else (globalThis as { SBCEligibilityQualityType?: unknown }).SBCEligibilityQualityType = originalEligibilityQuality
})

const installSearchDtos = () => {
  class ClubSearchModel { searchCriteria = {} }
  class StorageCriteria { type?: string; defId?: unknown[]; category?: string; count?: number; offset?: number }
  ;(globalThis as { UTBucketedItemSearchViewModel?: unknown }).UTBucketedItemSearchViewModel = ClubSearchModel
  ;(globalThis as { UTSearchCriteriaDTO?: unknown }).UTSearchCriteriaDTO = StorageCriteria
  ;(globalThis as { SearchType?: unknown }).SearchType = { PLAYER: 'player' }
  ;(globalThis as { SearchCategory?: unknown }).SearchCategory = { ANY: 'any' }
}

describe('FC SBC MAIN 只读采集', () => {
  test('读取 SBC 关卡和两路已证实翻页完成的完整库存', async () => {
    installSearchDtos()
    const clubOffsets: number[] = []
    const storageOffsets: number[] = []
    ;(globalThis as { services?: unknown }).services = {
      SBC: {
        requestSets: async () => ({ data: { sets: [{ id: 'marquee', name: '重大比赛' }] } }),
        requestChallengesForSet: async () => ({ data: { challenges: [{ id: 'italy-belgium', name: '意大利对比利时', completed: false }] } }),
        loadChallenge: async () => ({ data: { challenge: {
          id: 'italy-belgium', name: '意大利对比利时',
          requirements: [{ type: 'nation', minimum: 1, values: ['ITA', 'BEL'] }],
          rewards: [{ name: '迷你黄金组合包' }],
        } } }),
      },
      Club: {
        search: async ({ offset }: { offset: number }) => {
          clubOffsets.push(offset)
          return offset === 0
            ? { response: { items: [{ id: 'club-1', definitionId: 'gold-1', rating: 82, nationId: 14, leagueId: 53, teamId: 11, preferredPosition: 'ST', tradable: true, isPlayer: () => true }], retrievedAll: false } }
            : { response: { items: [{ id: 'club-2', resourceId: 'silver-1', rating: 74, nationId: 13, leagueId: 13, clubId: 12, position: 'CM', locked: true, isPlayer: () => true }], retrievedAll: true } }
        },
      },
      Item: {
        searchStorageItems: async ({ offset }: { offset: number }) => {
          storageOffsets.push(offset)
          return { response: { items: offset === 0 ? [{ id: 'storage-1', resourceId: 'bronze-1', rating: 64, nationId: 45, leagueId: 7, clubId: 19, position: 'GK', tradeable: false, isPlayer: () => true }] : [], endOfList: true } }
        },
      },
    }

    const result = await readFcSbcMain({ capturedAt: '2026-09-26T00:00:00.000Z', maxPages: 4, maxItems: 8 })

    expect(clubOffsets).toEqual([0, 1])
    expect(storageOffsets).toEqual([0])
    expect(result).toMatchObject({
      schemaVersion: 1,
      kind: 'fc-sbc-main-read',
      capturedAt: '2026-09-26T00:00:00.000Z',
      platform: null,
      status: 'complete',
      group: { status: 'complete', selectedSetId: 'marquee', sets: [{ setId: 'marquee', title: '重大比赛', challenges: [{
        challengeId: 'italy-belgium', title: '意大利对比利时', completed: false,
        requirements: { status: 'complete', constraints: [{ type: 'attribute-count', attribute: 'nationId', values: ['ITA', 'BEL'], minimum: 1 }] },
        rewards: [{ name: '迷你黄金组合包' }],
      }] }] },
      inventory: { coverage: 'complete', club: { status: 'complete', pageCount: 2, retrievedAll: true }, sbcStorage: { status: 'complete', pageCount: 1, retrievedAll: true } },
    })
    expect(result.inventory.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ instanceId: 'club-1', cardVersionId: 'gold-1', source: 'club', rating: 82, quality: 'gold', nationId: '14', leagueId: '53', clubId: '11', position: 'ST', tradeable: true, locked: false }),
      expect.objectContaining({ instanceId: 'storage-1', cardVersionId: 'bronze-1', source: 'sbc-storage', rating: 64, quality: 'bronze', locked: false }),
    ]))
  })

  test('没有明确翻页结束证据时保持 partial，不能声称完整库存', async () => {
    installSearchDtos()
    ;(globalThis as { services?: unknown }).services = {
      SBC: { requestSets: async () => ({ data: { sets: [] } }) },
      Club: { search: async () => ({ response: { items: [{ id: 'club-1', resourceId: 'gold-1', rating: 82 }] } }) },
      Item: { searchStorageItems: async () => ({ response: { items: [] } }) },
    }

    const result = await readFcSbcMain({ maxPages: 1 })

    expect(result.status).toBe('partial')
    expect(result.inventory.coverage).toBe('partial')
    expect(result.inventory.club).toMatchObject({ status: 'partial', retrievedAll: false })
    expect(result.issues.map(item => item.code)).toContain('club-pagination-end-unverified')
  })

  test('最低品质优先于品质计数，空阈值不被当成零', async () => {
    installSearchDtos()
    ;(globalThis as { services?: unknown }).services = {
      SBC: {
        requestSets: async () => ({ data: { sets: [{ id: 'set-1', name: '重大比赛' }] } }),
        requestChallengesForSet: async () => ({ data: { challenges: [{ id: 'one', name: '第一关' }] } }),
        loadChallenge: async () => ({ data: { challenge: { id: 'one', name: '第一关', requirements: [
          { type: 'minimum-quality', minimum: 1, value: 'bronze' },
          { type: 'quality', minimum: null, value: 'gold' },
        ] } } }),
      },
      Club: { search: async () => ({ response: { items: [], retrievedAll: true } }) },
      Item: { searchStorageItems: async () => ({ response: { items: [], retrievedAll: true } }) },
    }

    const result = await readFcSbcMain()
    const requirements = result.group.sets[0].challenges[0].requirements

    expect(requirements).toEqual({ status: 'partial', constraints: [{ type: 'minimum-quality', quality: 'bronze' }] })
  })

  test('页内截断时即使服务声明 retrievedAll 也不把库存当完整', async () => {
    installSearchDtos()
    ;(globalThis as { services?: unknown }).services = {
      SBC: { requestSets: async () => ({ data: { sets: [] } }) },
      Club: { search: async () => ({ response: { items: [
        { id: 'club-1', resourceId: 'gold-1', rating: 82 }, { id: 'club-2', resourceId: 'gold-2', rating: 81 },
      ], retrievedAll: true } }) },
      Item: { searchStorageItems: async () => ({ response: { items: [], retrievedAll: true } }) },
    }

    const result = await readFcSbcMain({ maxItems: 1 })

    expect(result.inventory).toMatchObject({ coverage: 'partial', club: { status: 'partial', retrievedAll: false } })
    expect(result.issues.map(item => item.code)).toContain('club-items-truncated')
  })

  test('使用 EA 搜索 DTO，并从 observable 与已水合 set 读取 FC27 服务结果', async () => {
    const seen: string[] = []
    const observable = (payload: unknown) => ({
      observe: (_owner: unknown, callback: (observer: { unobserve: () => void }, value: unknown) => void) => {
        callback({ unobserve: () => undefined }, payload)
      },
    })
    class ClubSearchModel { searchCriteria = { source: 'club-dto' } }
    class StorageCriteria { source = 'storage-dto'; type?: string; defId?: unknown[]; category?: string; count?: number; offset?: number }
    ;(globalThis as { UTBucketedItemSearchViewModel?: unknown }).UTBucketedItemSearchViewModel = ClubSearchModel
    ;(globalThis as { UTSearchCriteriaDTO?: unknown }).UTSearchCriteriaDTO = StorageCriteria
    ;(globalThis as { SearchType?: unknown }).SearchType = { PLAYER: 'player' }
    ;(globalThis as { SearchCategory?: unknown }).SearchCategory = { ANY: 'any' }
    const challenge = { id: 'one', name: '第一关', getChallenges: undefined }
    const set = { id: 'marquee', name: '重大比赛', getChallenges: () => [challenge] }
    ;(globalThis as { services?: unknown }).services = {
      SBC: {
        requestSets: () => observable({ data: { sets: [set] } }),
        requestChallengesForSet: () => observable({ data: {} }),
        loadChallenge: () => observable({ data: { requirements: [] } }),
      },
      Club: { search: (criteria: { source?: string; count?: number; offset?: number }) => { seen.push(`${criteria.source}:${criteria.count}:${criteria.offset}`); return observable({ response: { items: [], retrievedAll: true } }) } },
      Item: { searchStorageItems: (criteria: { source?: string; type?: string; category?: string; count?: number; offset?: number }) => { seen.push(`${criteria.source}:${criteria.type}:${criteria.category}:${criteria.count}:${criteria.offset}`); return observable({ response: { items: [], retrievedAll: true } }) } },
    }

    const result = await readFcSbcMain({ pageSize: 25 })

    expect(seen).toEqual(['club-dto:25:0', 'storage-dto:player:any:25:0'])
    expect(result).toMatchObject({ status: 'complete', group: { selectedSetId: 'marquee', sets: [{ challenges: [{ challengeId: 'one', requirements: { status: 'complete', constraints: [] } }] }] }, inventory: { coverage: 'complete' } })
  })

  test('把 FC27 eligibilityRequirements 的已知枚举转换为求解约束', async () => {
    installSearchDtos()
    ;(globalThis as { SBCEligibilityKey?: unknown }).SBCEligibilityKey = { 3: 'PLAYER_QUALITY', 7: 'NATION_COUNT', 9: 'CLUB_COUNT', 10: 'NATION_ID', 17: 'PLAYER_LEVEL', 35: 'CHEMISTRY_POINTS' }
    ;(globalThis as { SBCEligibilityScope?: unknown }).SBCEligibilityScope = { 0: 'GREATER', 1: 'LOWER', 2: 'EXACT' }
    ;(globalThis as { SBCEligibilityQualityType?: unknown }).SBCEligibilityQualityType = { 1: 'BRONZE', 2: 'SILVER', 3: 'GOLD' }
    const challenge = {
      id: 'one', name: '第一关', type: 'OPEN_CHALLENGE', formation: 'f442', status: 'NOT_STARTED',
      eligibilityRequirements: [
        { scope: 0, count: 1, kvPairs: { _collection: { 10: [27, 7] } } },
        { scope: 0, count: -1, kvPairs: { _collection: { 9: [3] } } },
        { scope: 0, count: 3, kvPairs: { _collection: { 17: [2] } } },
        { scope: 0, count: -1, kvPairs: { _collection: { 3: [1] } } },
        { scope: 0, count: -1, kvPairs: { _collection: { 35: [14] } } },
      ],
    }
    const set = { id: 'marquee', name: '重大比赛', getChallenges: () => [challenge] }
    ;(globalThis as { services?: unknown }).services = {
      SBC: {
        requestSets: async () => ({ data: { sets: [set] } }),
        requestChallengesForSet: async () => ({ data: {} }),
        loadChallenge: async () => { throw new Error('rules already hydrated') },
      },
      Club: { search: async () => ({ response: { items: [], retrievedAll: true } }) },
      Item: { searchStorageItems: async () => ({ response: { items: [], retrievedAll: true } }) },
    }

    const result = await readFcSbcMain()

    expect(result.group.sets[0].challenges[0]).toMatchObject({
      completed: false, formationName: 'f442', requirements: { slotCount: 11 },
    })
    expect(result.group.sets[0].challenges[0].requirements).toEqual({
      status: 'complete', slotCount: 11, constraints: [
        { type: 'attribute-count', attribute: 'nationId', values: ['27', '7'], minimum: 1 },
        { type: 'distinct-count', attribute: 'clubId', minimum: 3 },
        { type: 'quality-count', quality: 'silver', minimum: 3 },
        { type: 'minimum-quality', quality: 'bronze' },
        { type: 'chemistry', minimum: 14 },
      ],
    })
  })

  test('单 persona 时读取 EA 当前平台，多 persona 未选定时保持 null', async () => {
    installSearchDtos()
    ;(globalThis as { services?: unknown }).services = {
      SBC: { requestSets: async () => ({ data: { sets: [] } }) },
      Club: { search: async () => ({ response: { items: [], retrievedAll: true } }) },
      Item: { searchStorageItems: async () => ({ response: { items: [], endOfList: true } }) },
      User: { getUser: () => ({ _personas: { _collection: { first: { id: 'persona-1', platform: 'PC' } } } }) },
    }

    expect((await readFcSbcMain()).platform).toBe('PC')
  })

  test('UTItemEntity 优先以 tier 枚举品质，非 player 不按评分猜铜牌', async () => {
    installSearchDtos()
    ;(globalThis as { SBCEligibilityQualityType?: unknown }).SBCEligibilityQualityType = {
      1: 'BRONZE', 2: 'SILVER', 3: 'GOLD',
    }
    ;(globalThis as { services?: unknown }).services = {
      SBC: { requestSets: async () => ({ data: { sets: [] } }) },
      Club: { search: async () => ({ response: { items: [
        { id: 'tier-gold', definitionId: 'gold', rating: 60, isPlayer: () => true, hasQualityTiers: () => true, getTier: () => 3 },
        { id: 'not-player', definitionId: 'consumable', rating: 64, isPlayer: () => false },
      ], retrievedAll: true } }) },
      Item: { searchStorageItems: async () => ({ response: { items: [], endOfList: true } }) },
    }

    const result = await readFcSbcMain()

    expect(result.inventory.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ instanceId: 'tier-gold', quality: 'gold' }),
      expect.objectContaining({ instanceId: 'not-player', quality: null }),
    ]))
  })

  test('EA observable 超时和迟到通知都会注销 owner', async () => {
    installSearchDtos()
    vi.useFakeTimers()
    let notifyLate: ((observer: { unobserve: (owner: unknown) => void }, payload: unknown) => void) | null = null
    let observableUnsubscribes = 0
    let lateUnsubscribes = 0
    const pending = {
      observe: (
        _owner: unknown,
        callback: (observer: { unobserve: (owner: unknown) => void }, payload: unknown) => void,
      ) => { notifyLate = callback },
      unobserve: () => { observableUnsubscribes += 1 },
    }
    ;(globalThis as { services?: unknown }).services = {
      SBC: { requestSets: () => pending },
      Club: { search: async () => ({ response: { items: [], retrievedAll: true } }) },
      Item: { searchStorageItems: async () => ({ response: { items: [], endOfList: true } }) },
    }

    const reading = readFcSbcMain({ readTimeoutMs: 250 })
    await vi.advanceTimersByTimeAsync(250)
    await reading

    expect(observableUnsubscribes).toBe(1)
    const lateCallback = notifyLate
    if (lateCallback === null) throw new Error('expected pending observable callback')
    lateCallback({ unobserve: () => { lateUnsubscribes += 1 } }, { data: { sets: [] } })
    expect(lateUnsubscribes).toBe(1)
  })

  test('累计 Club 页按实例去重，但沿用实测的原始页长推进 offset', async () => {
    installSearchDtos()
    const clubOffsets: number[] = []
    const player = (id: string) => ({ id, definitionId: `version-${id}`, rating: 80, isPlayer: () => true })
    ;(globalThis as { services?: unknown }).services = {
      SBC: { requestSets: async () => ({ data: { sets: [] } }) },
      Club: {
        search: async ({ offset }: { offset: number }) => {
          clubOffsets.push(offset)
          if (offset === 0) return { response: { items: [player('a'), player('b')], retrievedAll: false } }
          if (offset === 2) return { response: { items: [player('a'), player('b'), player('c')], retrievedAll: false } }
          return { response: { items: [player('a'), player('b'), player('c')], retrievedAll: true } }
        },
      },
      Item: { searchStorageItems: async () => ({ response: { items: [], endOfList: true } }) },
    }

    const result = await readFcSbcMain()

    expect(clubOffsets).toEqual([0, 2, 5])
    expect(result.inventory).toMatchObject({ coverage: 'complete', club: { pageCount: 3, retrievedAll: true } })
    expect(result.inventory.cards.map(card => card.instanceId)).toEqual(['a', 'b', 'c'])
  })
})
