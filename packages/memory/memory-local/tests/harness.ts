import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import LocalFs from '@deepseek-ai/dsh-fs-local'
import Storage from '@deepseek-ai/dsh-storage'
import type { KvUnit } from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { CommandId } from '@deepseek-ai/dsh-commands'
import LocalProjectMemory from '../src/index.ts'
import type { Config } from '../src/index.ts'

/** Persist one live Session through the current explicit writer API for source tests. */
export async function persistSession(ctx: Context, session: import('@deepseek-ai/dsh-session').Session): Promise<void> {
  const writer = await ctx.sessionPersistence.create(session.header)
  await writer.append(session.snapshotEvents())
  await writer.close()
}

/** Real memory dependencies; only the model-driving Agent handle is inert. */
export async function createMemoryHarness(
  config: Partial<Omit<Config, 'ownershipRoot'>> = {}, wrapMemoryUnit?: (unit: KvUnit) => KvUnit,
) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-consumer-test-'))
  const ctx = new Context()
  const dispose = async () => {
    await ctx.fiber.dispose()
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !root.includes('dsh-memory-consumer-test-')) {
      throw new Error('refusing unrelated cleanup')
    }
    await rm(root, { recursive: true, force: true })
  }
  try {
    const cwd = join(root, 'project')
    await mkdir(cwd)
    await writeFile(join(cwd, 'README.md'), '项目验证命令是 pnpm test。')
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions'), compression: 'none' })
    await ctx.plugin(Storage)
    await ctx.plugin(JsonStorage, { root: join(root, 'storage') })
    if (wrapMemoryUnit !== undefined) {
      const kv = ctx.storage.backend.get('json').kv
      if (kv === undefined) throw new Error('JSON backend has no KV facet')
      const open = kv.open.bind(kv)
      kv.open = async (descriptor) => {
        const unit = await open(descriptor)
        return descriptor.name === 'project_memory' ? wrapMemoryUnit(unit) : unit
      }
    }
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(WorkspaceRegistry)
    await ctx.workspaceRegistry.create(cwd)
    await ctx.plugin(SessionQuery, { path: ':memory:', openAt: 'never' })
    await ctx.plugin(LocalFs, { cwd })
    const memoryFiber = await ctx.plugin(LocalProjectMemory, { ...config, ownershipRoot: join(root, 'owner') })
    const agent = (id: string = randomUUID(), path = cwd): Agent => {
      const session = ctx.sessions.create(SessionId(id), { meta: { cwd: path } })
      return { id: session.id, session, ctx } as unknown as Agent
    }
    const human = (caller: Agent, args: string) => {
      const commandId = CommandId(randomUUID())
      caller.session.append('command/run', { commandId, name: 'memory', args, source: { kind: 'user' } })
      return commandId
    }
    const records = async (caller: Agent) => ctx.projectMemory.inspect(caller, { commandId: human(caller, 'list') })
    return { ctx, root, cwd, agent, human, records, dispose, memoryFiber }
  } catch (error) {
    await dispose()
    throw error
  }
}
