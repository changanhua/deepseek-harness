import { afterEach, describe, expect, it } from 'vitest'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import LocalFs from '@deepseek-ai/dsh-fs-local'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { CommandId } from '@deepseek-ai/dsh-commands'
import LocalProjectMemory from '../src/index.ts'

const cleanup: Array<() => Promise<void>> = []
const draft = (key = 'save') => ({ topicKey: 'validation.command', kind: 'method' as const, title: '验证命令', statement: '运行 pnpm test', sources: [{ kind: 'file' as const, path: 'README.md' }], tags: ['验证'], conditions: '', idempotencyKey: key })

afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-contract-test-'))
  const ctx = new Context()
  cleanup.push(async () => {
    await ctx.fiber.dispose()
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !root.includes('dsh-memory-contract-test-')) throw new Error('refusing unrelated cleanup')
    await rm(root, { recursive: true, force: true })
  })
  const cwd = join(root, 'project')
  await mkdir(cwd)
  await writeFile(join(cwd, 'README.md'), '运行 pnpm test')
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(WorkspaceRegistry)
  await ctx.workspaceRegistry.create(cwd)
  await ctx.plugin(SessionQuery, { path: ':memory:', openAt: 'never' })
  await ctx.plugin(LocalFs, { cwd })
  const fiber = await ctx.plugin(LocalProjectMemory, { ownershipRoot: join(root, 'owner') })
  const agent = (id: string, path = cwd): Agent => {
    const session = ctx.sessions.create(SessionId(id), { meta: { cwd: path } })
    return { id: session.id, session, ctx } as unknown as Agent
  }
  return { ctx, root, cwd, fiber, agent }
}

function command(agent: Agent, commandId: string, args: string) {
  agent.session.append('command/run', { commandId: CommandId(commandId), name: 'memory', args, source: { kind: 'user' } })
}

describe('project memory service authority and recall', () => {
  it('withholds candidates, then recalls a human-accepted claim in a fresh session', async () => {
    const { ctx, agent } = await harness()
    const first = agent('first')
    const created = await ctx.projectMemory.propose(first, draft())
    expect((await ctx.projectMemory.search(first, { query: '验证' })).items).toHaveLength(0)
    await expect(ctx.projectMemory.decide(first, { id: created.id, revision: 1, expectedVersion: 1, action: 'accept', commandId: 'not-a-command' })).rejects.toMatchObject({ code: 'unauthorized' })
    command(first, 'accept-1', `accept ${created.id}@1`)
    await ctx.projectMemory.decide(first, { id: created.id, revision: 1, expectedVersion: 1, action: 'accept', commandId: 'accept-1' })
    const recalled = await ctx.projectMemory.search(agent('second'), { query: '验证' })
    expect(recalled.items).toHaveLength(1)
    expect(recalled.items[0]).toMatchObject({ id: created.id, revision: 1, eligibility: 'usable', memory: { statement: '运行 pnpm test' } })
  })

  it('withholds an accepted body after its source changes and after retirement', async () => {
    const { ctx, cwd, agent } = await harness()
    const caller = agent('reader')
    const { id } = await ctx.projectMemory.propose(caller, draft())
    command(caller, 'accept', `accept ${id}@1`)
    await ctx.projectMemory.decide(caller, { id, revision: 1, expectedVersion: 1, action: 'accept', commandId: 'accept' })
    await writeFile(join(cwd, 'README.md'), '运行新命令')
    expect(await ctx.projectMemory.read(caller, id)).toMatchObject({ eligibility: 'source-changed' })
    expect(await ctx.projectMemory.read(caller, id)).not.toHaveProperty('memory')
    command(caller, 'retire', `retire ${id}@1`)
    await ctx.projectMemory.decide(caller, { id, revision: 1, expectedVersion: 2, action: 'retire', commandId: 'retire' })
    expect(await ctx.projectMemory.read(caller, id)).toMatchObject({ eligibility: 'withdrawn' })
  })

  it('does not disclose a foreign record or widen an unregistered directory to global memory', async () => {
    const { ctx, root, agent } = await harness()
    const { id } = await ctx.projectMemory.propose(agent('owner'), draft())
    const other = join(root, 'other')
    await mkdir(other)
    const stranger = agent('stranger', other)
    await expect(ctx.projectMemory.search(stranger, { query: '验证' })).rejects.toMatchObject({ code: 'workspace-unavailable' })
    await ctx.workspaceRegistry.create(other)
    await expect(ctx.projectMemory.read(stranger, id)).rejects.toMatchObject({ code: 'not-found' })
    await expect(ctx.projectMemory.read(stranger, 'absent')).rejects.toMatchObject({ code: 'not-found' })
  })

  it('requires the exact active human command for inspection and decision arguments', async () => {
    const { ctx, agent } = await harness()
    const caller = agent('operator')
    const { id } = await ctx.projectMemory.propose(caller, draft())
    command(caller, 'show', `show ${id}`)
    expect(await ctx.projectMemory.inspect(caller, { commandId: 'show', id })).toMatchObject([{ id, candidateRevision: 1 }])
    await expect(ctx.projectMemory.decide(caller, { id, revision: 1, expectedVersion: 1, action: 'accept', commandId: 'show' })).rejects.toMatchObject({ code: 'unauthorized' })
    command(caller, 'accept', `accept ${id}@1`)
    await expect(ctx.projectMemory.decide(caller, { id, revision: 1, expectedVersion: 1, action: 'accept', commandId: 'accept', reviewAfter: '2099-01-01T00:00:00.000Z' })).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('withholds conflicting accepted claims on the same topic', async () => {
    const { ctx, agent } = await harness()
    const caller = agent('conflict')
    for (const [key, text] of [['one', '运行 pnpm test'], ['two', '运行 npm test']] as const) {
      const { id } = await ctx.projectMemory.propose(caller, { ...draft(key), statement: text })
      command(caller, key, `accept ${id}@1`)
      await ctx.projectMemory.decide(caller, { id, revision: 1, expectedVersion: 1, action: 'accept', commandId: key })
    }
    expect(await ctx.projectMemory.search(caller, { query: '验证' })).toMatchObject({ items: [], excluded: { conflicted: 2 } })
  })

  it('unloads its service and owner lock before reopening the same records', async () => {
    const { ctx, root, fiber, agent } = await harness()
    const caller = agent('restart')
    const created = await ctx.projectMemory.propose(caller, draft())
    await fiber.dispose()
    expect(ctx.get('projectMemory')).toBeUndefined()
    await expect(access(join(root, 'owner', 'owner.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
    await ctx.plugin(LocalProjectMemory, { ownershipRoot: join(root, 'owner') })
    expect(await ctx.projectMemory.propose(caller, draft())).toEqual(created)
    expect(await ctx.projectMemory.read(caller, created.id)).toMatchObject({ eligibility: 'withdrawn' })
  })
})
