import { describe, expect, it } from 'vitest'
import {
  canonicalHash, checkEntry, impactClosure, knowledgeEntrySchema,
  projectSpecSchema, sourceSnapshot,
} from '../src/model.ts'
import { reviewDecisionSchema } from '../src/state.ts'

const seed = (id: string, depends: string[] = []) => ({
  id, title: id, goal: '帮助创作者明确下一步 AI 任务', type: 'method',
  depends, sourceIds: ['engine'], required: true,
})
const spec = {
  id: 'game-vibe', title: 'AI 游戏开发', readerTask: '写出玩法说明与试玩清单',
  language: 'zh-CN', seeds: [seed('prototype'), seed('playtest', ['prototype'])],
}
const source = sourceSnapshot('engine', '引擎资料', '先验证核心玩法。\n每次只改变一个机制。', '2026-09-08T00:00:00.000Z')
const entry = {
  id: 'prototype', title: '原型范围', type: 'method', seedIds: ['prototype'],
  depends: [], related: ['playtest'], conditions: '个人小型游戏',
  body: '先验证核心玩法，再扩展内容。', citations: [{
    sourceId: 'engine', snapshotId: source.snapshotId, quote: '先验证核心玩法。',
  }],
}

describe('知识库业务输入', () => {
  it('拒绝可逃逸路径、未知字段、重复节点、缺失前置与内容依赖环', () => {
    expect(projectSpecSchema.safeParse(spec).success).toBe(true)
    expect(projectSpecSchema.safeParse({ ...spec, id: '../escape' }).success).toBe(false)
    expect(projectSpecSchema.safeParse({ ...spec, executable: 'cmd.exe' }).success).toBe(false)
    expect(projectSpecSchema.safeParse({ ...spec, seeds: [seed('a'), seed('a')] }).success).toBe(false)
    expect(projectSpecSchema.safeParse({ ...spec, seeds: [seed('a', ['missing'])] }).success).toBe(false)
    expect(projectSpecSchema.safeParse({ ...spec, seeds: [seed('a', ['b']), seed('b', ['a'])] }).success).toBe(false)
  })

  it('同一内容有稳定快照身份，抓取时间不改变内容身份', () => {
    const later = sourceSnapshot('engine', '引擎资料', source.text, '2026-09-09T00:00:00.000Z')
    expect(later.snapshotId).toBe(source.snapshotId)
    expect(sourceSnapshot('engine', '引擎资料', '不同内容', source.fetchedAt).snapshotId).not.toBe(source.snapshotId)
    expect(canonicalHash({ b: 1, a: 2 })).toBe(canonicalHash({ a: 2, b: 1 }))
    expect(() => canonicalHash({ missing: undefined })).toThrow()
  })

  it('引用绑定具体快照与字面片段，旧快照/伪造片段无法通过', () => {
    const project = projectSpecSchema.parse(spec)
    const parsed = knowledgeEntrySchema.parse(entry)
    expect(checkEntry(parsed, project, [source])).toEqual([])
    expect(checkEntry({ ...parsed, citations: [{ ...parsed.citations[0]!, quote: '来源没有说过的话' }] }, project, [source]))
      .toContain('citation_quote_missing:engine')
    expect(checkEntry({ ...parsed, citations: [{ ...parsed.citations[0]!, snapshotId: 'obsolete' }] }, project, [source]))
      .toContain('citation_snapshot_missing:engine')
    expect(checkEntry({ ...parsed, depends: ['missing'] }, project, [source])).toContain('dependency_mismatch:prototype')
    expect(checkEntry({ ...parsed, seedIds: ['unplanned'] }, project, [source])).toContain('seed_mismatch:prototype')
  })

  it('只传播声明的内容依赖，普通知识关联不进入影响闭包', () => {
    const entries = [
      { ...entry, id: 'a', depends: [], related: ['d'] },
      { ...entry, id: 'b', depends: ['a'], related: [] },
      { ...entry, id: 'c', depends: ['b'], related: [] },
      { ...entry, id: 'd', depends: [], related: ['a'] },
    ].map(value => knowledgeEntrySchema.parse(value))
    expect(impactClosure(['a'], entries)).toEqual(['a', 'b', 'c'])
  })

  it('逐项报告条目类型、关联和来源授权错误，并接受显式 URL 来源', () => {
    const project = projectSpecSchema.parse(spec)
    const withUrl = sourceSnapshot('engine', '引擎资料', '先验证核心玩法。', '2026-09-08T00:00:00.000Z', 'https://example.test/engine')
    expect(withUrl.url).toBe('https://example.test/engine')
    const parsed = knowledgeEntrySchema.parse({
      ...entry, type: 'fact', related: ['missing'], seedIds: ['prototype', 'missing'],
      citations: [{ ...entry.citations[0], sourceId: 'other', snapshotId: withUrl.snapshotId }],
    })
    expect(checkEntry(parsed, project, [withUrl])).toEqual(expect.arrayContaining([
      'type_mismatch:prototype', 'seed_mismatch:prototype', 'related_missing:missing',
      'citation_source_not_allowed:other', 'citation_snapshot_missing:other',
    ]))
    expect(checkEntry({ ...parsed, id: 'unplanned' }, project, [withUrl])).toEqual(['entry_not_planned:unplanned'])
  })

  it('审查 schema 不允许带问题的通过结论', () => {
    expect(reviewDecisionSchema.safeParse({ status: 'pass', issues: [], summary: '支持。' }).success).toBe(true)
    expect(reviewDecisionSchema.safeParse({ status: 'pass', issues: ['缺引用'], summary: '矛盾。' }).success).toBe(false)
  })
})
