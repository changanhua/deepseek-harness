import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { BrowserActionResult, BrowserOperation } from '@changanhua/dsh-browser'
import { BrowserTaskLoop } from '../src/loop.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const sessionId = SessionId('browser-loop')
const page = { tabId: 4, frameId: 0, documentId: 'first', url: 'https://example.test/first' }
const fresh = { page: { ...page, documentId: 'second', url: 'https://example.test/done' }, text: 'Done', elements: [{ elementId: 'new-ref' }] }

function subject(events: unknown[] = []) {
  return { session: { id: sessionId, events }, inject: vi.fn(), steer: vi.fn() }
}

function browser() {
  return { execute: vi.fn(async (operation: BrowserOperation): Promise<BrowserActionResult> => ({ requestId: 'snapshot', sessionId, installationId: operation.installationId,
    outcome: 'observed' as const, delivery: 'sent' as const, value: fresh })) }
}

describe('browser task loop', () => {
  it('uses agent/turn-stopping to open the next native Agent step with a fresh observation', async () => {
    const ctx = new Context(), adapter = new MockAdapter([
      toolCallResponse('stale-click', 'browser_action', { elementId: 'old-ref' }),
      textResponse('I need current evidence'),
      toolCallResponse('fresh-click', 'browser_action', { elementId: 'new-ref' }),
      textResponse('I received it'),
    ])
    await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry); await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['mock'], adapter)
    const provider = browser(), loop = new BrowserTaskLoop(provider)
    ctx.on('agent/turn-stopping', async ({ agent, signal }) => { await loop.turnStopping(agent, signal) })
    const agent = ctx.agentLoop.create(SessionId('native-continuation'), { provider: 'mock', model: 'mock' })
    const executed: string[] = []
    ctx.tools.register(defineContentToolFixture({ name: 'browser_action', description: 'test browser action', parameters: { elementId: { type: 'string', required: true } }, execute: async ({ elementId }, exec) => {
      executed.push(elementId)
      loop.recordAction(exec.agent!, elementId === 'old-ref'
        ? { requestId: 'stale-click', sessionId: agent.session.id, installationId: 'extension', outcome: 'failed', delivery: 'not-sent', reason: 'stale_element' }
        : { requestId: 'fresh-click', sessionId: agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent', value: { feedback: { status: 'observed', snapshot: fresh } } }, { kind: 'click' } as never)
      return [{ type: 'text', text: elementId === 'old-ref' ? 'stale reference' : 'fresh action observed' }]
    } }))
    provider.execute.mockResolvedValueOnce({ requestId: 'initial', sessionId: agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent', value: { page, text: 'Loading', elements: [{ elementId: 'old-ref' }] } })
    provider.execute.mockResolvedValueOnce({ requestId: 'fresh', sessionId: agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent', value: { page: fresh.page, text: 'Still loading', elements: [{ elementId: 'new-ref' }] } })
    await loop.start(agent, { installationId: 'extension', page, goal: '打开结果', success: { text: 'Done' } }, new AbortController().signal)
    const idle = new Promise<void>((resolve) => { const dispose = ctx.on('agent/status', ({ agent: subject, status }) => { if (subject === agent && status === 'idle') { dispose(); resolve() } }) })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await idle

    expect(adapter.requests).toHaveLength(4)
    expect(JSON.stringify(adapter.requests[2]?.messages)).toContain('new-ref')
    expect(executed).toEqual(['old-ref', 'new-ref'])
    expect(loop.status(agent)).toMatchObject({ status: 'verified' })
    expect(agent.session.events.some(event => event.type === 'user/message' && event.data.source.kind === 'plugin' && JSON.stringify(event.data).includes('new-ref'))).toBe(true)
    await ctx.fiber.dispose()
  })

  it('re-observes after a stale action and continues the Agent through its lifecycle with the new references', async () => {
    const target = subject(), provider = browser(), loop = new BrowserTaskLoop(provider)
    provider.execute.mockResolvedValueOnce({ requestId: 'initial', sessionId, installationId: 'extension', outcome: 'observed', delivery: 'sent', value: { page, text: 'Loading', elements: [{ elementId: 'old-ref' }] } })
    await loop.start(target as never, { installationId: 'extension', page, goal: '打开结果', success: { text: 'Still loading' } }, new AbortController().signal)
    const stale: BrowserActionResult = { requestId: 'write', sessionId, installationId: 'extension', outcome: 'failed', delivery: 'not-sent', reason: 'stale_element' }
    loop.recordAction(target as never, stale, { kind: 'click', element: { page, snapshotId: 'old', elementId: 'old-ref' }, intent: '打开结果' } as never)
    await loop.turnStopping(target as never, new AbortController().signal)

    expect(provider.execute).toHaveBeenCalledTimes(2)
    expect(target.inject).toHaveBeenCalledOnce()
    expect(JSON.stringify(target.inject.mock.calls[0])).toContain('new-ref')
    expect(JSON.stringify(target.inject.mock.calls[0])).toContain('second')
  })

  it('marks an unknown action terminal and never injects another write opportunity', async () => {
    const target = subject(), provider = browser(), loop = new BrowserTaskLoop(provider)
    await loop.start(target as never, { installationId: 'extension', page, goal: '保存', success: { text: 'Done' } }, new AbortController().signal)
    loop.recordAction(target as never, { requestId: 'write', sessionId, installationId: 'extension', outcome: 'unknown', delivery: 'sent', reason: 'executor_reply_lost' }, { kind: 'submit', element: { page, snapshotId: 's', elementId: 'save' }, intent: '保存' } as never)
    await loop.turnStopping(target as never, new AbortController().signal)

    expect(target.inject).not.toHaveBeenCalled()
    expect(loop.status(target as never)).toMatchObject({ status: 'unknown' })
  })

  it('does not replace an active task and reset its continuation budget', async () => {
    const target = subject(), provider = browser(), loop = new BrowserTaskLoop(provider)
    await loop.start(target as never, { installationId: 'extension', page, goal: '第一个', success: { text: 'Done' } }, new AbortController().signal)
    await expect(loop.start(target as never, { installationId: 'extension', page, goal: '第二个', success: { text: 'Done' } }, new AbortController().signal)).rejects.toThrow('already active')
  })

  it('requires a new real user input before reopening an unknown task but allows a new request', async () => {
    const events = [{ type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [] } }]
    const target = subject(events), loop = new BrowserTaskLoop(browser())
    const input = { installationId: 'extension', page, goal: '保存', success: { text: 'Done' } }
    await loop.start(target as never, input, new AbortController().signal)
    loop.recordAction(target as never, { requestId: 'write', sessionId, installationId: 'extension', outcome: 'unknown', delivery: 'sent' }, { kind: 'click' } as never)
    await expect(loop.start(target as never, input, new AbortController().signal)).rejects.toThrow('terminal')
    events.push({ type: 'user/message', seq: 2, data: { source: { kind: 'user' }, content: [] } })
    await expect(loop.start(target as never, input, new AbortController().signal)).resolves.toMatchObject({ status: 'active' })
  })

  it.each([{ text: '' }, { url: '' }, { control: {} }])('rejects an empty machine success condition: %j', async (success) => {
    const target = subject(), loop = new BrowserTaskLoop(browser())
    await expect(loop.start(target as never, { installationId: 'extension', page, goal: '完成', success }, new AbortController().signal)).rejects.toThrow('non-empty')
  })

  it('clears a cancelled task when its Agent lifecycle is disposed', async () => {
    const target = subject(), provider = browser(), loop = new BrowserTaskLoop(provider)
    await loop.start(target as never, { installationId: 'extension', page, goal: '保存', success: { text: 'Done' } }, new AbortController().signal)
    loop.recordAction(target as never, { requestId: 'write', sessionId, installationId: 'extension', outcome: 'cancelled', delivery: 'not-sent' }, { kind: 'submit' } as never)
    await loop.turnStopping(target as never, new AbortController().signal)
    expect(loop.status(target as never)).toMatchObject({ status: 'cancelled' })
    expect(target.inject).not.toHaveBeenCalled()
    loop.dispose(target as never)
    expect(loop.status(target as never)).toBeUndefined()
  })

  it('stops after three identical failures instead of looping on the same stale reference', async () => {
    const target = subject(), provider = browser(), loop = new BrowserTaskLoop(provider)
    await loop.start(target as never, { installationId: 'extension', page, goal: '展开', success: { text: 'Done' } }, new AbortController().signal)
    for (let i = 0; i < 3; i++) loop.recordAction(target as never, { requestId: `write-${i}`, sessionId, installationId: 'extension', outcome: 'failed', delivery: 'not-sent', reason: 'stale_element' }, { kind: 'click' } as never)
    await loop.turnStopping(target as never, new AbortController().signal)
    expect(loop.status(target as never)).toMatchObject({ status: 'repeated_failure', sameFailures: 3 })
    expect(target.inject).not.toHaveBeenCalled()
  })

  it('stops when unverified native continuation steps exhaust the bounded budget', async () => {
    const target = subject(), provider = browser(), loop = new BrowserTaskLoop(provider)
    provider.execute.mockResolvedValue({ requestId: 'snapshot', sessionId, installationId: 'extension', outcome: 'observed', delivery: 'sent', value: { page, text: 'Waiting', elements: [] } })
    await loop.start(target as never, { installationId: 'extension', page, goal: '完成', success: { text: 'Never appears' } }, new AbortController().signal)
    for (let i = 0; i < 13; i++) await loop.turnStopping(target as never, new AbortController().signal)
    await loop.turnStopping(target as never, new AbortController().signal)
    expect(loop.status(target as never)).toMatchObject({ status: 'budget_exhausted' })
    expect(target.inject).toHaveBeenCalledTimes(12)

    const verified = await loop.verify(target as never, new AbortController().signal)
    expect(verified).toMatchObject({ status: 'budget_exhausted' })
  })

  it('does not verify from a cached snapshot after a fresh observation is unavailable', async () => {
    const target = subject(), provider = browser(), loop = new BrowserTaskLoop(provider)
    provider.execute.mockResolvedValueOnce({ requestId: 'initial', sessionId, installationId: 'extension', outcome: 'observed', delivery: 'sent', value: fresh })
    provider.execute.mockResolvedValueOnce({ requestId: 'lost', sessionId, installationId: 'extension', outcome: 'failed', delivery: 'not-sent' })
    await loop.start(target as never, { installationId: 'extension', page, goal: '完成', success: { text: 'Done' } }, new AbortController().signal)
    expect(await loop.verify(target as never, new AbortController().signal)).toMatchObject({ status: 'active', observation: undefined })
  })

  it('clears a prior observation when the fresh browser read throws', async () => {
    const target = subject(), provider = browser(), loop = new BrowserTaskLoop(provider)
    provider.execute.mockResolvedValueOnce({ requestId: 'initial', sessionId, installationId: 'extension', outcome: 'observed', delivery: 'sent', value: fresh })
    provider.execute.mockRejectedValueOnce(new Error('browser offline'))
    await loop.start(target as never, { installationId: 'extension', page, goal: '完成', success: { text: 'Done' } }, new AbortController().signal)
    expect(await loop.verify(target as never, new AbortController().signal)).toMatchObject({ status: 'active', observation: undefined })
  })

  it('does not inject a continuation when cancellation races the fresh observation', async () => {
    const target = subject(), provider = browser(), loop = new BrowserTaskLoop(provider), controller = new AbortController()
    await loop.start(target as never, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, controller.signal)
    provider.execute.mockImplementationOnce(async () => {
      controller.abort()
      return { requestId: 'late', sessionId, installationId: 'extension', outcome: 'observed' as const, delivery: 'sent' as const, value: fresh }
    })
    await loop.turnStopping(target as never, controller.signal)
    expect(target.inject).not.toHaveBeenCalled()
    expect(loop.status(target as never)).toMatchObject({ status: 'cancelled' })
    expect(loop.allowsAction(target as never)).toBe(false)
    await loop.turnStopping(target as never, new AbortController().signal)
    expect(target.inject).not.toHaveBeenCalled()
  })

  it('verifies stable semantic control state from the snapshot result', async () => {
    const target = subject(), provider = browser(), loop = new BrowserTaskLoop(provider)
    provider.execute.mockResolvedValue({ requestId: 'snapshot', sessionId, installationId: 'extension', outcome: 'observed', delivery: 'sent',
      value: { page, text: '已同意', elements: [{ role: 'checkbox', label: '同意条款', state: { checked: true } }] } })
    await loop.start(target as never, { installationId: 'extension', page, goal: '勾选条款', success: { control: { role: 'checkbox', label: '同意条款', checked: true } } }, new AbortController().signal)
    expect(await loop.verify(target as never, new AbortController().signal)).toMatchObject({ status: 'verified' })
  })
})
