import { describe, expect, it } from 'vitest'
import { createKnowledgeMap, renderKnowledgeMap } from '../src/map.ts'
import type { KnowledgeEntry, ProjectSpec } from '../src/model.ts'

const spec: ProjectSpec = {
  id: 'balcony', title: '阳台植物养护', readerTask: '判断浇水时机并记录观察', language: 'zh-CN',
  seeds: [
    { id: 'water', title: '决定是否浇水', goal: '根据观察决定本轮操作', type: 'method', depends: ['observe'], sourceIds: ['manual'], required: true },
    { id: 'observe', title: '观察土壤', goal: '记录表层和深层的湿度', type: 'method', depends: [], sourceIds: ['manual'], required: true },
    { id: 'repot', title: '换盆选读', goal: '判断是否需要换盆', type: 'method', depends: ['observe'], sourceIds: ['manual'], required: false },
  ],
}
const observed: KnowledgeEntry = {
  id: 'observe', title: '先观察湿度', type: 'method', seedIds: ['observe'], depends: [], related: ['water', 'unplanned'],
  conditions: '有排水孔的盆栽', body: '先记录，再决定。', citations: [{ sourceId: 'manual', snapshotId: 'a'.repeat(64), quote: '观察湿度' }],
}

describe('每个知识任务的地图', () => {
  it('按自身规划构造依赖层次，保留未生成和可选单元，并引用已提交标题', () => {
    const map = createKnowledgeMap(spec, [observed])
    expect(map.layers).toEqual([['observe'], ['water', 'repot']])
    expect(map.nodes.find(node => node.id === 'observe')).toMatchObject({ title: '先观察湿度', included: true, related: ['water'] })
    expect(map.nodes.find(node => node.id === 'repot')).toMatchObject({ included: false, required: false })
    const markdown = renderKnowledgeMap(map, { observe: '[先观察湿度](entry-observe.md)' })
    expect(markdown).toContain(spec.readerTask)
    expect(markdown).toContain('前置知识：[先观察湿度](entry-observe.md)')
    expect(markdown).toContain('要解决的问题：根据观察决定本轮操作')
    expect(markdown).toContain('相关知识：决定是否浇水')
    expect(markdown).toContain('待生成或本版本未收录；规划要求：可选')
    expect(markdown).not.toContain('entry-water.md')
    expect(markdown).not.toContain('AI 第一阶段')
    expect(spec.seeds[0]?.title).toBe('决定是否浇水')
  })

  it('规划前展示任务目标和待规划状态，不假称地图已覆盖主题', () => {
    const map = createKnowledgeMap({ ...spec, seeds: [] }, [])
    expect(map.layers).toEqual([])
    expect(renderKnowledgeMap(map, {})).toContain('尚未形成条目规划')
    expect(renderKnowledgeMap(map, {})).toContain('规划完成不证明主题无遗漏')
  })

  it('拒绝循环或缺失前置的规划，不陷入排序循环', () => {
    expect(() => createKnowledgeMap({ ...spec, seeds: [{ ...spec.seeds[0]!, depends: ['missing'] }] }, [])).toThrow()
  })
})
