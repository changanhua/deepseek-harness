import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { KnowledgeSiyuanProjection, siyuanProjectionDomainSpec } from '../src/siyuan.ts'
import type { SiyuanConfig, SiyuanProjectInput, SiyuanProjectMapping } from '../src/siyuan.ts'
import type { SiyuanGateway } from '../src/siyuan-gateway.ts'

interface RemoteDocument { id: string; notebook: string; hPath: string; title: string; markdown: string }

class Remote implements SiyuanGateway {
  readonly documents = new Map<string, RemoteDocument>()
  creates = 0
  failBeforeCreate = false
  failReadbackOnce = false
  failAfterPath: string | null = null
  corruptReadback = false

  async listDocuments(notebook: string, parentPath: string): Promise<Array<Pick<RemoteDocument, 'id' | 'hPath' | 'title'>>> {
    return [...this.documents.values()].filter(document => document.notebook === notebook && parent(document.hPath) === parentPath)
  }

  async createDocument(notebook: string, hPath: string, title: string, markdown: string): Promise<string> {
    if (this.failBeforeCreate) { this.failBeforeCreate = false; throw new Error('create result lost') }
    const id = `20260908131${++this.creates}-fixture`
    this.documents.set(id, { id, notebook, hPath, title, markdown })
    if (this.failAfterPath === hPath) { this.failAfterPath = null; throw new Error('create result lost') }
    return id
  }

  async getDocument(id: string): Promise<RemoteDocument> {
    if (this.failReadbackOnce) { this.failReadbackOnce = false; throw new Error('temporary readback failure') }
    const document = this.documents.get(id)
    if (!document) throw new Error('fixture document missing')
    return { ...document }
  }

  async getKramdown(id: string): Promise<string> {
    const document = await this.getDocument(id)
    return this.corruptReadback ? `${document.markdown}\ncorrupted after create` : document.markdown
  }

  async search(notebook: string, query: string): Promise<string[]> {
    return [...this.documents.values()]
      .filter(document => document.notebook === notebook && document.markdown.includes(query))
      .map(document => document.id)
  }
}

const roots: string[] = []
const closers: Array<() => Promise<void>> = []
const signal = () => new AbortController().signal

async function harness(
  remote = new Remote(), root?: string,
  config: SiyuanConfig = { notebook: 'knowledge', rootPath: '/知识' },
) {
  root ??= await mkdtemp(join(tmpdir(), 'knowledge-siyuan-errors-'))
  if (!roots.includes(root)) roots.push(root)
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(join(root, 'domain'))
  ctx.storage.backend.register('json', backend)
  const facility = new DomainFacility(ctx, { backend: 'json' })
  const projection = await KnowledgeSiyuanProjection.open(facility, remote, config)
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await projection.close()
    await backend.close()
    await ctx.fiber.dispose()
  }
  closers.push(close)
  return { projection, remote, root, close }
}

function parent(path: string): string { return path.slice(0, path.lastIndexOf('/')) || '/' }
function entry(id: string, depends: string[] = [], body = '先观察一次输入后的反馈。') {
  return { id, title: id === 'scope' ? '范围' : '循环', type: 'method' as const, seedIds: [id], depends, related: [], conditions: '小型原型', body,
    citations: [{ sourceId: 'manual', snapshotId: 'a'.repeat(64), quote: '先观察反馈。' }] }
}
function project(entries = [entry('scope')], version = 'v1'): SiyuanProjectInput {
  return { projectId: 'game', title: '游戏知识', readerTask: '完成试玩任务。', version, entries,
    sources: [{ sourceId: 'manual', snapshotId: 'a'.repeat(64), title: '资料' }] }
}

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('SiYuan 投影的错误与恢复边界', () => {
  it('在写远端前拒绝无效目标、重复 ID、缺失依赖和环依赖', async () => {
    const remote = new Remote()
    const root = await mkdtemp(join(tmpdir(), 'knowledge-siyuan-invalid-')); roots.push(root)
    const ctx = new Context(); await ctx.plugin(Storage)
    const backend = new JsonStorageBackend(join(root, 'domain')); ctx.storage.backend.register('json', backend)
    const facility = new DomainFacility(ctx, { backend: 'json' })
    await expect(KnowledgeSiyuanProjection.open(facility, remote, { notebook: 'knowledge', rootPath: 'relative' })).rejects.toThrow('invalid SiYuan target')
    await backend.close(); await ctx.fiber.dispose()

    const h = await harness(remote)
    expect(() => h.projection.sync(project([entry('scope'), entry('scope')]), signal())).toThrow('duplicate entry identity')
    expect(() => h.projection.sync(project([entry('scope', ['missing'])]), signal())).toThrow('missing or cyclic prerequisites')
    expect(() => h.projection.sync(project([entry('scope', ['loop']), entry('loop', ['scope'])]), signal())).toThrow('missing or cyclic prerequisites')
    expect(remote.creates).toBe(0)
  })

  it('不接管已有路径或同路径歧义文档，保留远端原文', async () => {
    const h = await harness()
    h.remote.documents.set('manual', { id: 'manual', notebook: 'knowledge', hPath: '/知识/游戏知识', title: '游戏知识', markdown: '用户自己的根文档' })
    await expect(h.projection.sync(project(), signal())).rejects.toThrow('existing unmanaged SiYuan path')
    expect(h.remote.documents.get('manual')!.markdown).toBe('用户自己的根文档')

    const duplicate = await harness()
    for (const id of ['left', 'right']) duplicate.remote.documents.set(id, { id, notebook: 'knowledge', hPath: '/知识/游戏知识', title: '游戏知识', markdown: '用户文档' })
    await expect(duplicate.projection.sync(project(), signal())).rejects.toThrow('ambiguous SiYuan path')
    expect([...duplicate.remote.documents.values()].map(document => document.markdown)).toEqual(['用户文档', '用户文档'])
  })

  it('创建回读不一致、创建结果未知和同版本内容变化均不覆盖远端', async () => {
    const corrupted = await harness()
    corrupted.remote.corruptReadback = true
    await expect(corrupted.projection.sync(project(), signal())).rejects.toThrow('readback differs')
    expect(corrupted.remote.creates).toBe(1)

    const unknown = await harness()
    unknown.remote.failBeforeCreate = true
    await expect(unknown.projection.sync(project(), signal())).rejects.toThrow('create result lost')
    const creates = unknown.remote.creates
    await expect(unknown.projection.sync(project(), signal())).rejects.toThrow('unknown SiYuan create result')
    expect(unknown.remote.creates).toBe(creates)
    await expect(unknown.projection.verify('game', signal()))
      .resolves.toMatchObject({ documents: 0, complete: false })

    const stable = await harness()
    await stable.projection.sync(project(), signal())
    const scope = stable.projection.status('game').entries.scope!.documentId
    const before = stable.remote.documents.get(scope)!.markdown
    await expect(stable.projection.sync(project([entry('scope', [], '换了正文')]), signal())).rejects.toThrow('immutable SiYuan version changed')
    expect(stable.remote.documents.get(scope)!.markdown).toBe(before)
  })

  it('配置目标改变后拒绝继续同步，接纳期间再次手改也保留远端内容', async () => {
    const h = await harness()
    await h.projection.sync(project(), signal())
    await h.close()
    const moved = await harness(h.remote, h.root, { notebook: 'knowledge', rootPath: '/另一个根' })
    await expect(moved.projection.sync(project(), signal())).rejects.toThrow('SiYuan target changed')

    const accepting = await harness()
    await accepting.projection.sync(project(), signal())
    const acceptingScope = accepting.projection.status('game').entries.scope!.documentId
    const original = accepting.remote.documents.get(acceptingScope)!
    original.markdown = original.markdown.replace('先观察一次输入后的反馈。', '用户先补充一个步骤。')
    const observed = await accepting.projection.inspect('game', 'scope', signal())
    await expect(accepting.projection.accept('game', 'scope', observed.snapshotHash, async () => {
      original.markdown = original.markdown.replace('用户先补充一个步骤。', '用户在接纳中再次修改。')
    }, signal())).rejects.toThrow('changed during adoption')
    expect(original.markdown).toContain('用户在接纳中再次修改。')
  })

  it('复用可信配置的已有根，只在其下创建知识条目', async () => {
    const remote = new Remote()
    remote.documents.set('root', { id: 'root', notebook: 'knowledge', hPath: '/用户根', title: '用户项目', markdown: '# 用户项目\n\n保留已有内容。' })
    const h = await harness(remote, undefined, { notebook: 'knowledge', rootPath: '/知识', projectRoots: { game: 'root' } })

    const synced = await h.projection.sync(project(), signal())
    expect(synced.rootDocumentId).toBe('root')
    expect(remote.documents.get('root')!.markdown).toBe('# 用户项目\n\n保留已有内容。')
    expect([...remote.documents.values()].some(document => document.hPath === '/用户根/范围')).toBe(true)
  })

  it('拒绝会混入受管章节或缺少来源快照的条目，并保留已存在远端正文', async () => {
    const reserved = await harness()
    await expect(reserved.projection.sync(project([entry('scope', [], '## 知识正文\n\n用户正文')]), signal())).rejects.toThrow('reserved document section')
    expect([...reserved.remote.documents.values()].some(document => document.hPath.endsWith('/范围'))).toBe(false)

    const missing = await harness()
    const invalid = project([entry('scope')])
    invalid.sources = []
    await expect(missing.projection.sync(invalid, signal())).rejects.toThrow('missing citation snapshot')
    expect([...missing.remote.documents.values()].some(document => document.hPath.endsWith('/范围'))).toBe(false)
  })

  it('将来源区编辑视为不可接纳，并让未映射项目或条目继续走本地流程', async () => {
    const h = await harness()
    await h.projection.sync(project(), signal())
    const scope = h.projection.status('game').entries.scope!.documentId
    const remote = h.remote.documents.get(scope)!
    remote.markdown = remote.markdown.replace('适用条件：小型原型', '适用条件：已被手改')
    await expect(h.projection.inspect('game', 'scope', signal())).rejects.toThrow('source or conditions changed')
    expect(remote.markdown).toContain('适用条件：已被手改')
    await expect(h.projection.assertCurrent('other-project', 'scope', entry('scope'))).resolves.toBeUndefined()
    await expect(h.projection.assertCurrent('game', 'other-entry', entry('scope'))).resolves.toBeUndefined()
  })

  it('关闭后拒绝新的只读检查', async () => {
    const h = await harness()
    await h.projection.sync(project(), signal())
    await h.projection.close()
    await expect(h.projection.inspect('game', 'scope', signal())).rejects.toThrow('SiYuan owner closing')
  })

  it('在根路径同步、未知状态与未知条目之间保持明确边界', async () => {
    const h = await harness(new Remote(), undefined, { notebook: 'knowledge', rootPath: '/' })
    expect(() => h.projection.status('game')).toThrow('not synchronized')
    await h.projection.sync(project(), signal())
    expect([...h.remote.documents.values()].some(document => document.hPath === '/游戏知识')).toBe(true)
    await expect(h.projection.inspect('game', 'missing-entry', signal())).rejects.toThrow('SiYuan entry not found')
  })

  it('拒绝缺失或重复受管章节，并把已有正文手改报告为冲突', async () => {
    const missing = await harness()
    await missing.projection.sync(project(), signal())
    const missingId = missing.projection.status('game').entries.scope!.documentId
    missing.remote.documents.get(missingId)!.markdown = '用户移除了受管章节。'
    await expect(missing.projection.inspect('game', 'scope', signal())).rejects.toThrow('missing knowledge body section')

    const duplicate = await harness()
    await duplicate.projection.sync(project(), signal())
    const duplicateId = duplicate.projection.status('game').entries.scope!.documentId
    duplicate.remote.documents.get(duplicateId)!.markdown += '\n## 来源与适用范围\n\n用户复制了一段。'
    await expect(duplicate.projection.inspect('game', 'scope', signal())).rejects.toThrow('invalid source section')

    const changed = await harness()
    await changed.projection.sync(project(), signal())
    const changedId = changed.projection.status('game').entries.scope!.documentId
    const document = changed.remote.documents.get(changedId)!
    document.markdown = document.markdown.replace('先观察一次输入后的反馈。', '用户保留了自己的新正文。')
    await expect(changed.projection.sync(project(), signal())).resolves.toMatchObject({ conflicts: ['scope'], complete: false })
    expect(document.markdown).toContain('用户保留了自己的新正文。')
  })

  it('拒绝过期观察快照，并能在创建回读暂时失败后从同一文档恢复', async () => {
    const changed = await harness()
    await changed.projection.sync(project(), signal())
    const changedId = changed.projection.status('game').entries.scope!.documentId
    const observed = await changed.projection.inspect('game', 'scope', signal())
    changed.remote.documents.get(changedId)!.markdown = changed.remote.documents.get(changedId)!.markdown.replace('先观察一次输入后的反馈。', '后来的用户编辑。')
    let adopted = false
    await expect(changed.projection.accept('game', 'scope', observed.snapshotHash, async () => { adopted = true }, signal())).rejects.toThrow('changed after inspection')
    expect(adopted).toBe(false)

    const recovering = await harness()
    recovering.remote.failReadbackOnce = true
    await expect(recovering.projection.sync(project(), signal())).rejects.toThrow('temporary readback failure')
    const creates = recovering.remote.creates
    await expect(recovering.projection.sync(project(), signal())).resolves.toMatchObject({ createdEntries: ['scope'], complete: true })
    expect(recovering.remote.creates).toBe(creates + 2)
  })

  it('不允许因 v2 内容不同而接管 v1 未知创建结果', async () => {
    const h = await harness()
    h.remote.failAfterPath = '/知识/游戏知识/范围'
    await expect(h.projection.sync(project(), signal())).rejects.toThrow('create result lost')
    const entryDocuments = [...h.remote.documents.values()].filter(document => document.hPath === '/知识/游戏知识/范围')
    expect(entryDocuments).toHaveLength(1)
    const creates = h.remote.creates
    await expect(h.projection.sync(project([entry('scope', [], 'v2 不应接管 v1 正文。')], 'v2'), signal())).rejects.toThrow('pending SiYuan input differs')
    expect(h.remote.creates).toBe(creates)
    expect(entryDocuments[0]!.markdown).toContain('先观察一次输入后的反馈。')
  })

  it('v2 的新条目创建未知时，不会将同数量的 v1 条目视为已同步', async () => {
    const h = await harness()
    await h.projection.sync(project(), signal())
    h.remote.failAfterPath = '/知识/游戏知识/循环'
    await expect(h.projection.sync(project([entry('loop')], 'v2'), signal())).rejects.toThrow('create result lost')
    await expect(h.projection.verify('game', signal()))
      .resolves.toMatchObject({ documents: 1, complete: false })
  })

  it('从 root 与 targetVersion 均为空的持久中间态恢复时，实时核验保持未完成', async () => {
    const root = await mkdtemp(join(tmpdir(), 'knowledge-siyuan-empty-record-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(Storage)
    const backend = new JsonStorageBackend(join(root, 'domain'))
    ctx.storage.backend.register('json', backend)
    const facility = new DomainFacility(ctx, { backend: 'json' })
    const mapping: SiyuanProjectMapping = {
      projectId: 'game', notebook: 'knowledge', rootPath: '/知识', root: null,
      currentVersion: null, targetVersion: null, entries: {}, intents: {}, versions: {},
    }
    const domain = await facility.open(siyuanProjectionDomainSpec)
    await domain.table('projects').put('game', mapping)
    await domain.close()
    const projection = await KnowledgeSiyuanProjection.open(facility, new Remote(), {
      notebook: 'knowledge', rootPath: '/知识',
    })
    closers.push(async () => {
      await projection.close()
      await backend.close()
      await ctx.fiber.dispose()
    })
    await expect(projection.verify('game', signal()))
      .resolves.toEqual({ documents: 0, searchable: true, conflicts: [], complete: false })
  })
})
