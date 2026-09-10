/**
 * 知识库业务值、来源身份与确定性检查；不依赖 Queue 或模型。
 * @module @changanhua/dsh-knowledge-base/model
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'

/** 用于文件和业务引用的受限 ID。 */
export const knowledgeIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u)
  .refine(id => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(id), 'reserved identifier')
/** 本版本支持的条目类型。 */
export const entryTypeSchema = z.enum(['concept', 'fact', 'method', 'opinion', 'case'])
const ids = () => z.array(knowledgeIdSchema).max(200)
  .refine(values => new Set(values).size === values.length, 'duplicate identifiers')
/** 一条经确认的覆盖要求。 */
export const knowledgeSeedSchema = z.strictObject({
  id: knowledgeIdSchema, title: z.string().trim().min(1).max(240),
  goal: z.string().trim().min(1).max(4000), type: entryTypeSchema,
  depends: ids(), sourceIds: ids().min(1), required: z.boolean(),
})
/** 规格内的内容依赖必须构成有向无环图。 */
export const projectSpecSchema = z.strictObject({
  id: knowledgeIdSchema, title: z.string().trim().min(1).max(240),
  readerTask: z.string().trim().min(1).max(8000),
  language: z.string().trim().min(1).max(64),
  seeds: z.array(knowledgeSeedSchema).max(200),
}).superRefine((spec, ctx) => {
  const nodes = new Map(spec.seeds.map(seed => [seed.id, seed]))
  if (nodes.size !== spec.seeds.length) ctx.addIssue({ code: 'custom', message: 'duplicate seed ids' })
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false
    if (visited.has(id)) return true
    const node = nodes.get(id)
    if (!node) return false
    visiting.add(id)
    for (const parent of node.depends) if (!visit(parent)) return false
    visiting.delete(id)
    visited.add(id)
    return true
  }
  for (const seed of spec.seeds) {
    if (!visit(seed.id)) {
      ctx.addIssue({ code: 'custom', message: 'missing or cyclic prerequisite' })
      break
    }
  }
})
/** 已保存来源的不可变内容与抓取信息。 */
export const sourceSnapshotSchema = z.strictObject({
  sourceId: knowledgeIdSchema,
  snapshotId: z.string().regex(/^[a-f0-9]{64}$/u),
  title: z.string().trim().min(1).max(240),
  text: z.string().min(1).max(200_000), fetchedAt: z.iso.datetime(),
  url: z.url().optional(),
  rawContentHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable().default(null),
  normalizedTextHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable().default(null),
  extractorVersion: z.string().min(1).max(200).default('unknown'),
})
/** 引用绑定具体快照与非空片段。 */
export const citationSchema = z.strictObject({
  sourceId: knowledgeIdSchema, snapshotId: z.string().min(1).max(128),
  quote: z.string().trim().min(1).max(8000),
})
/** 模型结果的封闭 schema，正文与引用分别校验。 */
export const knowledgeEntrySchema = z.strictObject({
  id: knowledgeIdSchema, title: z.string().trim().min(1).max(240),
  type: entryTypeSchema, seedIds: ids().min(1), depends: ids(), related: ids(),
  conditions: z.string().trim().min(1).max(4000),
  body: z.string().trim().min(1).max(80_000),
  citations: z.array(citationSchema).min(1).max(80),
})
/** 经校验的主题规格。 */
export type ProjectSpec = z.infer<typeof projectSpecSchema>
/** 一条主题覆盖要求。 */
export type KnowledgeSeed = z.infer<typeof knowledgeSeedSchema>
/** 一份不可变来源快照。 */
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>
/** 一份带可定位引用的条目。 */
export type KnowledgeEntry = z.infer<typeof knowledgeEntrySchema>

/**
 * 列出正文与适用条件在空白归一化后相同的条目，作为待复核候选而非自动合并依据。
 * @param entries - 已解析的当前条目。
 * @returns 至少包含两个稳定条目 ID 的候选组。
 */
export function duplicateCandidates(entries: readonly KnowledgeEntry[]): string[][] {
  const groups = new Map<string, string[]>()
  for (const entry of entries) {
    const key = canonicalHash([entry.body.replace(/\s+/gu, ' ').trim(), entry.conditions.replace(/\s+/gu, ' ').trim()])
    const group = groups.get(key) ?? []
    group.push(entry.id)
    groups.set(key, group)
  }
  return [...groups.values()].filter(group => group.length > 1).map(group => [...group].sort())
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}'
  }
  throw new Error('knowledge-base: canonical input must contain only finite JSON values')
}

/**
 * 计算与对象键顺序无关的 SHA-256；非 JSON 值不能静默漏掉。
 * @param value - 有限 JSON 数据。
 * @returns 小写十六进制摘要。
 */
export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

/**
 * 固定来源内容身份；抓取时间不参与该身份。
 * @param sourceId - 逻辑来源 ID。
 * @param title - 来源标题。
 * @param text - 允许保存的来源文本。
 * @param fetchedAt - ISO 抓取时间。
 * @param url - 可选来源地址。
 * @param provenance - 可选抓取或导入溯源元数据。
 * @returns 校验后的快照。
 */
export function sourceSnapshot(
  sourceId: string, title: string, text: string, fetchedAt: string, url?: string,
  provenance?: { rawContentHash?: string; extractorVersion?: string },
): SourceSnapshot {
  const normalized = text.replace(/\r\n?/gu, '\n')
  return sourceSnapshotSchema.parse({
    sourceId, title, text: normalized, fetchedAt,
    snapshotId: canonicalHash(normalized), ...(url === undefined ? {} : { url }),
    rawContentHash: provenance?.rawContentHash ?? createHash('sha256').update(text, 'utf8').digest('hex'),
    normalizedTextHash: createHash('sha256').update(normalized, 'utf8').digest('hex'),
    extractorVersion: provenance?.extractorVersion ?? 'import-text-v1',
  })
}

/**
 * 核对归属、前置与字面引用；空结果不证明语义正确。
 * @param entry - 已解析条目。
 * @param spec - 已确认规格。
 * @param sources - 本次允许使用的快照。
 * @returns 稳定问题代码。
 */
export function checkEntry(entry: KnowledgeEntry, spec: ProjectSpec, sources: readonly SourceSnapshot[]): string[] {
  const issues: string[] = []
  const seed = spec.seeds.find(item => item.id === entry.id)
  if (!seed) return ['entry_not_planned:' + entry.id]
  if (entry.type !== seed.type) issues.push('type_mismatch:' + entry.id)
  if (!entry.seedIds.includes(seed.id) || entry.seedIds.some(id => !spec.seeds.some(item => item.id === id))) {
    issues.push('seed_mismatch:' + entry.id)
  }
  if (canonicalHash([...entry.depends].sort()) !== canonicalHash([...seed.depends].sort())) {
    issues.push('dependency_mismatch:' + entry.id)
  }
  for (const id of entry.related) {
    if (!spec.seeds.some(item => item.id === id)) issues.push('related_missing:' + id)
  }
  for (const citation of entry.citations) {
    const source = sources.find(item => item.sourceId === citation.sourceId && item.snapshotId === citation.snapshotId)
    if (!seed.sourceIds.includes(citation.sourceId)) issues.push('citation_source_not_allowed:' + citation.sourceId)
    if (!source) issues.push('citation_snapshot_missing:' + citation.sourceId)
    else if (!source.text.includes(citation.quote)) issues.push('citation_quote_missing:' + citation.sourceId)
  }
  return [...new Set(issues)]
}

/**
 * 沿内容依赖反向传播，不把 related 关联当作重生成条件。
 * @param initial - 直接受影响的条目。
 * @param entries - 声明依赖的条目或种子。
 * @returns 排序后的影响闭包。
 */
export function impactClosure(
  initial: readonly string[], entries: readonly { readonly id: string; readonly depends: readonly string[] }[],
): string[] {
  const result = new Set(initial)
  let changed = true
  while (changed) {
    changed = false
    for (const entry of entries) {
      if (!result.has(entry.id) && entry.depends.some(id => result.has(id))) {
        result.add(entry.id)
        changed = true
      }
    }
  }
  return [...result].sort()
}
