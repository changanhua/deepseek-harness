/** 从每次任务的规划与条目构造同源的阅读地图，不绑定任何示例主题。 */
import { projectSpecSchema } from './model.ts'
import type { KnowledgeEntry, ProjectSpec } from './model.ts'

/** 地图中的任务单元；收录状态不代表语义审查通过。 */
export interface KnowledgeMapNode {
  id: string
  title: string
  goal: string
  required: boolean
  depends: string[]
  related: string[]
  sourceIds: string[]
  included: boolean
}
/** 由规划和已收录条目重建的地图快照，分组表示前置层次。 */
export interface KnowledgeMap {
  projectId: string
  title: string
  readerTask: string
  nodes: KnowledgeMapNode[]
  layers: string[][]
}

/**
 * 为任意知识任务生成地图，规划尚无条目时也返回任务目标。
 * @param specification - 已确认或待确认的任务规划。
 * @param entries - 本次地图收录的条目；未生成单元保留在地图中。
 * @returns 按前置关系排列的结构化地图。
 */
export function createKnowledgeMap(specification: ProjectSpec, entries: readonly KnowledgeEntry[]): KnowledgeMap {
  const spec = projectSpecSchema.parse(specification)
  const available = new Map(entries.map(entry => [entry.id, entry]))
  const known = new Set(spec.seeds.map(seed => seed.id))
  const nodes = spec.seeds.map((seed): KnowledgeMapNode => ({
    id: seed.id, title: available.get(seed.id)?.title ?? seed.title, goal: seed.goal,
    required: seed.required, depends: seed.depends, sourceIds: seed.sourceIds,
    related: (available.get(seed.id)?.related ?? []).filter(id => known.has(id)), included: available.has(seed.id),
  }))
  const pending = new Map(nodes.map(node => [node.id, node]))
  const layers: string[][] = []
  while (pending.size) {
    const ready = [...pending.values()].filter(node => node.depends.every(id => !pending.has(id))).map(node => node.id)
    layers.push(ready)
    for (const id of ready) pending.delete(id)
  }
  return { projectId: spec.id, title: spec.title, readerTask: spec.readerTask, nodes, layers }
}

/**
 * 使用同一结构生成文件地图或思源地图，链接由目标载体提供。
 * @param map - 本次任务或版本的地图。
 * @param links - 稳定条目 ID 到阅读链接的映射；未收录条目不生成死链接。
 * @returns 包含目标、阅读顺序、单元用途与关系的 Markdown。
 */
export function renderKnowledgeMap(map: KnowledgeMap, links: Readonly<Record<string, string>>): string {
  const byId = new Map(map.nodes.map(node => [node.id, node]))
  const label = (id: string): string => links[id] ?? (byId.get(id) as KnowledgeMapNode).title
  const sections = map.layers.map((layer, index) => '## 阅读层次 ' + String(index + 1) + '\n\n'
    + layer.map((id) => {
      const node = byId.get(id) as KnowledgeMapNode
      return '### ' + label(id) + '\n\n要解决的问题：' + node.goal
        + '\n\n前置知识：' + (node.depends.map(label).join('、') || '无，可作为起点')
        + '\n\n相关知识：' + (node.related.map(label).join('、') || '未指定')
        + '\n\n来源标识：' + node.sourceIds.join('、')
        + '\n\n收录状态：' + (node.included ? '本地图已收录' : '待生成或本版本未收录')
        + '；规划要求：' + (node.required ? '必需' : '可选')
    }).join('\n\n')).join('\n\n')
  return '# ' + map.title + ' · 知识地图\n\n读者任务：' + map.readerTask
    + '\n\n按前置层次选择阅读起点，已有基础时可直接跳到目标单元。每个单元说明用途、前置与关联；同层次不强制阅读先后。'
    + '\n\n' + (sections || '尚未形成条目规划；补充来源并完成规划后，这里会自动列出阅读单元。')
    + '\n\n地图依据本次规划自动生成；已收录不等于已验证，规划完成不证明主题无遗漏或全库语义一致。\n'
}
