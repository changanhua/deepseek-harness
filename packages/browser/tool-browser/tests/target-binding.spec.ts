import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { BrowserActionResult, BrowserOperation } from '@changanhua/dsh-browser'
import BrowserTaskService from '@changanhua/dsh-browser-task'
import { dispatchWithFeedback } from '../src/index.ts'
import { BrowserTaskLoop } from '../src/loop.ts'

const pageA = { tabId: 4, frameId: 0, documentId: 'doc-a', url: 'https://example.test/a' }
const pageB = { tabId: 8, frameId: 0, documentId: 'doc-b', url: 'https://example.test/b' }
const navigatedPageA = { ...pageA, documentId: 'doc-a-next', url: 'https://example.test/a-next' }

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(BrowserTaskService)
  const session = ctx.sessions.create(SessionId(`bound-loop-${Math.random()}`))
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '只处理固定页面' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const agent = {
    id: session.id, options: {}, session, ctx, status: 'idle',
    inbox: { append() {}, remove() { return false }, nextStep: [] },
    send() {}, followup() {}, steer() {}, inject() {}, cancel() {},
    runMaintenance(fn: (signal: AbortSignal) => unknown) { return fn(new AbortController().signal) },
    whenIdle() { return Promise.resolve() },
  } as unknown as Agent
  ctx.agents.register(agent)
  const instance = { installationId: 'chrome-a', extensionId: 'test', online: true, grantEpoch: 1,
    origins: ['https://example.test'], scopes: ['browser:read'], capabilities: {
      protocolVersion: 1 as const, actionKinds: ['snapshot'] as const, requestRecovery: true as const,
    } }
  const browser = {
    instances: vi.fn(async () => [instance]),
    execute: vi.fn(async (operation: BrowserOperation): Promise<BrowserActionResult> => ({
      requestId: operation.requestId, sessionId: operation.sessionId, installationId: operation.installationId,
      outcome: 'observed', delivery: 'sent', value: { page: pageA, text: 'fixed A', elements: [] },
    })),
  }
  return { ctx, agent, browser, loop: new BrowserTaskLoop(browser, ctx.browserTasks) }
}

describe('tool-browser target capture', () => {
  it.each([
    ['another tab', pageB],
    ['another frame', { ...pageA, frameId: 1, documentId: 'doc-a-frame' }],
  ])('filters feedback from %s without changing the snapshot request contract', async (_label, replacementPage) => {
    const action = { kind: 'click' as const,
      element: { page: pageA, snapshotId: 'snapshot-a', elementId: 'button-a' }, intent: 'expand' }
    const operation = { sessionId: SessionId('feedback-session'), installationId: 'chrome-a',
      requestId: '11111111-1111-4111-8111-111111111111', action }
    const browser = {
      prepare: vi.fn(async () => ({ ticket: 'ticket' as never, expiresAt: Date.now() + 1_000,
        description: { kind: 'click' as const, page: pageA, title: 'A', effect: 'local-disclosure' as const } })),
      executePrepared: vi.fn(async (): Promise<BrowserActionResult> => ({
        requestId: operation.requestId, sessionId: operation.sessionId, installationId: operation.installationId,
        outcome: 'observed', delivery: 'sent', value: { clicked: true },
      })),
      execute: vi.fn(async (feedback: BrowserOperation): Promise<BrowserActionResult> => ({
        requestId: feedback.requestId, sessionId: feedback.sessionId, installationId: feedback.installationId,
        outcome: 'observed', delivery: 'sent', value: { page: replacementPage, text: 'must not leak' },
      })),
    }
    const result = await dispatchWithFeedback({ browser, operation, agent: {} as Agent, callId: undefined,
      signal: new AbortController().signal, approval: vi.fn(async () => 'allowed-once') })
    expect(browser.execute).toHaveBeenCalledOnce()
    expect(browser.execute.mock.calls[0]?.[0].action).toEqual({
      kind: 'snapshot', tabId: pageA.tabId, frameId: pageA.frameId, limit: 64, textLimit: 4000, structure: false,
    })
    expect(result).toMatchObject({ value: { feedback: { status: 'unavailable' } } })
    expect(JSON.stringify(result)).not.toContain('must not leak')
  })

  it('filters feedback returned under another installation even when the page identity matches', async () => {
    const operation = { sessionId: SessionId('feedback-installation'), installationId: 'chrome-a',
      requestId: '22222222-2222-4222-8222-222222222222', action: { kind: 'click' as const,
        element: { page: pageA, snapshotId: 'snapshot-a', elementId: 'button-a' }, intent: 'expand' } }
    const browser = {
      prepare: vi.fn(async () => ({ ticket: 'ticket' as never, expiresAt: Date.now() + 1_000,
        description: { kind: 'click' as const, page: pageA, title: 'A', effect: 'local-disclosure' as const } })),
      executePrepared: vi.fn(async (): Promise<BrowserActionResult> => ({
        requestId: operation.requestId, sessionId: operation.sessionId, installationId: operation.installationId,
        outcome: 'observed', delivery: 'sent', value: { clicked: true },
      })),
      execute: vi.fn(async (feedback: BrowserOperation): Promise<BrowserActionResult> => ({
        requestId: feedback.requestId, sessionId: feedback.sessionId, installationId: 'chrome-b',
        outcome: 'observed', delivery: 'sent', value: { page: pageA, text: 'must not leak' },
      })),
    }
    const result = await dispatchWithFeedback({ browser, operation, agent: {} as Agent, callId: undefined,
      signal: new AbortController().signal, approval: vi.fn(async () => 'allowed-once') })
    expect(result).toMatchObject({ value: { feedback: { status: 'unavailable' } } })
    expect(JSON.stringify(result)).not.toContain('must not leak')
  })

  it.each([
    { label: 'click navigation', action: { kind: 'click' as const,
      element: { page: pageA, snapshotId: 'snapshot-a', elementId: 'link-a' }, intent: 'open' },
    expectedTarget: pageA, expectedTargetLost: true },
    { label: 'explicit navigation', action: { kind: 'navigate' as const, page: pageA, url: navigatedPageA.url },
      expectedTarget: navigatedPageA, expectedTargetLost: false },
  ])('exposes a same-tab new document after $label without replaying or transferring resources', async ({
    action, expectedTarget, expectedTargetLost,
  }) => {
    const { ctx, agent, loop } = await harness()
    await loop.start(agent, { installationId: 'chrome-a', page: pageA, goal: 'observe navigation',
      success: { text: 'destination' } }, new AbortController().signal)
    let task = ctx.browserTasks.get(agent)!
    task = ctx.browserTasks.upsertResource(agent, task, { id: 'old-panel', state: 'reserved',
      target: { installationId: 'chrome-a', page: pageA } })
    ctx.browserTasks.upsertResource(agent, task, { id: 'old-panel', state: 'active',
      target: { installationId: 'chrome-a', page: pageA } })
    const operation = { sessionId: agent.session.id, installationId: 'chrome-a',
      requestId: `navigation-${action.kind}`, action }
    loop.planned(agent, operation)
    const browser = {
      prepare: vi.fn(async () => ({ ticket: 'ticket' as never, expiresAt: Date.now() + 1_000,
        description: { kind: action.kind, page: pageA, title: 'A', effect: 'navigation' as const } })),
      executePrepared: vi.fn(async (): Promise<BrowserActionResult> => ({
        requestId: operation.requestId, sessionId: operation.sessionId, installationId: operation.installationId,
        outcome: 'observed', delivery: 'sent', value: { acknowledged: true },
      })),
      execute: vi.fn(async (feedback: BrowserOperation): Promise<BrowserActionResult> => ({
        requestId: feedback.requestId, sessionId: feedback.sessionId, installationId: feedback.installationId,
        outcome: 'observed', delivery: 'sent', value: { page: navigatedPageA, text: 'destination' },
      })),
    }
    const result = await dispatchWithFeedback({ browser, operation, agent, callId: undefined,
      signal: new AbortController().signal, approval: vi.fn(async () => 'allowed-once'),
      lifecycle: { prepared: () => { loop.prepared(agent, operation.requestId) } } })
    expect(result).toMatchObject({ outcome: 'observed', value: { feedback: {
      status: 'observed', snapshot: { page: navigatedPageA, text: 'destination' },
    } } })
    loop.settle(agent, result, action)
    const settled = ctx.browserTasks.get(agent)!
    expect(settled.target?.page).toEqual(expectedTarget)
    expect(settled.blockers.includes('target-lost')).toBe(expectedTargetLost)
    expect(settled.resources).toEqual([expect.objectContaining({ id: 'old-panel', state: 'active',
      target: { installationId: 'chrome-a', page: pageA } })])
    expect(browser.executePrepared).toHaveBeenCalledOnce()
    expect(browser.execute).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('copies the Session binding into a task and rejects model-supplied replacement target', async () => {
    const { ctx, agent, loop } = await harness()
    ctx.browserTasks.bindTargetByUser(agent, {
      expectedRevision: 0, installationId: 'chrome-a', page: pageA,
    })
    await expect(loop.startBound(agent, {
      installationId: 'chrome-a', page: pageB, goal: '读取固定页面', success: { text: 'fixed A' },
    }, new AbortController().signal)).rejects.toThrow('browser target selection changed')
    await loop.startBound(agent, {
      installationId: 'chrome-a', page: pageA, goal: '读取固定页面', success: { text: 'fixed A' },
    }, new AbortController().signal)
    expect(ctx.browserTasks.get(agent)).toMatchObject({
      target: { installationId: 'chrome-a', page: pageA }, targetRevision: 1,
    })
    await ctx.fiber.dispose()
  })

  it('starts on a fresh document in the selected tab and rejects old elements and another tab', async () => {
    const { ctx, agent, browser, loop } = await harness()
    ctx.browserTasks.bindTargetByUser(agent, {
      expectedRevision: 0, installationId: 'chrome-a', page: pageA,
    })
    await expect(loop.startBound(agent, {
      installationId: 'chrome-a', page: pageB, goal: 'wrong tab', success: { text: 'fixed A' },
    }, new AbortController().signal)).rejects.toThrow('browser target selection changed')
    browser.execute.mockImplementationOnce(async (operation: BrowserOperation) => ({
      requestId: operation.requestId, sessionId: operation.sessionId,
      installationId: operation.installationId, outcome: 'observed' as const, delivery: 'sent' as const,
      value: { page: navigatedPageA, text: 'fixed A', elements: [] },
    }))
    await loop.startBound(agent, {
      installationId: 'chrome-a', page: navigatedPageA, goal: 'fresh document', success: { text: 'fixed A' },
    }, new AbortController().signal)
    expect(ctx.browserTasks.get(agent)).toMatchObject({ target: { installationId: 'chrome-a', page: navigatedPageA } })
    expect(() => loop.planned(agent, { sessionId: agent.session.id, installationId: 'chrome-a',
      requestId: 'old-element', action: { kind: 'click',
        element: { page: pageA, snapshotId: 'old-snapshot', elementId: 'old-button' }, intent: 'old' } })).toThrow('target mismatch')
    await ctx.fiber.dispose()
  })
})
