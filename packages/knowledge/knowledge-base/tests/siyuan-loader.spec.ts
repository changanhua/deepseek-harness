import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { assertEntriesLoaded } from '@deepseek-ai/dsh-app-boot'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import KnowledgeBaseService, { canonicalHash } from '../src/index.ts'
import type { KnowledgeRepository } from '../src/repository.ts'

interface RemoteDocument { id: string; notebook: string; path: string; title: string; markdown: string }

class FixtureSiyuan {
  private sequence = 0
  readonly documents = new Map<string, RemoteDocument>()
  creates = 0

  execute(kind: string, args: Record<string, unknown>): unknown {
    if (kind === 'document') return this.document(args)
    if (kind === 'block') return this.block(args)
    if (kind === 'search') return this.search(args)
    throw new Error('unexpected fixture MCP kind: ' + kind)
  }

  editBody(id: string, body: string): void {
    const document = this.documents.get(id)
    if (!document) throw new Error('fixture document missing')
    document.markdown = document.markdown.replace(/## 知识正文\n\n.*?\n\n## 来源与适用范围/su, `## 知识正文\n\n${body}\n\n## 来源与适用范围`)
  }

  private document(args: Record<string, unknown>): unknown {
    if (args.action === 'list') {
      const notebook = string(args.notebook), path = string(args.path)
      const listed = [...this.documents.values()].filter(item => item.notebook === notebook && parent(item.path) === path)
      return text(`Documents in ${notebook} (hPath: ${path}):\n${listed.map(item => `- ${item.title} (id: ${item.id}, hPath: ${item.path})`).join('\n')}${listed.length ? '\n' : ''}`)
    }
    if (args.action === 'create') {
      const id = `20260908130${++this.sequence}-fixture`
      const document = {
        id, notebook: string(args.notebook), path: string(args.path),
        title: string(args.title), markdown: string(args.markdown),
      }
      this.documents.set(id, document); this.creates++
      return text(`document created: ${id} (hPath: ${document.path})`)
    }
    if (args.action === 'get') {
      const item = this.require(string(args.id))
      return text(`ID: ${item.id}\nTitle: ${item.title}\nHPath: ${item.path}\nBox: ${item.notebook}\nContent: ${item.title}\nMarkdown: \nType: NodeDocument\nCreated: ${item.id.slice(0, 14)}`)
    }
    throw new Error('unexpected fixture document action')
  }

  private block(args: Record<string, unknown>): unknown {
    if (args.action !== 'get_kramdown') throw new Error('unexpected fixture block action')
    return text(this.require(string(args.id)).markdown)
  }

  private search(args: Record<string, unknown>): unknown {
    const notebook = string(args.notebook), query = string(args.query)
    const matches = [...this.documents.values()].filter(item => item.notebook === notebook && item.markdown.includes(query))
    if (matches.length === 0) return text('No results found.')
    return text(`Found ${matches.length} results (page 1/1):\n\n${matches.map(item => `- [${parent(item.path)}/] NodeDocument\n  ${item.title}\n  id: ${item.id}`).join('\n\n')}\n\n(grouped by document, ${matches.length} documents matched)`)
  }

  private require(id: string): RemoteDocument {
    const document = this.documents.get(id)
    if (!document) throw new Error('fixture document missing')
    return document
  }
}

function text(value: string): unknown { return { content: [{ type: 'text', text: value }] } }
function string(value: unknown): string { if (typeof value !== 'string') throw new Error('fixture expects string'); return value }
function parent(path: string): string { return path.slice(0, path.lastIndexOf('/')) || '/' }

const contexts: Context[] = [], roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function boot(root: string, remote: FixtureSiyuan): Promise<Context> {
  const ctx = new Context(); contexts.push(ctx); ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['prompt', SystemPrompt], ['tools', ToolRuntime], ['storage', Storage], ['json', StorageJson], ['domain', StorageDomain], ['knowledge', KnowledgeBaseService],
  ])
  ctx.loader.internal = { version: 'v2', import: async (name: string) => modules.get(name) ?? Promise.reject(new Error(name)) } as never
  const config = join(root, 'cordis.yml')
  await writeFile(config, JSON.stringify([
    { id: 'prompt', name: 'prompt' }, { id: 'tools', name: 'tools' }, { id: 'storage', name: 'storage' },
    { id: 'json', name: 'json', config: { root: join(root, 'domain') } }, { id: 'domain', name: 'domain', config: { backend: 'json' } },
    { id: 'knowledge', name: 'knowledge', config: { root: join(root, 'content'), siyuan: { serverName: 'siyuan', notebook: 'knowledge', rootPath: '/知识' } } },
  ]))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await(); assertEntriesLoaded(ctx, 'SiYuan Loader')
  for (const kind of ['document', 'block', 'search']) {
    ctx.tools.register(defineTool({
      name: `mcp__siyuan__${kind}`, description: 'fixture SiYuan boundary', parameters: { action: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: () => [] },
      async execute(args) { return remote.execute(kind, args) as never },
    }))
  }
  return ctx
}

async function complete(repository: KnowledgeRepository, entryId: string, action: 'generate' | 'review', raw: unknown): Promise<void> {
  const prepared = await repository.prepareStage('game', entryId, action)
  const owner = { workId: `${action}-${entryId}`, attemptId: `${action}-${entryId}-attempt` }
  await repository.bindStage('game', prepared.id, owner.workId)
  await repository.acceptResult('game', prepared.id, JSON.stringify(raw), owner)
}

describe('SiYuan 的真实 Loader 组合', () => {
  it('持久投影、重启恢复和远端接纳共同保护知识复核', async () => {
    const root = await mkdtemp(join(tmpdir(), 'knowledge-siyuan-loader-')); roots.push(root)
    const remote = new FixtureSiyuan(), ctx = await boot(root, remote)
    const repository = ctx.knowledgeBase.repository
    const spec = { id: 'game', title: '游戏知识', readerTask: '完成一个可试玩原型', language: 'zh-CN', seeds: [
      { id: 'scope', title: '限定玩法范围', goal: '确定玩家动作', type: 'method', depends: [], sourceIds: ['manual'], required: true },
      { id: 'loop', title: '观察核心循环', goal: '记录反馈', type: 'method', depends: ['scope'], sourceIds: ['manual'], required: true },
    ] }
    await repository.create(spec)
    const source = await repository.ingest('game', { sourceId: 'manual', title: '受控资料', url: 'https://example.test/manual', text: '玩家按键后应看到反馈。', fetchedAt: '2026-09-08T00:00:00.000Z' })
    await repository.confirmPlan('game', canonicalHash(spec))
    const entry = (id: string, depends: string[]) => ({ id, title: id === 'scope' ? '限定玩法范围' : '观察核心循环', type: 'method', seedIds: [id], depends, related: [], conditions: '受控资料', body: id === 'scope' ? '先定义玩家按键后的可观察反馈。' : '记录一次动作与反馈组成的循环。', citations: [{ sourceId: 'manual', snapshotId: source.snapshotId, quote: '玩家按键后应看到反馈。' }] })
    await complete(repository, 'scope', 'generate', entry('scope', []))
    await complete(repository, 'scope', 'review', { status: 'pass', issues: [], summary: '来源支持该方法。' })
    await complete(repository, 'loop', 'generate', entry('loop', ['scope']))
    await complete(repository, 'loop', 'review', { status: 'pass', issues: [], summary: '来源支持该方法。' })
    await repository.publish('game', 'v1')

    const first = await ctx.knowledgeBase.siyuan!.sync(await repository.publication('game', 'v1'), new AbortController().signal)
    expect(first).toMatchObject({ createdEntries: ['scope', 'loop'], candidates: [], conflicts: [], complete: true })
    expect([...remote.documents.values()].filter(item => item.markdown.includes('[受控资料](https://example.test/manual)'))).toHaveLength(2)
    expect([...remote.documents.values()].filter(item => item.markdown.includes('DSHKB game'))).toHaveLength(4)
    const created = remote.creates
    await ctx.fiber.dispose(); contexts.splice(contexts.indexOf(ctx), 1)

    const restarted = await boot(root, remote)
    const resumed = await restarted.knowledgeBase.siyuan!.sync(await restarted.knowledgeBase.repository.publication('game', 'v1'), new AbortController().signal)
    expect(resumed.createdEntries).toEqual([])
    expect(remote.creates).toBe(created)
    const resumedEntries = restarted.knowledgeBase.siyuan!.status('game').entries
    expect(Object.keys(resumedEntries)).toEqual(expect.arrayContaining(['scope', 'loop']))

    const scope = restarted.knowledgeBase.siyuan!.status('game').entries.scope!
    restarted.knowledgeBase.repository.configureExecution('different-model', 'never')
    const pending = await restarted.knowledgeBase.repository.prepareStage('game', 'scope', 'generate')
    const pendingOwner = { workId: 'fresh-generate-scope', attemptId: 'fresh-generate-scope-attempt' }
    await restarted.knowledgeBase.repository.bindStage('game', pending.id, pendingOwner.workId)
    remote.editBody(scope.documentId, '用户补充：先写下输入与反馈。')
    await expect(restarted.knowledgeBase.repository.acceptResult('game', pending.id, JSON.stringify(entry('scope', [])), pendingOwner)).rejects.toThrow('SiYuan')
    expect(restarted.knowledgeBase.repository.get('game').stages[pending.id]!.responseHash).not.toBeNull()
    expect(restarted.knowledgeBase.repository.get('game').entries.scope!.review?.decision.status).toBe('pass')
    await expect(restarted.knowledgeBase.repository.prepareStage('game', 'scope', 'review')).rejects.toThrow('SiYuan edits require adoption')
    const editedCheck = await restarted.knowledgeBase.repository.check('game')
    expect(editedCheck.publishable).toBe(false)
    expect(editedCheck.entries.find(item => item.id === 'scope')!.issues).toContain('siyuan_not_current:knowledge-base: SiYuan edits require adoption: scope')
    const observed = await restarted.knowledgeBase.siyuan!.inspect('game', 'scope', new AbortController().signal)
    await restarted.knowledgeBase.siyuan!.accept('game', 'scope', observed.snapshotHash,
      async (accepted) => { await restarted.knowledgeBase.repository.adoptRemote('game', 'scope', accepted, restarted.knowledgeBase.repository.get('game').entries.scope!.contentHash) },
      new AbortController().signal)
    expect(restarted.knowledgeBase.repository.get('game').entries.scope!.review).toBeNull()
    const checked = await restarted.knowledgeBase.repository.check('game')
    expect(checked.publishable).toBe(false)
    expect(checked.entries.find(item => item.id === 'scope')?.issues).toContain('review_not_passed')
  })
})
