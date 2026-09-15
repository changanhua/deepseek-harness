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
  seed: z.object({ id: z.string(), title: z.string(), type: z.string(), depends: z.array(z.string()) }).optional(),
  entry: z.object({ id: z.string() }).nullable().optional(),
  sources: z.array(z.object({ sourceId: z.string(), snapshotId: z.string(), text: z.string() })),
})

const state = vi.hoisted(() => ({ calls: [] as string[], sourceA: 'A v1', failFetch: false }))
vi.mock('@deepseek-ai/dsh-subagent-codex/app-server-run', () => ({
  startCodexAppServerRun: async (request: { prompt: { text: string }[] }) => {
    const prompt = request.prompt[0]!.text
    const context = generationContextSchema.parse(JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1)))
    const source = context.sources[0]
    if (!source) throw new Error('test fixture requires one source')
    const review = prompt.startsWith('审查')
    state.calls.push(`${review ? 'review:' : 'generate:'}${review ? context.entry!.id : context.seed!.id}`)
    const output = review ? { status: 'pass', issues: [], summary: 'ok' } : {
      id: context.seed!.id, title: context.seed!.title, type: context.seed!.type, seedIds: [context.seed!.id],
      depends: context.seed!.depends, related: [], conditions: 'test',
      body: context.seed!.id === 'a' ? source.text : `stable ${context.seed!.id}`,
      citations: [{ sourceId: source.sourceId, snapshotId: source.snapshotId, quote: source.text }],
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
afterEach(async () => { state.calls = []; state.sourceA = 'A v1'; state.failFetch = false; for (const ctx of contexts.splice(0)) await ctx.fiber.dispose(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function boot() {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-m0-')); roots.push(root)
  const ctx = new Context(); contexts.push(ctx); ctx.baseUrl = pathToFileURL(root).href + '/'
  ctx.provide('web', { fetch: async () => {
    if (state.failFetch) throw new Error('network down')
    return { statusCode: 200, url: 'https://example.test/a', body: { content: state.sourceA }, truncated: false }
  } } as never)
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([['sessions', SessionStore], ['agents', AgentRegistry], ['prompt', SystemPrompt], ['tools', Tools], ['commands', Commands], ['storage', Storage], ['json', StorageJson], ['domain', StorageDomain], ['process', Subprocess], ['queue', LocalTaskQueue], ['knowledge', Knowledge], ['knowledge-queue', KnowledgeQueue], ['knowledge-tools', KnowledgeTools]])
  ctx.loader.internal = { version: 'v2', import: async (name: string) => modules.get(name) ?? Promise.reject(new Error(name)) } as never
  const config = join(root, 'cordis.yml')
  await writeFile(config, JSON.stringify([...modules.keys()].map(name => ({ id: name, name, ...(name === 'json' ? { config: { root: join(root, 'domain') } } : name === 'domain' ? { config: { backend: 'json' } } : name === 'queue' ? { config: { queueRoot: join(root, 'queue'), maxConcurrent: 1, resourceCapacity: { 'knowledge-base': 1, codex: 1 } } } : name === 'knowledge' ? { config: { root: join(root, 'content') } } : {}) }))))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } }); await ctx.loader.await(); assertEntriesLoaded(ctx, 'm0')
  const session = ctx.sessions.create(SessionId('m0-user')); const actor = { id: session.id, session, ctx, options: {}, status: 'idle' } as unknown as Agent
  const command = async (request: unknown): Promise<unknown> => {
    const run = await ctx.commands.execute(actor, `/knowledge ${JSON.stringify(request)}`, [], new AbortController().signal)
    expect(run?.result.kind, run?.result.text).toBe('success')
    return JSON.parse(run!.result.text!) as unknown
  }
  return { ctx, root, command }
}

describe('M0 refresh with real Loader and durable Queue', () => {
  it('refreshes the exact dependency closure, preserves unchanged downstream work, and protects prior releases', async () => {
    const { ctx, root, command } = await boot()
    const spec = { id: 'm0', title: 'M0', readerTask: 'read', language: 'zh-CN', seeds: [
      { id: 'a', title: 'A', goal: 'A', type: 'fact', depends: [], sourceIds: ['source-a'], required: true },
      { id: 'b', title: 'B', goal: 'B', type: 'fact', depends: ['a'], sourceIds: ['source-b'], required: true },
      { id: 'c', title: 'C', goal: 'C', type: 'fact', depends: ['b'], sourceIds: ['source-b'], required: true },
      { id: 'd', title: 'D', goal: 'D', type: 'fact', depends: [], sourceIds: ['source-b'], required: true },
      { id: 'e', title: 'E', goal: 'E', type: 'fact', depends: [], sourceIds: ['source-b'], required: true },
    ] }
    await command({ action: 'create', spec }); await command({ action: 'source', projectId: 'm0', sourceId: 'source-a', title: 'A', text: 'A v1', url: 'https://example.test/a' }); await command({ action: 'source', projectId: 'm0', sourceId: 'source-b', title: 'B', text: 'B stable' }); await command({ action: 'confirm', projectId: 'm0', planHash: canonicalHash(spec) })
    await expect(command({ action: 'build', projectId: 'm0', maxRevisions: 0 })).resolves.toMatchObject({ status: 'completed' })
    await command({ action: 'publish', projectId: 'm0', version: 'v1' })
    state.calls = []; state.sourceA = 'A v2'
    await expect(command({ action: 'refresh', projectId: 'm0', sourceId: 'source-a' })).resolves.toMatchObject({ changed: true, affected: ['a', 'b', 'c'] })
    await expect(command({ action: 'build', projectId: 'm0', maxRevisions: 0 })).resolves.toMatchObject({ status: 'completed' })
    expect(state.calls).toEqual(['generate:a', 'review:a', 'generate:b', 'review:b'])
    await command({ action: 'publish', projectId: 'm0', version: 'v2' })
    expect(await command({ action: 'diff', projectId: 'm0', from: 'v1', to: 'v2' })).toMatchObject({ changed: ['a'] })
    await writeFile(join(root, 'content', 'projects', 'm0', 'entries', 'b.md'), 'manual edit')
    state.calls = []; state.sourceA = 'A v3'
    await command({ action: 'refresh', projectId: 'm0', sourceId: 'source-a' })
    await expect(command({ action: 'build', projectId: 'm0', maxRevisions: 0 })).resolves.toMatchObject({ status: 'incomplete' })
    expect(state.calls).toEqual([])
    state.failFetch = true
    await expect(command({ action: 'refresh', projectId: 'm0', sourceId: 'source-a' })).rejects.toThrow('network down')
    expect(ctx.knowledgeBase.repository.get('m0').sourceAvailability['source-a']?.status).toBe('unavailable')
    await command({ action: 'rollback', projectId: 'm0', version: 'v1' })
    expect(await readFile(join(root, 'content', 'projects', 'm0', 'entries', 'b.md'), 'utf8')).toBe('manual edit')
  })
})
