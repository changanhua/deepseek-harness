import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { KnowledgeSiyuanProjection, markdownIdentity } from '../src/siyuan.ts'
import type { SiyuanProjectInput } from '../src/siyuan.ts'

class Remote {
  docs = new Map<string, { id: string; notebook: string; hPath: string; title: string; markdown: string }>()
  creates: string[] = []
  fail: 'before' | 'after' | null = null
  async listDocuments(notebook: string, path: string) {
    return [...this.docs.values()].filter(d => d.notebook === notebook && d.hPath.slice(0, d.hPath.lastIndexOf('/')) === path)
  }
  async createDocument(notebook: string, hPath: string, title: string, markdown: string) {
    if (this.fail === 'before') { this.fail = null; throw new Error('lost before result') }
    const id = '20260908130000-' + String(this.docs.size + 1).padStart(7, '0')
    this.docs.set(id, { id, notebook, hPath, title, markdown })
    this.creates.push(hPath)
    if (this.fail === 'after') { this.fail = null; throw new Error('lost after result') }
    return id
  }
  async getDocument(id: string) {
    const d = this.docs.get(id)
    if (!d) throw new Error('missing remote document')
    return d
  }
  async getKramdown(id: string) {
    const d = await this.getDocument(id)
    return d.markdown + '\n{: id="' + id + '" updated="20260908130000" type="doc"}'
  }
  async search(notebook: string, query: string) {
    return [...this.docs.values()].filter(d => d.notebook === notebook && d.markdown.includes(query)).map(d => d.id)
  }
}
const signal = () => new AbortController().signal
const closes: (() => Promise<void>)[] = []
const roots: string[] = []
async function harness(remote = new Remote(), root?: string) {
  if (!root) { root = await mkdtemp(join(tmpdir(), 'siyuan-knowledge-')); roots.push(root) }
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(join(root, 'domain'))
  ctx.storage.backend.register('json', backend)
  const facility = new DomainFacility(ctx, { backend: 'json' })
  const projection = await KnowledgeSiyuanProjection.open(facility, remote, { notebook: 'knowledge', rootPath: '/知识' })
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await projection.close()
    await backend.close()
    await ctx.fiber.dispose()
  }
  closes.push(close)
  return { projection, remote, root, close }
}
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
function input(body = '先验证一个循环。', version = 'v1'): SiyuanProjectInput {
  return {
    projectId: 'game', title: '游戏开发', readerTask: '写出玩法说明。', version,
    entries: [{ id: 'scope', title: '原型范围', type: 'method', seedIds: ['scope'], depends: [], related: [],
      conditions: '小型原型', body, citations: [{ sourceId: 'engine', snapshotId: 'a'.repeat(64), quote: '先验证。' }] }],
    sources: [{ sourceId: 'engine', snapshotId: 'a'.repeat(64), title: '引擎文档', url: 'https://example.com/engine' }],
  }
}
it('比较真实 Kramdown 格式时保留链接、代码和正文含义，忽略思源块属性', () => {
  expect(markdownIdentity('## 标题\n\n正文。')).toBe(markdownIdentity('## 标题\n{: id="20260908130000-aaaaaaa" updated="20260908130000"}\n\n正文。\n{: id="20260908130000-bbbbbbb"}'))
  expect(markdownIdentity('[来源](https://a.example)')).not.toBe(markdownIdentity('[来源](https://b.example)'))
  expect(markdownIdentity('```text\n{: id="literal"}\n```')).not.toBe(markdownIdentity('```text\n\n```'))
  expect(markdownIdentity('**说明阶段：**请检查。')).toBe(markdownIdentity('**说明阶段：** 请检查。'))
  expect(markdownIdentity('- 条目\n\n  说明\n\n- 第二条\n\n  说明')).toBe(markdownIdentity('- 条目\n\n  说明\n- 第二条\n\n  说明'))
})
it('初次迁入后重跑与重启均不重复创建，正文在思源而非超级块内', async () => {
  const h = await harness()
  const first = await h.projection.sync(input(), signal())
  expect(first).toMatchObject({ createdEntries: ['scope'], candidates: [], conflicts: [], complete: true })
  const mapping = h.projection.status('game').entries.scope!
  const map = await h.remote.getKramdown(first.mapDocumentId)
  expect(map).toContain('读者任务：写出玩法说明。')
  expect(map).toContain(mapping.documentId)
  expect(map).toContain('要解决的问题：小型原型')
  expect((await h.remote.getKramdown(mapping.documentId))).toContain('先验证一个循环。')
  expect((await h.remote.getKramdown(mapping.documentId))).not.toContain('{{{row')
  const count = h.remote.creates.length
  await h.close()
  const reopened = await harness(h.remote, h.root)
  expect((await reopened.projection.sync(input(), signal())).createdEntries).toEqual([])
  expect(h.remote.creates).toHaveLength(count)
  expect(reopened.projection.status('game').versions.v1?.knowledgeMap?.documentId).toBe(first.mapDocumentId)
  expect(await reopened.projection.verify('game', signal())).toMatchObject({ documents: 1, searchable: true, conflicts: [], complete: true })
})

it('手改地图后不能仍宣称该版本完整匹配，也不覆盖手改地图', async () => {
  const h = await harness()
  const first = await h.projection.sync(input(), signal())
  const map = h.remote.docs.get(first.mapDocumentId)!
  map.markdown += '\n用户调整的阅读建议。'
  expect(await h.projection.verify('game', signal())).toMatchObject({ complete: false, conflicts: ['@map'] })
  expect(await h.projection.sync(input(), signal())).toMatchObject({ complete: false, conflicts: ['@map'] })
  expect(map.markdown).toContain('用户调整的阅读建议。')
  h.remote.docs.delete(first.mapDocumentId)
  await expect(h.projection.sync(input(), signal())).rejects.toThrow('missing remote document')
})
it('思源已创建而响应丢失时只核对目标并恢复；尚未创建时不会盲目重试', async () => {
  const h = await harness()
  h.remote.fail = 'after'
  await expect(h.projection.sync(input(), signal())).rejects.toThrow('lost after')
  const count = h.remote.creates.length
  await h.projection.sync(input(), signal())
  expect(h.remote.creates.filter(p => p === '/知识/游戏开发')).toHaveLength(1)
  expect(h.remote.creates.length).toBeGreaterThanOrEqual(count)
  const other = await harness()
  other.remote.fail = 'before'
  await expect(other.projection.sync(input(), signal())).rejects.toThrow('lost before')
  await expect(other.projection.sync(input(), signal())).rejects.toThrow(/unknown/i)
  expect(other.remote.creates).toHaveLength(0)
})
it('新版本产生独立候选，原正文及其块身份不被覆盖；部分完成不标成新版本', async () => {
  const h = await harness()
  await h.projection.sync(input(), signal())
  const docId = h.projection.status('game').entries.scope!.documentId
  const original = await h.remote.getKramdown(docId)
  const changed = await h.projection.sync(input('更新后的玩法。', 'v2'), signal())
  expect(changed).toMatchObject({ candidates: ['scope'], complete: false })
  expect(await h.remote.getKramdown(docId)).toBe(original)
  expect(h.projection.status('game')).toMatchObject({ currentVersion: 'v1', targetVersion: 'v2' })
  const count = h.remote.creates.length
  await h.projection.sync(input('更新后的玩法。', 'v2'), signal())
  expect(h.remote.creates).toHaveLength(count)
  const catalog = h.projection.status('game').versions.v2!.catalog!
  expect(await h.remote.getKramdown(catalog.documentId)).not.toContain('尚未全部生效')
  const originalDoc = h.remote.docs.get(docId)!
  originalDoc.markdown = originalDoc.markdown.replace('先验证一个循环。', '更新后的玩法。')
  const inspected = await h.projection.inspect('game', 'scope', signal())
  await h.projection.accept('game', 'scope', inspected.snapshotHash, async () => {}, signal())
  expect((await h.projection.sync(input('更新后的玩法。', 'v2'), signal())).complete).toBe(true)
  expect(h.projection.status('game').currentVersion).toBe('v2')
})
it('接受思源正文编辑前绑定观察快照，改名不丢身份，变化后拒绝旧确认', async () => {
  const h = await harness()
  await h.projection.sync(input(), signal())
  const mapping = h.projection.status('game').entries.scope!
  const doc = h.remote.docs.get(mapping.documentId)!
  doc.markdown = doc.markdown.replace('先验证一个循环。', '用户补充验收步骤。')
  doc.title = '我自己的范围卡'
  const read = await h.projection.inspect('game', 'scope', signal())
  expect(read.entry).toMatchObject({ body: '用户补充验收步骤。', title: '我自己的范围卡' })
  let adopted = ''
  await h.projection.accept('game', 'scope', read.snapshotHash, async (entry) => { adopted = entry.body }, signal())
  expect(adopted).toBe('用户补充验收步骤。')
  doc.markdown += '\n新修改'
  await expect(h.projection.accept('game', 'scope', read.snapshotHash, async () => {}, signal())).rejects.toThrow(/changed/)
})
it('远端检查核对当前正文、目标库与发布身份，不能以搜索命中冒充通过', async () => {
  const h = await harness()
  await h.projection.sync(input(), signal())
  const mapping = h.projection.status('game').entries.scope!
  h.remote.docs.get(mapping.documentId)!.markdown += '\n人工新增'
  expect((await h.projection.verify('game', signal())).complete).toBe(false)
  h.remote.docs.get(mapping.documentId)!.notebook = 'another'
  await expect(h.projection.inspect('game', 'scope', signal())).rejects.toThrow(/notebook/)
})
it('关闭拥有并取消挂起的 MCP 调用，之后拒绝新操作', async () => {
  const h = await harness()
  let entered!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  h.remote.listDocuments = async (_notebook, _path, operationSignal?: AbortSignal) => {
    entered()
    return new Promise((_, reject) => operationSignal?.addEventListener('abort', () => {
      const reason: unknown = operationSignal.reason
      reject(reason instanceof Error ? reason : new Error('operation aborted'))
    }, { once: true }))
  }
  const pending = h.projection.sync(input(), signal())
  const outcome = expect(pending).rejects.toThrow(/closing/)
  await started
  await h.projection.close()
  await outcome
  await expect(h.projection.sync(input(), signal())).rejects.toThrow(/closing/)
})
it('接纳持有写锁时，执行域仍可回读思源，不形成两个 owner 的反向锁等待', async () => {
  const h = await harness()
  await h.projection.sync(input(), signal())
  const before = await h.projection.inspect('game', 'scope', signal())
  await h.projection.accept('game', 'scope', before.snapshotHash, async () => {
    await h.projection.assertCurrent('game', 'scope', input().entries[0]!)
  }, signal())
})
