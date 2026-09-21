/**
 * Real registry/Agent/Session regression coverage for scheduler containment.
 * Only the model is scripted; internal scheduler methods inject failures that
 * ordinary tools/pre/post errors would otherwise normalize into results.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, interruptedTurnClosers, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture, TOOL_RUNTIME_SCHEDULER } from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { ToolCallSettlementError } from '../src/tool-calls.ts'
import { MockAdapter, textResponse } from './mock-adapter.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

function callsResponse(count: number): StreamChunk[] {
  const chunks: StreamChunk[] = []
  for (let index = 0; index < count; index++) {
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'block-end', index, block: {
        type: 'tool-call', id: ToolCallId(`c${index + 1}`), name: 'record', arguments: JSON.stringify({ id: String(index + 1) }),
      } },
    )
  }
  chunks.push({ type: 'finish', reason: { kind: 'tool-calls' } })
  return chunks
}

async function harness(count = 3, cap = 1) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: cap })
  const adapter = new MockAdapter([callsResponse(count), textResponse('after recovery')])
  ctx.llm.registerAdapter(['mock'], adapter)
  const effects: string[] = []
  ctx.tools.register(defineContentToolFixture({
    name: 'record', description: 'record one effect',
    parameters: { id: { type: 'string', required: true } },
    isConcurrencySafe: () => true,
    async execute(args) {
      effects.push(args.id)
      return [{ type: 'text', text: `recorded-${args.id}` }]
    },
  }))
  const log: SessionEvent[] = []
  const errors: unknown[] = []
  ctx.on('session/event', (_session, event) => { log.push(event) }, { global: true })
  ctx.on('agent/error', ({ error }) => { errors.push(error) })
  const agent = await ctx.agentLoop.create(SessionId('terminal-state'), { provider: 'mock', model: 'mock' })
  const scheduler = ctx.tools[TOOL_RUNTIME_SCHEDULER]
  const run = async () => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  return { ctx, agent, scheduler, log, errors, effects, run }
}

function resultCodes(log: readonly SessionEvent[]): (string | undefined)[] {
  return log.flatMap(event => event.type === 'tool/result' ? [event.data.error?.code] : [])
}

function assertBalanced(session: Session, log: readonly SessionEvent[], count: number): void {
  const ids = Array.from({ length: count }, (_, index) => ToolCallId(`c${index + 1}`))
  const results = log.filter(event => event.type === 'tool/result')
  expect(results.map(event => event.data.message.source.callId)).toEqual(ids)
  for (const event of results) {
    expect(event.sourceEventSeqs).toHaveLength(1)
    const call = log.find(item => item.seq === event.sourceEventSeqs?.[0])
    expect(call).toMatchObject({ type: 'tool/call', data: { callId: event.data.message.source.callId } })
  }
  const blocks = session.deriveMessages().flatMap(message => message.content)
  expect(blocks.flatMap(block => block.type === 'tool-result' ? [block.toolCallId] : [])).toEqual(ids)
  expect(interruptedTurnClosers(log)).toEqual([])
}

describe('tool terminal-state containment', () => {
  it('keeps an already committed result and closes prepare failure plus later calls', async () => {
    const f = await harness()
    const prepare = f.scheduler.prepare.bind(f.scheduler)
    const error = new Error('prepare exploded')
    f.scheduler.prepare = async (exec) => {
      if (exec.callId === ToolCallId('c2')) throw error
      return prepare(exec)
    }
    await f.run()
    expect(f.errors).toContain(error)
    expect(f.effects).toEqual(['1'])
    expect(resultCodes(f.log)).toEqual([undefined, 'TOOL_NOT_STARTED', 'TOOL_NOT_STARTED'])
    assertBalanced(f.agent.session, f.log, 3)

    const before = [...f.effects]
    // Detached seed replay derives messages only; it cannot invoke a tool.
    const replay = Session.create(SessionId('terminal-replay'), f.log)
    expect(replay.deriveMessages()).toEqual(f.agent.session.deriveMessages())
    expect(interruptedTurnClosers(f.log)).toEqual([])
    expect(f.effects).toEqual(before)

    f.scheduler.prepare = prepare
    await f.run()
    expect(f.effects).toEqual(before)
    expect(f.log.findLast(event => event.type === 'turn/end')).toMatchObject({ data: { reason: { kind: 'completed' } } })
  })

  it.each(['sync', 'async'] as const)('marks %s dispatch failure as unknown without retrying', async (kind) => {
    const f = await harness()
    const error = new Error('dispatch exploded')
    let dispatches = 0
    f.scheduler.dispatch = () => {
      dispatches++
      if (kind === 'sync') throw error
      return Promise.reject(error)
    }
    await f.run()
    expect(dispatches).toBe(1)
    expect(f.errors).toContain(error)
    expect(resultCodes(f.log)).toEqual(['TOOL_OUTCOME_UNKNOWN', 'TOOL_NOT_STARTED', 'TOOL_NOT_STARTED'])
    assertBalanced(f.agent.session, f.log, 3)
  })

  it('drains and finalizes a real sibling result after an earlier dispatch rejects', async () => {
    const f = await harness(3, 2)
    const first = Promise.withResolvers<never>()
    const sibling = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const dispatch = f.scheduler.dispatch.bind(f.scheduler)
    const error = new Error('first scheduler failure')
    f.scheduler.dispatch = async (exec) => {
      if (exec.callId === ToolCallId('c1')) return first.promise
      started.resolve()
      await sibling.promise
      return dispatch(exec)
    }
    const run = f.run()
    try {
      await started.promise
      first.reject(error)
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(f.log.some(event => event.type === 'turn/end')).toBe(false)
    } finally {
      sibling.resolve()
      await run
    }
    expect(f.errors).toContain(error)
    expect(f.effects).toEqual(['2'])
    expect(resultCodes(f.log)).toEqual(['TOOL_OUTCOME_UNKNOWN', undefined, 'TOOL_NOT_STARTED'])
    assertBalanced(f.agent.session, f.log, 3)
  })

  it('does not invoke a failed finalizer twice or discard a settled sibling', async () => {
    const f = await harness(3, 2)
    const gate = Promise.withResolvers<void>()
    const dispatch = f.scheduler.dispatch.bind(f.scheduler)
    const finalize = f.scheduler.finalize.bind(f.scheduler)
    const finalizations: string[] = []
    const error = new Error('finalization exploded')
    f.scheduler.dispatch = async (exec) => {
      if (exec.callId === ToolCallId('c1')) await gate.promise
      else gate.resolve()
      return dispatch(exec)
    }
    f.scheduler.finalize = async (exec, result) => {
      finalizations.push(String(exec.callId))
      if (exec.callId === ToolCallId('c1')) throw error
      return finalize(exec, result)
    }
    await f.run()
    expect(finalizations).toEqual(['c1', 'c2'])
    expect(resultCodes(f.log)).toEqual(['TOOL_OUTCOME_UNKNOWN', undefined, 'TOOL_NOT_STARTED'])
    expect(f.effects.slice().sort()).toEqual(['1', '2'])
    assertBalanced(f.agent.session, f.log, 3)
  })

  it('leaves an append-rejected tail open and fences the current driver', async () => {
    const f = await harness()
    const disk = new Error('result append veto')
    const release = f.ctx.on('internal/dispatch', (_mode, eventName, args) => {
      if (eventName !== 'session/event') return
      const [session, event] = args as [Session, SessionEvent]
      if (session === f.agent.session && event.type === 'tool/result') throw disk
    }, { global: true })
    try {
      await f.run()
      expect(f.effects).toEqual(['1'])
      expect(f.log.some(event => event.type === 'step/end' || event.type === 'turn/end')).toBe(false)
      expect(f.errors[0]).toBeInstanceOf(ToolCallSettlementError)
      expect((f.errors[0] as Error).cause).toBe(disk)
      expect(() => f.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'retry' }], source: { kind: 'user' } })))
        .toThrow(ToolCallSettlementError)
      expect(() => f.agent.runMaintenance(async () => undefined)).toThrow(ToolCallSettlementError)
      const closers = interruptedTurnClosers(f.log)
      expect(closers.flatMap(event => event.type === 'tool/result' ? [event.data.error?.code] : []))
        .toEqual(['TOOL_OUTCOME_UNKNOWN', 'TOOL_NOT_STARTED', 'TOOL_NOT_STARTED'])
      expect(f.effects).toEqual(['1'])
    } finally {
      release()
    }
  })

  it('does not seal the tail when the recovery durability checkpoint fails', async () => {
    const f = await harness()
    const schedulerError = new Error('prepare failure')
    const disk = new Error('checkpoint failure')
    f.scheduler.prepare = async () => { throw schedulerError }
    const release = f.ctx.on('session/flush', () => { throw disk }, { global: true })
    try {
      await f.run()
      expect(resultCodes(f.log)).toEqual(['TOOL_NOT_STARTED', 'TOOL_NOT_STARTED', 'TOOL_NOT_STARTED'])
      expect(f.log.some(event => event.type === 'step/end' || event.type === 'turn/end')).toBe(false)
      expect(f.errors[0]).toBeInstanceOf(ToolCallSettlementError)
      const cause = (f.errors[0] as Error).cause as AggregateError
      expect(cause.errors).toContain(schedulerError)
      expect(cause.errors).toContain(disk)
      expect(f.effects).toEqual([])
    } finally {
      release()
    }
  })
})
