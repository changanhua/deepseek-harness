import { afterEach, describe, expect, it } from 'vitest'
import Commands, { CommandId } from '@deepseek-ai/dsh-commands'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createMemoryHarness } from '../../memory-local/tests/harness.ts'
import * as MemoryCommands from '../src/index.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function harness() {
  const memory = await createMemoryHarness()
  cleanup.push(memory.dispose)
  await memory.ctx.plugin(Commands)
  await memory.ctx.plugin(MemoryCommands)
  const agent = memory.agent()
  const created = await memory.ctx.projectMemory.propose(agent, {
    topicKey: 'method', kind: 'method', title: 'Verification', statement: 'Run pnpm test',
    sources: [{ kind: 'file', path: 'README.md' }], tags: [], conditions: '', idempotencyKey: 'candidate',
  })
  const handler = memory.ctx.commands.find(agent, 'memory')?.handler
  if (handler === undefined) throw new Error('memory command was not registered')
  return { ...memory, agent, id: created.id, handler }
}

describe('memory command alternate entry denial', () => {
  it('does not disclose foreign candidates, accepted records, or withdrawn history through human commands', async () => {
    const memory = await createMemoryHarness()
    cleanup.push(memory.dispose)
    await memory.ctx.plugin(Commands)
    await memory.ctx.plugin(MemoryCommands)
    const owner = memory.agent()
    await writeFile(join(memory.cwd, 'private-project-rule.md'), 'private-owner-only-rule')
    const { id } = await memory.ctx.projectMemory.propose(owner, {
      topicKey: 'private', kind: 'fact', title: 'Private rule', statement: 'private-owner-only-rule',
      sources: [{ kind: 'file', path: 'private-project-rule.md' }], idempotencyKey: 'private', tags: [], conditions: '',
    })
    const other = join(memory.root, 'other')
    await mkdir(other)
    await memory.ctx.workspaceRegistry.create(other)
    const stranger = memory.agent('another-project', other)
    const signal = new AbortController().signal
    for (const transition of [undefined, 'accept', 'retire']) {
      if (transition !== undefined) {
        expect((await memory.ctx.commands.execute(owner, `/memory ${transition} ${id}@1`, [], signal))?.result.kind).toBe('success')
      }
      const foreign = await memory.ctx.commands.execute(stranger, `/memory show ${id}@1`, [], signal)
      const missing = await memory.ctx.commands.execute(stranger, '/memory show missing@1', [], signal)
      expect(foreign?.result).toEqual(missing?.result)
      expect(foreign?.result.kind).toBe('error')
      const list = await memory.ctx.commands.execute(stranger, '/memory list', [], signal)
      expect(list?.result.text).toContain('共 0 条')
      expect(JSON.stringify([foreign?.result, list?.result])).not.toContain('private-owner-only-rule')
      expect(JSON.stringify([foreign?.result, list?.result])).not.toContain('private-project-rule.md')
    }
  })

  it('rejects direct handler execution without its admitted human command', async () => {
    const { agent, id, handler, records } = await harness()
    const result = await handler({
      agent, commandId: CommandId('forged'), rawInput: `accept ${id}@1`,
      attachments: [], signal: new AbortController().signal,
    })
    expect(result.kind).toBe('error')
    expect((await records(agent))[0]).toMatchObject({ activeRevision: null, recordVersion: 1 })
  })

  it('rejects reuse of a completed command invocation', async () => {
    const { ctx, agent, id, handler, records } = await harness()
    const executed = await ctx.commands.execute(agent, `/memory accept ${id}@1`, [], new AbortController().signal)
    if (executed === undefined) throw new Error('memory command did not execute')
    expect(executed.result.kind).toBe('success')
    const replay = await handler({
      agent, commandId: executed.commandId, rawInput: `accept ${id}@1`,
      attachments: [], signal: new AbortController().signal,
    })
    expect(replay.kind).toBe('error')
    expect((await records(agent))[0]?.decisions).toHaveLength(1)
  })

  it('rejects an expired review date without changing the candidate', async () => {
    const { ctx, agent, id, records } = await harness()
    const executed = await ctx.commands.execute(
      agent, `/memory accept ${id}@1 --review-after 2000-01-01T00:00:00.000Z`, [], new AbortController().signal,
    )
    expect(executed?.result.kind).toBe('error')
    expect((await records(agent))[0]).toMatchObject({ activeRevision: null, recordVersion: 1 })
  })
})
