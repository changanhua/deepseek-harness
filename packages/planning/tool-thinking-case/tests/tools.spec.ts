import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { bindScopeParent, createScope } from '@deepseek-ai/dsh-scope'
import type { ThinkingResultDraft } from '@changanhua/dsh-planning-remote/types'
import * as ThinkingTools from '../src/index.ts'
import * as ThinkingRestriction from '../src/restrict.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanups.splice(0).reverse()) await dispose() })

async function harness() {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const session = { id: 'thinking-session' }
  const agent = { id: session.id, session, ctx } as unknown as Agent
  ctx.agents.register(agent)
  const owner = {
    context: vi.fn(async () => ({ run: { id: 'run-1', question: 'What next?', sessionId: session.id, presetId: 'thinking-desk', createdAt: '2026-09-30T00:00:00.000Z' } })),
    submit: vi.fn(async (_agent: Agent, input: { expectedResultVersion: number; draft: ThinkingResultDraft }) => ({ id: 'result-1', version: input.expectedResultVersion + 1, createdAt: '2026-09-30T00:00:01.000Z', draft: input.draft, applied: { explorationNoteIds: [] } })),
    isThinkingSession: vi.fn(async () => true),
  }
  ctx.provide('thinkingCase', owner as never)
  const fiber = await ctx.plugin(ThinkingTools)
  cleanups.push(() => fiber.dispose())
  cleanups.push(() => ctx.fiber.dispose())
  let calls = 0
  const call = (name: string, args: unknown, bound = true) => ctx.tools.execute({
    name, arguments: args, callId: ToolCallId(`thinking-${++calls}`), signal: new AbortController().signal,
    ...(bound ? { agent } : {}),
  })
  return { ctx, agent, owner, call }
}

function json(result: { content: readonly { type: string; text?: string }[] }) {
  const text = result.content[0]?.text
  if (text === undefined) throw new Error('tool did not return text')
  return JSON.parse(text) as Record<string, unknown>
}

describe('thinking case model tools', () => {
  it('publishes a strict structured draft and Planning operation union to the model', async () => {
    const { ctx, agent, call } = await harness()
    const tool = ctx.tools.schemas(agent).find(value => value.name === 'thinking_submit_result')
    const parameters = tool?.parameters as {
      properties?: Record<string, unknown>
      required?: string[]
    } | undefined
    const draft = parameters?.properties?.draft as {
      type?: string
      additionalProperties?: boolean
      properties?: Record<string, unknown>
      required?: string[]
    } | undefined
    const delta = draft?.properties?.planning_delta as { properties?: Record<string, unknown> } | undefined
    const operations = delta?.properties?.operations as { items?: { oneOf?: unknown[] } } | undefined

    expect(draft).toMatchObject({ type: 'object', additionalProperties: false })
    expect(draft?.required).toEqual(['summary', 'findings', 'open_questions'])
    expect(Object.keys(draft?.properties ?? {}).sort()).toEqual([
      'design_context', 'exploration_notes', 'findings', 'open_questions', 'planning_delta', 'summary',
    ])
    expect(operations?.items?.oneOf).toHaveLength(7)
    expect((await call('thinking_submit_result', {
      expected_result_version: 0, request_id: 'reject-unknown',
      draft: { summary: 'x', findings: [], open_questions: [], forged: true },
    })).isError).toBe(true)
  })

  it('masks inherited tools in the child Agent scope while preserving standing Thinking tools', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.provide('thinkingCase', {
      context: async () => ({}), submit: async () => ({}), isThinkingSession: async () => true,
    } as never)
    ctx.tools.register({ name: 'planning_update', description: 'global write', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: () => [] }, execute: async () => 'bad' })
    const standingKey = { id: 'thinking-standing' } as Agent
    let standing!: ReturnType<typeof createScope>
    await ctx.plugin(Object.assign((inner: Context) => { standing = createScope(inner, standingKey) }, { inject: ['tools', 'systemPrompt'] }))
    await standing.ctx.plugin(ThinkingTools)
    await standing.ctx.plugin(ThinkingRestriction)
    const agent = { id: 'restricted', session: { id: 'restricted' } } as Agent
    bindScopeParent(agent, standingKey)
    let child!: ReturnType<typeof createScope>
    await ctx.plugin(Object.assign((inner: Context) => { child = createScope(inner, agent) }, { inject: ['tools', 'systemPrompt'] }))
    ;(agent as { ctx: Context }).ctx = child.ctx
    const unregister = ctx.agents.register(agent)

    expect(ctx.tools.schemas(agent).map(tool => tool.name).sort()).toEqual(['thinking_context', 'thinking_submit_result'])
    expect((await ctx.tools.execute({ name: 'planning_update', arguments: {}, callId: ToolCallId('restricted-write'), agent, signal: new AbortController().signal })).isError).toBe(true)
    unregister()
    await child.dispose()
    expect(ctx.tools.schemas(agent).map(tool => tool.name).sort()).toEqual(['planning_update', 'thinking_context', 'thinking_submit_result'])
    await standing.dispose()
    await ctx.fiber.dispose()
  })

  it('derives the active Agent and Session only from ToolRunContext', async () => {
    const { owner, call } = await harness()
    const result = await call('thinking_context', {})
    expect(result.isError).toBe(false)
    expect(json(result)).toMatchObject({ run: { id: 'run-1', sessionId: 'thinking-session' } })
    expect(owner.context).toHaveBeenCalledWith(expect.objectContaining({ id: 'thinking-session' }), expect.any(AbortSignal))
  })

  it('submits a versioned structured candidate without a model-chosen run identity', async () => {
    const { owner, call } = await harness()
    const result = await call('thinking_submit_result', {
      expected_result_version: 0,
      request_id: 'result-request-1',
      draft: { summary: 'Prefer the low-risk route.', findings: ['The case is stale-safe.'], open_questions: [] },
    })
    expect(result.isError).toBe(false)
    expect(json(result)).toMatchObject({ id: 'result-1', version: 1, draft: { summary: 'Prefer the low-risk route.' } })
    expect(owner.submit).toHaveBeenCalledWith(expect.anything(), {
      expectedResultVersion: 0,
      requestId: 'result-request-1',
      draft: { summary: 'Prefer the low-risk route.', findings: ['The case is stale-safe.'], openQuestions: [] },
    }, expect.any(AbortSignal))
  })

  it('rejects an unbound tool call before reading or submitting a run', async () => {
    const { owner, call } = await harness()
    expect((await call('thinking_context', {}, false)).isError).toBe(true)
    expect(owner.context).not.toHaveBeenCalled()
  })
})
