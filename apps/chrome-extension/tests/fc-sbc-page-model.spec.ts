import { describe, expect, test } from 'vitest'
import { updateFcSbcPageModel } from '../src/fc-sbc-page-model.js'

const page = { tabId: 9, frameId: 0, documentId: 'doc-a', url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/' }
const rows = ['意大利对比利时', '挪威对葡萄牙', '荷兰对德国', '英格兰对西班牙']
const probe = (selected: number, capturedAt: string, titles = rows) => ({
  url: page.url, capturedAt, supported: true, taskType: 'puzzle',
  view: { kind: 'sbc-group', selectedChallenge: { title: titles[selected], visibleIndex: selected } },
  challengeSet: { title: '重大比赛', visibleChallengeCount: titles.length,
    challenges: titles.map((title, index) => ({ challengeId: `visible-${index + 1}`, title, completed: false,
      requirementLines: index === selected ? [`要求 ${title}`] : [],
      rewardLines: index === selected ? [`奖励 ${title}`] : [], textSample: `raw ${title}` })) },
  inventory: { coverage: 'unread', sbcStorageVisible: false, visibleCards: [] },
  warnings: [],
})

describe('FC SBC 页面模型', () => {
  test('同一文档内逐关读取会累积有来源的详情，同时仍标明只覆盖可见关卡', () => {
    const first = updateFcSbcPageModel(null, { page, probe: probe(0, '2026-09-25T01:00:00.000Z') })
    const second = updateFcSbcPageModel(first, { page, probe: probe(1, '2026-09-25T01:01:00.000Z') })
    expect(second).toMatchObject({
      page: { documentId: 'doc-a', tabId: 9 }, view: { kind: 'sbc-group' },
      group: { title: '重大比赛', visibleChallengeCount: 4, observedDetailCount: 2, coverage: 'partial' },
    })
    expect(second.group.challenges[0]).toMatchObject({ title: '意大利对比利时', requirements: ['要求 意大利对比利时'],
      rewards: ['奖励 意大利对比利时'], observedAt: '2026-09-25T01:00:00.000Z' })
    expect(second.group.challenges[1]).toMatchObject({ title: '挪威对葡萄牙', requirements: ['要求 挪威对葡萄牙'],
      rewards: ['奖励 挪威对葡萄牙'], observedAt: '2026-09-25T01:01:00.000Z' })
    expect(second.group.challenges[2].requirements).toBeNull()
    expect(JSON.stringify(second)).not.toContain('raw 意大利')
  })

  test('文档或可见关卡集合变化时不沿用旧详情', () => {
    const first = updateFcSbcPageModel(null, { page, probe: probe(0, '2026-09-25T01:00:00.000Z') })
    const newDocument = updateFcSbcPageModel(first, { page: { ...page, documentId: 'doc-b' },
      probe: probe(1, '2026-09-25T01:01:00.000Z') })
    expect(newDocument.group.observedDetailCount).toBe(1)
    expect(newDocument.group.challenges[0].requirements).toBeNull()
    const changedGroup = updateFcSbcPageModel(first, { page,
      probe: probe(1, '2026-09-25T01:02:00.000Z', ['新的第一关', ...rows.slice(1)]) })
    expect(changedGroup.group.observedDetailCount).toBe(1)
    expect(changedGroup.group.challenges[0].title).toBe('新的第一关')
  })

  test('库存页仅保留覆盖摘要，不将可见卡当作完整实例清单', () => {
    const model = updateFcSbcPageModel(null, { page, probe: {
      url: page.url, capturedAt: '2026-09-25T01:03:00.000Z', supported: true,
      view: { kind: 'sbc-storage', selectedChallenge: null },
      inventory: { coverage: 'visible-only', sbcStorageVisible: true,
        visibleCards: [{ instanceId: 'private-id', textSample: 'private card', rating: 82 }] },
    } })
    expect(model).toMatchObject({ view: { kind: 'sbc-storage' },
      inventory: { coverage: 'visible-only', visibleCardCount: 1, sbcStorageVisible: true } })
    expect(JSON.stringify(model)).not.toContain('private-id')
    expect(model.group).toBeNull()
  })

  test('同一文档退出 FC 页面后清除已积累的关卡和库存观察', () => {
    const first = updateFcSbcPageModel(null, { page, probe: probe(0, '2026-09-25T01:00:00.000Z') })
    const loggedOut = updateFcSbcPageModel(first, { page, probe: {
      url: page.url, capturedAt: '2026-09-25T01:05:00.000Z', supported: false, loginRequired: true,
      view: { kind: 'unknown', selectedChallenge: null },
      inventory: { coverage: 'unread', sbcStorageVisible: false, visibleCards: [] },
    } })
    expect(loggedOut.group).toBeNull()
    expect(loggedOut.inventory.coverage).toBe('unread')
  })
})
