import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { assertEntriesLoaded } from '@deepseek-ai/dsh-app-boot'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Commands from '@deepseek-ai/dsh-commands'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import LocalTaskQueue from '@changanhua/dsh-task-queue-local'
import Knowledge, { canonicalHash } from '@changanhua/dsh-knowledge-base'
import KnowledgeQueue from '@changanhua/dsh-knowledge-base-task-queue'
import * as KnowledgeTools from '../src/index.ts'

const generationContextSchema = z.object({
  seed: z.object({
    id: z.string(), title: z.string(), type: z.string(), depends: z.array(z.string()),
  }).optional(),
  entry: z.object({ id: z.string() }).nullable().optional(),
  sources: z.array(z.object({
    sourceId: z.string(), snapshotId: z.string(), text: z.string(),
  })),
})
const workResultSchema = z.object({ workId: z.string() })
const checkResultSchema = z.object({ publishable: z.boolean() })
const releaseResultSchema = z.object({ path: z.string() })
const persistedStateSchema = z.object({
  tables: z.object({ projects: z.object({ game: z.object({ currentRelease: z.string() }) }) }),
})

const responses = vi.hoisted(() => ({ rejectNextGeneration: false }))
vi.mock('@deepseek-ai/dsh-subagent-codex/app-server-run', () => ({
  startCodexAppServerRun: async (request: { prompt: { text: string }[] }) => {
    const prompt = request.prompt[0]!.text
    const original = prompt.includes('\n修正上次响应') ? prompt.slice(0, prompt.indexOf('\n修正上次响应')) : prompt
    const context = generationContextSchema.parse(JSON.parse(original.slice(original.lastIndexOf('\n') + 1)))
    if (responses.rejectNextGeneration && !prompt.startsWith('审查')) {
      responses.rejectNextGeneration = false
      return {
        result: Promise.resolve({
          stopReason: 'completed', output: [{ type: 'text', text: `{"id":"${context.seed!.id}"}` }],
        }),
        dispose: async () => {},
      }
    }
    const output = prompt.startsWith('审查')
      ? { status: 'pass', issues: [], summary: '受控服务核对了样本引用。' }
      : {
        id: context.seed!.id, title: context.seed!.title, type: context.seed!.type,
        seedIds: [context.seed!.id], depends: context.seed!.depends, related: [],
        conditions: '受控测试资料', body: '先写出玩家动作与可观察反馈。',
        citations: [{
          sourceId: context.sources[0]!.sourceId,
          snapshotId: context.sources[0]!.snapshotId,
          quote: context.sources[0]!.text,
        }],
      }
    return {
      result: Promise.resolve({
        stopReason: 'completed', output: [{ type: 'text', text: JSON.stringify(output) }],
      }),
      dispose: async () => {},
    }
  },
}))

const contexts: Context[] = [], roots: string[] = []
afterEach(async () => {
  responses.rejectNextGeneration = false
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function boot() {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-loader-')); roots.push(root)
  const ctx = new Context(); contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['sessions', SessionStore], ['agents', AgentRegistry], ['prompt', SystemPrompt], ['tools', Tools],
    ['commands', Commands], ['storage', Storage], ['json', StorageJson], ['domain', StorageDomain],
    ['process', Subprocess], ['queue', LocalTaskQueue], ['knowledge', Knowledge], ['knowledge-queue', KnowledgeQueue],
    ['knowledge-tools', KnowledgeTools],
  ])
  ctx.loader.internal = { version: 'v2', import: async (name: string) => {
    if (!modules.has(name)) throw new Error('unexpected fixture import: ' + name)
    return modules.get(name)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  const configs: Record<string, unknown> = {
    json: { root: join(root, 'domain') }, domain: { backend: 'json' },
    queue: { queueRoot: join(root, 'queue'), maxConcurrent: 1, resourceCapacity: { 'knowledge-base': 1, codex: 1 } },
    knowledge: { root: join(root, 'content') },
  }
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify(
    [...modules.keys()].map(name => ({ id: name, name, ...(configs[name] ? { config: configs[name] } : {}) })),
  ))
  const parent = await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  assertEntriesLoaded(ctx, 'knowledge Loader')
  const session = ctx.sessions.create(SessionId('knowledge-command-user'))
  const actor = { id: session.id, session, ctx, options: {}, status: 'idle' } as unknown as Agent
  const command = async (request: unknown): Promise<unknown> => {
    const execution = await ctx.commands.execute(actor, '/knowledge ' + JSON.stringify(request), [], new AbortController().signal)
    expect(execution?.result.kind, execution?.result.text).toBe('success')
    return JSON.parse(execution!.result.text!) as unknown
  }
  return { ctx, root, actor, command, parent }
}

describe('知识库真实 Loader 与命令入口', () => {
  it('配置省略时仍可加载，命令经 Queue 生成、审查并发布可读取文件', async () => {
    const { ctx, root, command } = await boot()
    const spec = { id: 'game', title: '游戏原型', readerTask: '写出试玩说明', language: 'zh-CN',
      seeds: [{ id: 'scope', title: '玩法范围', goal: '确定玩家动作', type: 'method', depends: [], sourceIds: ['manual'], required: true }] }
    await command({ action: 'create', spec })
    await command({ action: 'source', projectId: 'game', sourceId: 'manual', title: '样例资料', text: '先描述玩家动作与反馈。' })
    await command({ action: 'confirm', projectId: 'game', planHash: canonicalHash(spec) })
    for (const action of ['generate', 'review']) {
      const bound = workResultSchema.parse(await command({ action, projectId: 'game', entryId: 'scope' }))
      await vi.waitFor(() => { expect(ctx.knowledgeQueue.status(bound.workId).state.status).toBe('succeeded') })
    }
    expect(checkResultSchema.parse(await command({ action: 'check', projectId: 'game' })).publishable).toBe(true)
    const released = releaseResultSchema.parse(await command({ action: 'publish', projectId: 'game', version: 'v1' }))
    expect(await readFile(join(released.path, 'entry-scope.md'), 'utf8')).toContain('先写出玩家动作与可观察反馈')
    const persisted = persistedStateSchema.parse(
      JSON.parse(await readFile(join(root, 'domain', 'knowledge_base.json'), 'utf8')),
    )
    expect(persisted.tables.projects.game.currentRelease).toBe('v1')
  })

  it('工具 Loader 条目真实卸载并重载时命令不泄漏也不重复', async () => {
    const { ctx, actor } = await boot()
    expect('default' in KnowledgeTools).toBe(false)
    expect(ctx.commands.list(actor).filter(command => command.name === 'knowledge')).toHaveLength(1)
    const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'knowledge-tools')
    expect(entry).toBeDefined()
    await entry!.update({ disabled: true })
    await ctx.loader.await()
    expect(ctx.commands.list(actor).filter(command => command.name === 'knowledge')).toHaveLength(0)
    await entry!.update({ disabled: false })
    await ctx.loader.await()
    expect(ctx.commands.list(actor).filter(command => command.name === 'knowledge')).toHaveLength(1)
  })

  it('build 通过真实 Queue correction 修正已确定的 validation failure', async () => {
    const { command } = await boot()
    const spec = { id: 'game', title: '游戏原型', readerTask: '写出试玩说明', language: 'zh-CN',
      seeds: [{ id: 'scope', title: '玩法范围', goal: '确定玩家动作', type: 'method', depends: [], sourceIds: ['manual'], required: true }] }
    await command({ action: 'create', spec })
    await command({ action: 'source', projectId: 'game', sourceId: 'manual', title: '样例资料', text: '先描述玩家动作与反馈。' })
    await command({ action: 'confirm', projectId: 'game', planHash: canonicalHash(spec) })
    responses.rejectNextGeneration = true
    await expect(command({ action: 'build', projectId: 'game', maxRevisions: 2 })).resolves.toMatchObject({
      status: 'completed', completed: ['scope'], incomplete: [],
    })
  })
})
