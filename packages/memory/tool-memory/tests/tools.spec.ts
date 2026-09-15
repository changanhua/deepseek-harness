import { afterEach, describe, expect, it } from 'vitest'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { createMemoryHarness } from '../../memory-local/tests/harness.ts'
import { persistSession } from '../../memory-local/tests/harness.ts'
import * as MemoryTools from '../src/index.ts'
import { renderMemoryResult } from '../src/presentation.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanups.splice(0).reverse()) await dispose() })

async function harness() {
  const memory = await createMemoryHarness()
  cleanups.push(memory.dispose)
  await memory.ctx.plugin(SystemPrompt)
  await memory.ctx.plugin(ToolRuntime)
  const fiber = await memory.ctx.plugin(MemoryTools)
  const caller = memory.agent()
  let calls = 0
  const call = (name: string, args: unknown, bound = true) => memory.ctx.tools.execute({
    name, arguments: args, callId: ToolCallId(`memory-call-${++calls}`),
    signal: new AbortController().signal, ...bound ? { agent: caller } : {},
  })
  return { ...memory, fiber, caller, call }
}

const draft = () => ({
  topic_key: 'validation.command', kind: 'method', title: '验证命令', statement: '运行 pnpm test',
  sources: [{ kind: 'file', path: 'README.md' }], idempotency_key: 'save-command',
})

describe('project memory model tools', () => {
  it('permits parallel checked reads while keeping proposal admission exclusive', async () => {
    const { ctx, caller } = await harness()
    const input = { agent: caller, arguments: {}, callId: ToolCallId('classification'), signal: new AbortController().signal }
    expect(ctx.tools.executionMode({ ...input, name: 'memory_search', arguments: { query: 'history' } })).toEqual({ kind: 'parallel' })
    expect(ctx.tools.executionMode({ ...input, name: 'memory_read', arguments: { id: 'memory' } })).toEqual({ kind: 'parallel' })
    expect(ctx.tools.executionMode({ ...input, name: 'memory_search' })).toEqual({ kind: 'exclusive' })
    expect(ctx.tools.executionMode({ ...input, name: 'memory_propose' })).toEqual({ kind: 'exclusive' })
  })

  it('recalls a human-accepted Session-sourced claim through filtered search and direct read', async () => {
    const memory = await harness()
    const event = memory.caller.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '验证必须先运行 pnpm test。' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await persistSession(memory.ctx, memory.caller.session)
    const proposed = await memory.call('memory_propose', {
      ...draft(), tags: ['ci'], conditions: 'Before integration',
      sources: [{ kind: 'session-event', session_id: memory.caller.session.id, seq: event.seq }],
    })
    expect(proposed.isError).toBe(false)
    const record = (await memory.records(memory.caller))[0]
    if (record === undefined) throw new Error('proposal did not persist')
    expect(record.revisions[0]?.sources).toMatchObject([{ kind: 'session-event', sessionId: memory.caller.session.id, seq: event.seq }])
    await memory.ctx.projectMemory.decide(memory.caller, {
      id: record.id, revision: 1, expectedVersion: 1, action: 'accept',
      commandId: memory.human(memory.caller, `accept ${record.id}@1`),
    })
    for (const result of [
      await memory.call('memory_search', { query: '验证', tags: ['ci'], limit: 1 }),
      await memory.call('memory_read', { id: record.id }),
    ]) {
      expect(result.isError).toBe(false)
      expect(JSON.stringify(result.content)).toContain(record.id)
      expect(JSON.stringify(result.content)).toContain('usable')
      expect(JSON.stringify(result.content)).toContain('checkedAt')
    }
    expect((await memory.call('memory_search', { query: '验证', tags: ['another-tag'] })).content)
      .toEqual([{ type: 'text', text: '{"items":[],"excluded":{}}' }])
    const amendment = await memory.call('memory_propose', {
      ...draft(), memory_id: record.id, expected_version: 2, idempotency_key: 'amend',
      sources: [{ kind: 'file', path: 'README.md', line: 1 }], statement: '运行修订后的项目验证',
    })
    expect(amendment.isError).toBe(false)
    expect((await memory.records(memory.caller))[0]).toMatchObject({ activeRevision: 1, candidateRevision: 2, recordVersion: 3 })
  })

  it('proposes a durable candidate, withholds it from search, and exposes no approval tool', async () => {
    const { ctx, caller, call, records } = await harness()
    expect(ctx.tools.schemas(caller).map(item => item.name).sort()).toEqual(['memory_propose', 'memory_read', 'memory_search'])
    const proposed = await call('memory_propose', draft())
    expect(proposed.isError).toBe(false)
    expect(await records(caller)).toMatchObject([{ candidateRevision: 1, activeRevision: null }])
    const searched = await call('memory_search', { query: '验证' })
    expect(searched.content).toEqual([{ type: 'text', text: '{"items":[],"excluded":{}}' }])
    expect((await call('memory_accept', { id: 'anything' })).isError).toBe(true)
  })

  it.each([
    { actor: 'human' }, { workspaceId: 'foreign' }, { accepted: true }, { commandId: 'forged' },
    { sources: [{ kind: 'file', path: 'README.md', sha256: 'a'.repeat(64) }] },
  ])('rejects widened authority or self-certified provenance before writing', async (extra) => {
    const { call, caller, records } = await harness()
    expect((await call('memory_propose', { ...draft(), ...extra })).isError).toBe(true)
    expect(await records(caller)).toEqual([])
  })

  it('requires an Agent-bound caller', async () => {
    const { call } = await harness()
    expect((await call('memory_search', { query: '验证' }, false)).isError).toBe(true)
  })

  it('reuses the same candidate receipt for identical tool retries', async () => {
    const { call, caller, records } = await harness()
    const first = await call('memory_propose', draft())
    const second = await call('memory_propose', draft())
    expect(second.content).toEqual(first.content)
    expect(await records(caller)).toHaveLength(1)
  })

  it('withdraws its three registrations on unload', async () => {
    const { ctx, caller, fiber } = await harness()
    await fiber.dispose()
    expect(ctx.tools.schemas(caller)).toEqual([])
  })

  it('bounds the complete UTF-8 text block rather than only the inner JSON', () => {
    const value = { word: '🐕' }
    const expected = '[{"type":"text","text":"{\\"word\\":\\"🐕\\"}"}]'
    const bytes = Buffer.byteLength(expected, 'utf8')
    expect(renderMemoryResult(value, bytes)).toBe('{"word":"🐕"}')
    expect(() => renderMemoryResult(value, bytes - 1)).toThrow()
  })
})
