import { describe, expect, it } from 'vitest'
import { duplicateCandidates } from '../src/model.ts'
import type { KnowledgeEntry } from '../src/model.ts'

describe('基础重复候选', () => {
  it('忽略正文空白差异，但区分适用条件，不合并内容', () => {
    const entry: KnowledgeEntry = {
      id: 'a', title: '条目', type: 'method', seedIds: ['a'], depends: [], related: [],
      body: '观察  玩家\n行为。', conditions: '小型原型', citations: [{ sourceId: 'source', snapshotId: 'a'.repeat(64), quote: '观察玩家行为。' }],
    }
    const values = [entry, { ...entry, id: 'b', body: '观察 玩家 行为。' }, { ...entry, id: 'c', conditions: '大型联机游戏' }]
    expect(duplicateCandidates(values)).toEqual([['a', 'b']])
    expect(values[0]).toBe(entry)
    expect(duplicateCandidates([])).toEqual([])
  })
})
