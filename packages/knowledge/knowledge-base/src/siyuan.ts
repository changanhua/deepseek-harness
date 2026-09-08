/** 思源保存可编辑正文；本域只保存内容观察、写入意图和版本映射。 */
import { z } from 'zod'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { canonicalHash, knowledgeEntrySchema, knowledgeIdSchema } from './model.ts'
import type { KnowledgeEntry } from './model.ts'
import type { SiyuanGateway } from './siyuan-gateway.ts'

const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const doc = z.strictObject({ documentId: z.string().min(1), contentHash: digest, title: z.string(), hPath: z.string() })
const intent = z.strictObject({
  title: z.string(), parentPath: z.string(), path: z.string(), markdown: z.string(),
  state: z.enum(['prepared', 'dispatched', 'confirmed']), documentId: z.string().nullable(),
})
/** 持久写入协议的 schema；不复制 Queue Work/Attempt。 */
export const siyuanProjectSchema = z.strictObject({
  projectId: knowledgeIdSchema, notebook: z.string(), rootPath: z.string(),
  root: doc.nullable(), currentVersion: knowledgeIdSchema.nullable(), targetVersion: knowledgeIdSchema.nullable(),
  entries: z.record(knowledgeIdSchema, z.strictObject({
    documentId: z.string(), baseline: digest, accepted: knowledgeEntrySchema,
    candidates: z.record(digest, doc), footerHash: digest,
    baselineDocument: z.strictObject({ title: z.string(), markdown: z.string() }),
  })),
  intents: z.record(z.string(), intent), versions: z.record(knowledgeIdSchema, z.strictObject({
    fingerprint: digest, entries: z.record(knowledgeIdSchema, knowledgeEntrySchema), catalog: doc.nullable(), complete: z.boolean(),
  })),
})
/** 独立内容连接记录，不改变已交付的生成域格式。 */
export const siyuanProjectionDomainSpec = defineDomain({
  name: 'knowledge_base_siyuan', version: 1,
  tables: { projects: domainTable<string, z.infer<typeof siyuanProjectSchema>>(siyuanProjectSchema) },
})
export type SiyuanProjectMapping = z.infer<typeof siyuanProjectSchema>
/** 可信 Profile 固定目标库与主题根；模型不能选择存储位置。 */
export interface SiyuanConfig { notebook: string; rootPath: string; projectRoots?: Record<string, string> }
/** 已发布的内容和必要来源元数据。 */
export interface SiyuanProjectInput {
  projectId: string
  title: string
  readerTask: string
  version: string
  entries: KnowledgeEntry[]
  sources: { sourceId: string; snapshotId: string; title: string; url?: string }[]
}
const FOOTER = '## 来源与适用范围'
const BODY = '## 知识正文'

/**
 * 去除思源生成的块属性；代码块内的同形文字保留。
 *
 * @param text - 思源回读的 Kramdown 文本。
 * @returns 不带思源块属性的正文。
 */
export function plainKramdown(text: string): string {
  let fence: string | null = null
  const lines: string[] = []
  for (const line of text.replace(/\r\n?/gu, '\n').split('\n')) {
    const code = /^\s*(?:>\s*)*(`{3,}|~{3,})/u.exec(line)?.[1]
    if (code) {
      if (fence === null) fence = code
      else if (code[0] === fence[0] && code.length >= fence.length) fence = null
      lines.push(line); continue
    }
    if (fence !== null) { lines.push(line); continue }
    // 空白列、引用与列表块的 IAL 均由服务端生成。
    if (/^\s*(?:>\s*)*\{:\s+id="\d{14}-[a-z0-9]{7}"[^\n]*\}\s*$/u.test(line)) continue
    lines.push(line.replace(/([*-]\s+|\d+[.)]\s+)\{:\s+id="\d{14}-[a-z0-9]{7}"[^\n]*?\}\s*/gu, '$1'))
  }
  return lines.join('\n').replace(/\u200b/gu, '').trim()
}
/**
 * 用 Markdown 语法树比较内容，保留链接、代码、表格与强调的语义。
 *
 * @param markdown - 要比较的 Markdown 或 Kramdown 文本。
 * @returns 忽略位置和思源块属性后的稳定摘要。
 */
export function markdownIdentity(markdown: string): string {
  const tree = fromMarkdown(plainKramdown(markdown), { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  type TreeNode = { type: string; value?: string; children?: TreeNode[]; ordered?: boolean | null | undefined }
  // mdast 的 text 和 list 节点分别保证 value 和 children；局部视图仅用于变换后的可变树。
  type TextNode = TreeNode & { value: string }
  type ParentNode = TreeNode & { children: TreeNode[] }
  const normalize = (node: TreeNode): TreeNode => {
    if (node.type === 'text' && node.value) node.value = node.value.replace(/[ \t\n]+/gu, ' ')
    if (node.children) node.children = node.children.flatMap((child) => {
      if (child.type === 'break') return [{ type: 'text', value: ' ' }]
      if (child.type === 'text' && child.value) {
        // Lute 接受中文标点紧邻闭合加粗；CommonMark 需要其后的分隔空白。仅处理文本节点，不改代码或 URL。
        const text = child.value.replace(/(\*\*[^*\n]*[：；，。！？]\*\*)(?=\S)/gu, '$1 ')
        if (text !== child.value) {
          const parsed = fromMarkdown(text).children[0]
          if (parsed?.type === 'paragraph') {
            const children: TreeNode[] = parsed.children
            const leading = text.slice(0, text.length - text.trimStart().length)
            const trailing = text.slice(text.trimEnd().length)
            if (leading) children.unshift({ type: 'text', value: leading })
            if (trailing) children.push({ type: 'text', value: trailing })
            return children.map(normalize)
          }
        }
      }
      return [normalize(child)]
    })
    if (node.children) node.children = node.children.flatMap((child) => {
      if (child.type !== 'strong' || !child.children?.some(item => item.type === 'inlineCode')) return [child]
      const pieces: TreeNode[] = []
      for (const item of child.children) {
        if (item.type !== 'text') { pieces.push({ type: 'strong', children: [item] }); continue }
        const text = (item as TextNode).value
        if (/^\s/u.test(text)) pieces.push({ type: 'text', value: ' ' })
        if (text.trim()) pieces.push({ type: 'strong', children: [{ type: 'text', value: text.trim() }] })
        if (/\s$/u.test(text)) pieces.push({ type: 'text', value: ' ' })
      }
      return pieces
    })
    if (node.children) {
      const merged: TreeNode[] = []
      for (const child of node.children) {
        const last = merged[merged.length - 1]
        if (last && ['inlineCode', 'strong', 'emphasis', 'delete'].includes(last.type) && child.type === 'text' && child.value && /^[\p{Script=Han}，。！？：；、（）《》【】]/u.test(child.value)) child.value = ' ' + child.value
        if (['inlineCode', 'strong', 'emphasis', 'delete'].includes(child.type) && last?.type === 'text' && last.value && /[\p{Script=Han}，。！？：；、（）《》【】]$/u.test(last.value)) last.value += ' '
        if (last?.type === 'text' && child.type === 'text') {
          last.value = ((last as TextNode).value + (child as TextNode).value).replace(/[ \t\n]+/gu, ' ')
        } else if (last?.type === 'list' && child.type === 'list' && !last.ordered && !child.ordered) {
          (last as ParentNode).children.push(...(child as ParentNode).children)
        }
        else merged.push(child)
      }
      node.children = merged
    }
    return node
  }
  normalize(tree)
  const material = JSON.parse(JSON.stringify(tree, (key, value: unknown) => key === 'position' || key === 'spread' ? undefined : value)) as unknown
  return canonicalHash(material)
}
function pathChild(parent: string, title: string): string {
  return (parent === '/' ? '' : parent) + '/' + title.replace(/[\/\\\r\n]/gu, ' ')
}
function quote(title: string): string { return title.replace(/["\\]/gu, '\\$&') }
function entryDocument(project: SiyuanProjectInput, entry: KnowledgeEntry, record: SiyuanProjectMapping): string {
  if (entry.body.includes(BODY) || entry.body.includes(FOOTER)) throw new Error('knowledge-base: reserved document section in body')
  const parents = entry.depends.map((id) => {
    // 拓扑校验保证前置输入存在，且同步循环已先持久化它的文档映射。
    const mapped = record.entries[id] as SiyuanProjectMapping['entries'][string]
    const title = (project.entries.find(item => item.id === id) as KnowledgeEntry).title
    return `((${mapped.documentId} "${quote(title)}"))`
  })
  const sources = entry.citations.map((citation) => {
    const source = project.sources.find(item => item.sourceId === citation.sourceId && item.snapshotId === citation.snapshotId)
    if (!source) throw new Error('knowledge-base: missing citation snapshot')
    return `- ${source.url ? '[' + source.title + '](' + source.url + ')' : source.title}：${citation.quote}\n\n  来源版本：${citation.snapshotId}`
  }).join('\n\n')
  return `${BODY}\n\n${entry.body}\n\n${FOOTER}\n\n适用条件：${entry.conditions}\n\n前置知识：${parents.join('、') || '无'}\n\n${sources}\n\n条目标识：DSHKB ${project.projectId} ${entry.id}\n`
}
function sections(markdown: string): { body: string; footer: string } {
  const clean = plainKramdown(markdown)
  if (!clean.startsWith(BODY + '\n')) throw new Error('knowledge-base: missing knowledge body section')
  const split = clean.indexOf('\n' + FOOTER + '\n')
  if (split < 0 || clean.indexOf('\n' + FOOTER + '\n', split + 1) >= 0) throw new Error('knowledge-base: invalid source section')
  return { body: clean.slice(BODY.length, split).trim(), footer: clean.slice(split).trim() }
}
function ordered(entries: KnowledgeEntry[]): KnowledgeEntry[] {
  const remaining = new Map(entries.map(entry => [entry.id, entry]))
  if (remaining.size !== entries.length) throw new Error('knowledge-base: duplicate entry identity')
  const result: KnowledgeEntry[] = []
  while (remaining.size) {
    const next = [...remaining.values()].find(entry => entry.depends.every(id => result.some(parent => parent.id === id)))
    if (!next) throw new Error('knowledge-base: missing or cyclic prerequisites')
    remaining.delete(next.id); result.push(next)
  }
  return result
}

/** 同一域持有者串行操作；跨应用编辑通过观察快照检测，永不原地覆盖远端正文。 */
export class KnowledgeSiyuanProjection {
  private readonly projects: KvTable<string, SiyuanProjectMapping>
  private tail: Promise<void> = Promise.resolve()
  private readonly lifetime = new AbortController()
  private readonly reads = new Set<Promise<unknown>>()
  private closing?: Promise<void>
  private constructor(
    private readonly domain: Domain<typeof siyuanProjectionDomainSpec>,
    private readonly gateway: SiyuanGateway, private readonly config: SiyuanConfig,
  ) { this.projects = domain.table('projects') }
  /**
   * 打开思源投影的独立持久映射。
   *
   * @param facility - 受管持久 Domain facility。
   * @param gateway - 原生 MCP 网关。
   * @param config - 可信的思源目标配置。
   * @returns 可关闭的思源投影。
   */
  static async open(facility: DomainFacility, gateway: SiyuanGateway, config: SiyuanConfig): Promise<KnowledgeSiyuanProjection> {
    const fixed = structuredClone(config)
    if (!fixed.notebook || !fixed.rootPath.startsWith('/') || fixed.rootPath.split('/').some(part => part === '..' || part === '.')) {
      throw new Error('knowledge-base: invalid SiYuan target')
    }
    return new KnowledgeSiyuanProjection(await facility.open(siyuanProjectionDomainSpec), gateway, fixed)
  }
  /**
   * 返回项目的隔离思源映射。
   *
   * @param projectId - 项目 ID。
   * @returns 当前持久映射的副本。
   */
  status(projectId: string): SiyuanProjectMapping {
    const record = this.projects.get(projectId)
    if (!record) throw new Error('knowledge-base: SiYuan project is not synchronized')
    if (record.notebook !== this.config.notebook || record.rootPath !== this.config.rootPath) throw new Error('knowledge-base: SiYuan target changed')
    return structuredClone(record)
  }
  /**
   * 判断项目是否已有思源内容绑定。
   *
   * @param projectId - 项目 ID。
   * @returns 项目是否存在持久映射。
   */
  has(projectId: string): boolean { return this.projects.get(projectId) !== undefined }
  /**
   * 同步正式发布版本，创建首个正文或独立更新候选。
   *
   * @param project - 不可变发布输入。
   * @param signal - 调用取消信号。
   * @returns 创建、候选与冲突清单；complete 只表示目标内容当前完全匹配。
   */
  sync(project: SiyuanProjectInput, signal: AbortSignal): Promise<{
    createdEntries: string[]
    candidates: string[]
    conflicts: string[]
    complete: boolean
    rootDocumentId: string
  }> {
    signal = AbortSignal.any([signal, this.lifetime.signal])
    const input = structuredClone(project)
    knowledgeIdSchema.parse(input.projectId); knowledgeIdSchema.parse(input.version)
    input.entries = input.entries.map(entry => knowledgeEntrySchema.parse(entry))
    const sorted = ordered(input.entries)
    return this.serial(async () => {
      signal.throwIfAborted()
      let record = this.projects.get(input.projectId)
      if (!record) {
        record = { projectId: input.projectId, notebook: this.config.notebook, rootPath: this.config.rootPath,
          root: null, currentVersion: null, targetVersion: null, entries: {}, intents: {}, versions: {} }
        await this.save(record)
      } else record = this.status(input.projectId)
      const fingerprint = canonicalHash(input)
      const version = record.versions[input.version]
      if (version && version.fingerprint !== fingerprint) throw new Error('knowledge-base: immutable SiYuan version changed')
      record.targetVersion = input.version
      record.versions[input.version] ??= {
        fingerprint, entries: Object.fromEntries(input.entries.map(entry => [entry.id, entry])), catalog: null, complete: false,
      }
      await this.save(record)
      if (!record.root) {
        const configured = this.config.projectRoots?.[input.projectId]
        if (configured) {
          const observed = await this.read(configured, signal)
          record.root = {
            documentId: configured, title: observed.title, hPath: observed.hPath, contentHash: markdownIdentity(observed.markdown),
          }
        } else record.root = await this.ensure(record, '@root', this.config.rootPath, input.title,
          `# ${input.title}\n\n${input.readerTask}\n\n子文档保存知识条目与版本目录。更新建议保存为独立候选，正文可在思源中继续维护。\n\nDSHKB ${input.projectId} project\n`, signal)
        await this.save(record)
      }
      const root = await this.read(record.root.documentId, signal)
      const createdEntries: string[] = [], candidates: string[] = [], conflicts: string[] = []
      for (const entry of sorted) {
        signal.throwIfAborted()
        const prior = record.entries[entry.id]
        if (!prior) {
          const markdown = entryDocument(input, entry, record)
          const created = await this.ensure(record, 'entry:' + entry.id, root.hPath, entry.title, markdown, signal)
          record.entries[entry.id] = { documentId: created.documentId, baseline: this.snapshot(created.title, markdown),
            accepted: entry, candidates: {}, footerHash: markdownIdentity(sections(markdown).footer),
            baselineDocument: { title: created.title, markdown } }
          await this.save(record); createdEntries.push(entry.id)
          continue
        }
        const observed = await this.inspectRecord(record, entry.id, signal)
        if (observed.snapshotHash !== this.baseline(prior)) conflicts.push(entry.id)
        if (canonicalHash(entry) !== canonicalHash(prior.accepted)) {
          const key = canonicalHash(entry)
          const markdown = entryDocument(input, entry, record)
          prior.candidates[key] ??= await this.ensure(record, 'candidate:' + entry.id + ':' + key, root.hPath,
            entry.title + ' — 更新建议 ' + key.slice(0, 12),
            `原条目：((${prior.documentId} "${quote(prior.accepted.title)}"))\n\n此文档是更新候选，尚未替换原正文。\n\n${markdown}`, signal)
          await this.save(record); candidates.push(entry.id)
        }
      }
      const complete = conflicts.length === 0 && candidates.length === 0
        && Object.keys(record.entries).length === input.entries.length
      const current = record.versions[input.version] as SiyuanProjectMapping['versions'][string]
      if (!current.catalog) {
        const entries = record.entries
        const links = sorted.map((entry) => {
          const mapped = entries[entry.id] as SiyuanProjectMapping['entries'][string]
          return `- ((${mapped.documentId} "${quote(entry.title)}"))`
        }).join('\n')
        current.catalog = await this.ensure(record, 'version:' + input.version, root.hPath, '版本目录 ' + input.version,
          `# ${input.title} · ${input.version}\n\n${input.readerTask}\n\n这是版本阅读目录，链接指向可继续编辑的当前条目。当前内容是否与本版本一致，需重新运行思源检查；本目录不是实时通过凭证。\n\n${links}\n\nDSHKB ${input.projectId} version ${input.version}\n`, signal)
      }
      current.complete = complete
      if (complete) record.currentVersion = input.version
      await this.save(record)
      return { createdEntries, candidates, conflicts, complete, rootDocumentId: record.root.documentId }
    })
  }
  /**
   * 读取一个可编辑条目和其接纳快照。
   *
   * @param projectId - 项目 ID。
   * @param entryId - 条目 ID。
   * @param signal - 调用取消信号。
   * @returns 当前条目、快照摘要和文档 ID。
   */
  inspect(projectId: string, entryId: string, signal: AbortSignal): Promise<{
    entry: KnowledgeEntry
    snapshotHash: string
    documentId: string
  }> {
    signal = AbortSignal.any([signal, this.lifetime.signal])
    return this.readOperation(async () => {
      const observed = await this.inspectRecord(this.status(projectId), entryId, signal)
      return { entry: observed.entry, snapshotHash: observed.snapshotHash, documentId: observed.documentId }
    })
  }
  /**
   * 接纳用户已检查的远端正文，并保存新的观察基线。
   *
   * @param projectId - 项目 ID。
   * @param entryId - 条目 ID。
   * @param expected - 用户检查到的快照摘要。
   * @param adopt - 写入本地业务记录的接纳回调。
   * @param signal - 调用取消信号。
   * @returns 接纳完成后兑现；条目仍需重新审查。
   */
  accept(projectId: string, entryId: string, expected: string,
    adopt: (entry: KnowledgeEntry) => Promise<void>, signal: AbortSignal): Promise<void> {
    signal = AbortSignal.any([signal, this.lifetime.signal])
    return this.serial(async () => {
      const record = this.status(projectId), observed = await this.inspectRecord(record, entryId, signal)
      if (observed.snapshotHash !== expected) throw new Error('knowledge-base: SiYuan content changed after inspection')
      signal.throwIfAborted()
      await adopt(observed.entry)
      const mapped = record.entries[entryId] as SiyuanProjectMapping['entries'][string]
      mapped.accepted = observed.entry
      mapped.baseline = observed.snapshotHash
      mapped.baselineDocument = observed.baselineDocument
      await this.save(record)
      // 若用户在本地接纳期间继续编辑，不假称两端一致；下一次读取仍会要求接纳。
      if ((await this.inspectRecord(record, entryId, signal)).snapshotHash !== expected) throw new Error('knowledge-base: SiYuan changed during adoption; inspect again')
    })
  }
  /**
   * 用实时回读和搜索索引核验一个项目。
   *
   * @param projectId - 项目 ID。
   * @param signal - 调用取消信号。
   * @returns 文档数量、索引可见性、冲突和完成状态。
   */
  async verify(projectId: string, signal: AbortSignal): Promise<{
    documents: number
    searchable: boolean
    conflicts: string[]
    complete: boolean
  }> {
    signal = AbortSignal.any([signal, this.lifetime.signal])
    return this.readOperation(async () => {
      const record = this.status(projectId), conflicts: string[] = []
      for (const [id, mapped] of Object.entries(record.entries)) {
        const observed = await this.read(mapped.documentId, signal)
        if (this.snapshot(observed.title, observed.markdown) !== this.baseline(mapped)) conflicts.push(id)
      }
      if (record.root) await this.read(record.root.documentId, signal)
      const matches = new Set(await this.gateway.search(this.config.notebook, 'DSHKB ' + projectId, signal))
      const searchable = Object.values(record.entries).every(entry => matches.has(entry.documentId))
      const target = record.targetVersion ? record.versions[record.targetVersion] : undefined
      const matchesTarget = target && Object.keys(target.entries).length === Object.keys(record.entries).length
      && Object.entries(target.entries).every(([id, entry]) => canonicalHash(record.entries[id]?.accepted ?? null) === canonicalHash(entry))
      return {
        documents: Object.keys(record.entries).length, searchable, conflicts,
        complete: !!matchesTarget && searchable && conflicts.length === 0,
      }
    })
  }
  /**
   * 在生成域继续消费内容前确认远端正文仍是当前版本。
   *
   * @param projectId - 项目 ID。
   * @param entryId - 条目 ID。
   * @param _entry - 生成域当前条目；映射按稳定条目 ID 断言。
   * @returns 当前性成立后兑现；远端手改时拒绝。
   */
  async assertCurrent(projectId: string, entryId: string, _entry: KnowledgeEntry): Promise<void> {
    if (!this.has(projectId)) return
    const record = this.status(projectId)
    if (!record.entries[entryId]) return
    const remote = await this.inspect(projectId, entryId, this.lifetime.signal)
    if (remote.snapshotHash !== this.baseline(record.entries[entryId])) throw new Error('knowledge-base: SiYuan edits require adoption: ' + entryId)
    // 本地新候选允许继续检查；实际思源生效状态由 verify 单独核验。
  }
  /** 关闭后拒绝新准入，并排空已开始操作。 */
  close(): Promise<void> {
    this.lifetime.abort(new Error('knowledge-base: SiYuan owner closing'))
    this.closing ??= Promise.allSettled([this.tail, ...this.reads]).then(() => this.domain.close())
    return this.closing
  }
  private snapshot(title: string, markdown: string): string { return canonicalHash({ title, body: markdownIdentity(markdown) }) }
  private baseline(entry: SiyuanProjectMapping['entries'][string]): string {
    return this.snapshot(entry.baselineDocument.title, entry.baselineDocument.markdown)
  }
  private async read(id: string, signal: AbortSignal) {
    signal.throwIfAborted()
    const info = await this.gateway.getDocument(id, signal)
    if (info.notebook !== this.config.notebook) throw new Error('knowledge-base: SiYuan document notebook changed')
    const markdown = await this.gateway.getKramdown(id, signal)
    return { ...info, markdown }
  }
  private async inspectRecord(record: SiyuanProjectMapping, id: string, signal: AbortSignal) {
    const mapped = record.entries[id]
    if (!mapped) throw new Error('knowledge-base: SiYuan entry not found')
    const read = await this.read(mapped.documentId, signal)
    const parsed = sections(read.markdown)
    if (markdownIdentity(parsed.footer) !== markdownIdentity(sections(mapped.baselineDocument.markdown).footer)) throw new Error('knowledge-base: source or conditions changed; restore source section before body adoption')
    return { documentId: mapped.documentId, snapshotHash: this.snapshot(read.title, read.markdown),
      baselineDocument: { title: read.title, markdown: read.markdown },
      entry: knowledgeEntrySchema.parse({ ...mapped.accepted, title: read.title, body: parsed.body }) }
  }
  private async ensure(record: SiyuanProjectMapping, key: string, parentPath: string,
    title: string, markdown: string, signal: AbortSignal) {
    let pending = record.intents[key]
    if (!pending) {
      pending = { title, parentPath, path: pathChild(parentPath, title), markdown, state: 'prepared', documentId: null }
      record.intents[key] = pending
      await this.save(record)
    }
    if (pending.markdown !== markdown) throw new Error('knowledge-base: pending SiYuan input differs')
    if (!pending.documentId) {
      const listed = await this.gateway.listDocuments(this.config.notebook, pending.parentPath, signal)
      const matches = listed.filter(d => d.hPath === pending.path)
      if (matches.length > 1) throw new Error('knowledge-base: ambiguous SiYuan path')
      if (matches[0]) {
        if (pending.state === 'prepared') throw new Error('knowledge-base: existing unmanaged SiYuan path')
        pending.documentId = matches[0].id
      } else {
        if (pending.state === 'dispatched') throw new Error('knowledge-base: unknown SiYuan create result; operator reconciliation required')
        signal.throwIfAborted()
        pending.state = 'dispatched'; await this.save(record)
        pending.documentId = await this.gateway.createDocument(this.config.notebook, pending.path, pending.title, pending.markdown, signal)
      }
      await this.save(record)
    }
    const read = await this.read(pending.documentId, signal)
    if (read.title !== pending.title || markdownIdentity(read.markdown) !== markdownIdentity(pending.markdown)) {
      throw new Error('knowledge-base: SiYuan readback differs from intended content')
    }
    pending.state = 'confirmed'; await this.save(record)
    return { documentId: pending.documentId, title: read.title, hPath: read.hPath, contentHash: markdownIdentity(read.markdown) }
  }
  private save(record: SiyuanProjectMapping): Promise<void> {
    return this.projects.put(record.projectId, siyuanProjectSchema.parse(record))
  }
  private readOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('knowledge-base: SiYuan owner closing'))
    const pending = operation()
    this.reads.add(pending)
    void pending.then(() => this.reads.delete(pending), () => this.reads.delete(pending))
    return pending
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('knowledge-base: SiYuan owner closing'))
    const current = this.tail.then(operation)
    this.tail = current.then(() => {}, () => {})
    return current
  }
}
