import { afterEach, describe, expect, test, vi } from 'vitest'
import { evaluateFcSbcChemistryMain } from '../src/fc-sbc-native-chemistry.js'

type NativeCard = {
  id: string
  rating?: number
  definitionId?: string
  nationId?: string
  leagueId?: string
  teamId?: string
  hasQualityTiers?: () => boolean
  getTier?: () => number
  possiblePositions: { typeId: string }[]
}
type NativeCards = Record<string, NativeCard>
const globals = globalThis as Record<string, unknown>
const saved = {
  services: globals.services,
  repositories: globals.repositories,
  UTSquadChemCalculatorUtils: globals.UTSquadChemCalculatorUtils,
  UTNullItemEntity: globals.UTNullItemEntity,
  UTServerSettingsRepository: globals.UTServerSettingsRepository,
  SBCEligibilityQualityType: globals.SBCEligibilityQualityType,
}

afterEach(() => {
  vi.useRealTimers()
  if (saved.services === undefined) delete globals.services; else globals.services = saved.services
  if (saved.repositories === undefined) delete globals.repositories; else globals.repositories = saved.repositories
  if (saved.UTSquadChemCalculatorUtils === undefined) delete globals.UTSquadChemCalculatorUtils
  else globals.UTSquadChemCalculatorUtils = saved.UTSquadChemCalculatorUtils
  if (saved.UTNullItemEntity === undefined) delete globals.UTNullItemEntity; else globals.UTNullItemEntity = saved.UTNullItemEntity
  if (saved.UTServerSettingsRepository === undefined) delete globals.UTServerSettingsRepository
  else globals.UTServerSettingsRepository = saved.UTServerSettingsRepository
  if (saved.SBCEligibilityQualityType === undefined) delete globals.SBCEligibilityQualityType
  else globals.SBCEligibilityQualityType = saved.SBCEligibilityQualityType
})

const elevenCards = (ratings: { keeper?: number; striker?: number } = {}): NativeCards => {
  const cards: NativeCards = {
    keeper: { id: 'keeper', possiblePositions: [{ typeId: 'GK' }], ...(ratings.keeper === undefined ? {} : { rating: ratings.keeper }) },
  }
  for (let index = 0; index < 10; index += 1) {
    const id = `striker-${index}`
    cards[id] = { id, possiblePositions: [{ typeId: 'ST' }], ...(ratings.striker === undefined ? {} : { rating: ratings.striker }) }
  }
  return cards
}

const installNativeChemistry = (items: NativeCards) => {
  const requested: string[][] = []
  globals.services = {
    Item: {
      requestItemsById: async (ids: string[]) => {
        requested.push(ids)
        return { response: { items: ids.map(id => items[id]).filter(Boolean) } }
      },
    },
    Chemistry: { marker: 'chemistry' },
    Configuration: { checkFeatureEnabled: () => true },
  }
  globals.repositories = {
    Squad: { getFormations: () => [{ name: 'f442', getPosition: (index: number) => ({ typeId: index === 0 ? 'GK' : 'ST' }) }] },
    TeamConfig: { marker: 'team-config' },
  }
  globals.UTNullItemEntity = class { value = null }
  globals.UTServerSettingsRepository = { KEY: { SQUAD_RATING_FLOAT_CALCULATION_ENABLED: 'float-rating' } }
  globals.UTSquadChemCalculatorUtils = class {
    calculate (_formation: unknown, orderedItems: { id: string }[]) {
      return { chemistry: orderedItems[0].id === 'keeper' && orderedItems.slice(1).every(item => item.id.startsWith('striker')) ? 27 : 0,
        players: orderedItems.map((item, index) => ({ itemId: item.id, chemistry: index === 0 ? 3 : 2 })) }
    }
  }
  return requested
}

describe('FC SBC 原生化学计算', () => {
  test('按原生可用位置重排 11 张卡后计算并仅返回 JSON', async () => {
    const cards = elevenCards()
    const requested = installNativeChemistry(cards)

    const result = await evaluateFcSbcChemistryMain({
      url: 'https://www.ea.com/fc-ultimate-team/web-app/',
      groups: [{ challengeId: 'one', formationName: 'f442', candidates: [{ candidateId: 'candidate-a', instanceIds: [
        ...Array.from({ length: 10 }, (_, index) => `striker-${index}`), 'keeper',
      ] }] }],
    })

    expect(requested).toEqual([['striker-0', 'striker-1', 'striker-2', 'striker-3', 'striker-4', 'striker-5', 'striker-6', 'striker-7', 'striker-8', 'striker-9', 'keeper']])
    expect(result).toMatchObject({ url: 'https://www.ea.com/fc-ultimate-team/web-app/', status: 'complete', issues: [], results: [{
      challengeId: 'one', candidateId: 'candidate-a', status: 'complete', chemistry: 27,
      instanceIds: ['keeper', 'striker-0', 'striker-1', 'striker-2', 'striker-3', 'striker-4', 'striker-5', 'striker-6', 'striker-7', 'striker-8', 'striker-9'],
    }] })
    expect(JSON.stringify(result)).not.toContain('possiblePositions')
  })

  test('没有足够正位卡时仍以完整排列交给原生计算器，并报告实际正位数', async () => {
    const requested = installNativeChemistry(Object.fromEntries(Array.from({ length: 11 }, (_, index) => [
      `only-striker-${index}`, { id: `only-striker-${index}`, possiblePositions: [{ typeId: 'ST' }] },
    ])))

    const result = await evaluateFcSbcChemistryMain({ groups: [{ challengeId: 'one', formationName: 'f442', candidates: [{ candidateId: 'candidate-a', instanceIds: Array.from({ length: 11 }, (_, index) => `only-striker-${index}`) }] }] })

    expect(requested).toHaveLength(1)
    expect(result.status).toBe('complete')
    expect(result.results[0]).toMatchObject({ status: 'complete', chemistry: 0, onPositionCount: 10 })
  })

  test('原生计算器异常时返回可读阻断结果', async () => {
    const cards = elevenCards()
    installNativeChemistry(cards)
    globals.UTSquadChemCalculatorUtils = class { calculate () { throw new Error('native calculator stopped') } }

    const result = await evaluateFcSbcChemistryMain({ groups: [{ challengeId: 'one', formationName: 'f442', candidates: [{ candidateId: 'candidate-a', instanceIds: ['keeper', ...Array.from({ length: 10 }, (_, index) => `striker-${index}`)] }] }] })

    expect(result.results[0]).toMatchObject({ status: 'blocked', issues: [{ code: 'native-chemistry-unavailable' }] })
  })

  test('按当前 FC27 浮点评分公式计算同一 11 人阵容的评分', async () => {
    const cards = elevenCards({ keeper: 74, striker: 75 })
    installNativeChemistry(cards)

    const result = await evaluateFcSbcChemistryMain({ groups: [{
      challengeId: 'one', formationName: 'f442', candidates: [{ candidateId: 'candidate-a', instanceIds: ['keeper', ...Array.from({ length: 10 }, (_, index) => `striker-${index}`)] }],
    }] })

    expect(result.results[0]).toMatchObject({ status: 'complete', squadRating: 75, squadRatingStatus: 'complete' })
  })

  test('配置服务关闭浮点评分时使用 FC27 的整数分支', async () => {
    const cards = elevenCards({ keeper: 77, striker: 60 })
    installNativeChemistry(cards)
    const runtime = globals as unknown as { services: { Configuration: { checkFeatureEnabled: () => boolean } } }
    runtime.services.Configuration.checkFeatureEnabled = () => false

    const result = await evaluateFcSbcChemistryMain({ groups: [{
      challengeId: 'one', formationName: 'f442', candidates: [{ candidateId: 'candidate-a', instanceIds: ['keeper', ...Array.from({ length: 10 }, (_, index) => `striker-${index}`)] }],
    }] })

    expect(result.results[0]).toMatchObject({ squadRating: 63, squadRatingStatus: 'complete' })
  })

  test('从 FC27 结果对象的 getSlotChemistry 读取全部 11 个逐槽化学值', async () => {
    const cards = elevenCards()
    installNativeChemistry(cards)
    globals.UTSquadChemCalculatorUtils = class {
      calculate () { return { chemistry: 25, getSlotChemistry: (slot: number) => ({ value: () => slot === 0 ? 3 : 2 }) } }
    }

    const result = await evaluateFcSbcChemistryMain({ groups: [{
      challengeId: 'one', formationName: 'f442', candidates: [{ candidateId: 'candidate-a', instanceIds: ['keeper', ...Array.from({ length: 10 }, (_, index) => `striker-${index}`)] }],
    }] })

    expect(result.results[0].chemistry).toBe(25)
    expect(result.results[0].slots?.[0]).toEqual({ slot: 0, instanceId: 'keeper', chemistry: 3 })
    expect(result.results[0].slots).toHaveLength(11)
  })

  test('接受 EA response.itemData 的原生卡牌批量读取结果', async () => {
    installNativeChemistry(elevenCards())
    const runtime = globals as unknown as { services: { Item: { requestItemsById: (ids: string[]) => Promise<unknown> } } }
    const cards = elevenCards()
    runtime.services.Item.requestItemsById = async ids => ({ response: { itemData: ids.map(id => cards[id]) } })

    const result = await evaluateFcSbcChemistryMain({ groups: [{
      challengeId: 'one', formationName: 'f442', candidates: [{ candidateId: 'candidate-a', instanceIds: ['keeper', ...Array.from({ length: 10 }, (_, index) => `striker-${index}`)] }],
    }] })

    expect(result.results[0].status).toBe('complete')
    expect(result.results[0].chemistry).toBe(27)
  })

  test('原生卡牌与求解快照的版本或属性漂移时阻断候选', async () => {
    const cards = elevenCards()
    for (const card of Object.values(cards)) {
      card.hasQualityTiers = () => true; card.getTier = () => 3
    }
    installNativeChemistry(cards)
    globals.SBCEligibilityQualityType = { 3: 'GOLD' }
    const ids = ['keeper', ...Array.from({ length: 10 }, (_, index) => `striker-${index}`)]

    const result = await evaluateFcSbcChemistryMain({ groups: [{
      challengeId: 'one', formationName: 'f442', candidates: [{
        candidateId: 'candidate-a', instanceIds: ids,
        expectedCards: ids.map(instanceId => ({
          instanceId, cardVersionId: 'expected-version', rating: 75,
          nationId: '1', leagueId: '2', clubId: '3', quality: 'gold',
        })),
      }],
    }] })

    expect(result.results[0]).toMatchObject({
      status: 'blocked', issues: [{ code: 'native-item-changed' }],
    })
  })

  test('原生质量 tier 无法映射为快照质量时阻断候选', async () => {
    const cards = elevenCards({ keeper: 75, striker: 75 })
    for (const card of Object.values(cards)) {
      card.definitionId = 'version'; card.nationId = '1'; card.leagueId = '2'; card.teamId = '3'
      card.hasQualityTiers = () => true; card.getTier = () => 3
    }
    cards.keeper.getTier = () => 99
    installNativeChemistry(cards)
    globals.SBCEligibilityQualityType = { 3: 'GOLD' }
    const ids = ['keeper', ...Array.from({ length: 10 }, (_, index) => `striker-${index}`)]

    const result = await evaluateFcSbcChemistryMain({ groups: [{
      challengeId: 'one', formationName: 'f442', candidates: [{
        candidateId: 'candidate-a', instanceIds: ids,
        expectedCards: ids.map(instanceId => ({
          instanceId, cardVersionId: 'version', rating: 75,
          nationId: '1', leagueId: '2', clubId: '3', quality: 'gold',
        })),
      }],
    }] })

    expect(result.results[0]).toMatchObject({
      status: 'blocked', issues: [{ code: 'native-quality-unrecognized' }],
    })
  })

  test('原生质量 tier 与快照质量不同则标记卡牌已变化', async () => {
    const cards = elevenCards({ keeper: 75, striker: 75 })
    for (const card of Object.values(cards)) {
      card.definitionId = 'version'; card.nationId = '1'; card.leagueId = '2'; card.teamId = '3'
      card.hasQualityTiers = () => true; card.getTier = () => 3
    }
    installNativeChemistry(cards)
    globals.SBCEligibilityQualityType = { 3: 'GOLD' }
    const ids = ['keeper', ...Array.from({ length: 10 }, (_, index) => `striker-${index}`)]

    const result = await evaluateFcSbcChemistryMain({ groups: [{
      challengeId: 'one', formationName: 'f442', candidates: [{
        candidateId: 'candidate-a', instanceIds: ids,
        expectedCards: ids.map(instanceId => ({
          instanceId, cardVersionId: 'version', rating: 75,
          nationId: '1', leagueId: '2', clubId: '3', quality: 'silver',
        })),
      }],
    }] })

    expect(result.results[0]).toMatchObject({
      status: 'blocked', issues: [{ code: 'native-item-changed' }],
    })
  })

  test('Observable 超时与迟到回调均解除读取订阅', async () => {
    vi.useFakeTimers()
    let owner: unknown
    let callback: ((observer: { unobserve: (value: unknown) => void }, value: unknown) => void) | undefined
    let detached = 0; let lateDetached = 0
    installNativeChemistry(elevenCards())
    const runtime = globals as unknown as { services: { Item: { requestItemsById: () => unknown } } }
    runtime.services.Item.requestItemsById = () => ({
      observe: (
        nextOwner: unknown,
        nextCallback: (observer: { unobserve: (value: unknown) => void }, value: unknown) => void,
      ) => { owner = nextOwner; callback = nextCallback },
      unobserve: (value: unknown) => { if (value === owner) detached += 1 },
    })

    const pending = evaluateFcSbcChemistryMain({ timeoutMs: 250, groups: [{
      challengeId: 'one', formationName: 'f442', candidates: [{ candidateId: 'candidate-a', instanceIds: ['keeper', ...Array.from({ length: 10 }, (_, index) => `striker-${index}`)] }],
    }] })
    await vi.advanceTimersByTimeAsync(250)
    await pending
    callback?.({ unobserve: () => { lateDetached += 1 } }, {})

    expect(detached).toBe(2)
    expect(lateDetached).toBe(1)
  })
})
