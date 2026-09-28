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
import { BrowserTaskLoop } from '../src/loop.ts'
import { browserActionSchema } from '../../browser-extension/src/wire.ts'

const opened = { tabId: 7, windowId: 3, browserSessionId: '123e4567-e89b-42d3-a456-426614174000' }
const page = { tabId: opened.tabId, frameId: 0, documentId: 'opened-document', url: 'https://example.test/opened' }

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(BrowserTaskService)
  const session = ctx.sessions.create(SessionId(`target-free-${Math.random()}`))
  session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '打开并读取页面' }] }), { surfaceOp: 'append' })
  const agent = { id: session.id, options: {}, session, ctx, status: 'idle', inbox: { append() {}, remove() { return false }, nextStep: [] },
    send() {}, followup() {}, steer() {}, inject() {}, cancel() {},
    runMaintenance(fn: (signal: AbortSignal) => unknown) { return fn(new AbortController().signal) },
    whenIdle() { return Promise.resolve() } } as unknown as Agent
  ctx.agents.register(agent)
  const browser = {
    instances: vi.fn(async () => [{ installationId: 'extension', extensionId: 'test', online: true, grantEpoch: 1,
      origins: ['https://example.test'], scopes: ['browser:read', 'browser:write'], capabilities: { protocolVersion: 1 as const,
        actionKinds: ['tab_open', 'snapshot'] as const, requestRecovery: true as const, targetFreeOpen: true as const } }]),
    execute: vi.fn(async (operation: BrowserOperation, _signal: AbortSignal): Promise<BrowserActionResult> => ({
      requestId: operation.requestId,
      sessionId: operation.sessionId, installationId: operation.installationId, outcome: 'observed', delivery: 'sent',
      value: operation.action.kind === 'tab_open' ? { opened: true, tab: opened } : { page, text: '已打开', elements: [] } })),
  }
  return { ctx, agent, browser, loop: new BrowserTaskLoop(browser, ctx.browserTasks) }
}

describe('target-free browser task consumer', () => {
  it('uses one task and two action slots to open, observe, and adopt a fresh tab', async () => {
    const h = await harness()
    await expect(h.loop.startBound(h.agent, { installationId: 'extension', goal: '读取已打开页面', success: { text: '已打开' } }, new AbortController().signal))
      .resolves.toMatchObject({ nextStep: 'open-target-free-tab' })
    const open: BrowserOperation = { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'open',
      action: { kind: 'tab_open', url: page.url } }
    h.loop.planned(h.agent, open)
    h.loop.settle(h.agent, await h.browser.execute(open, new AbortController().signal), open.action)
    expect(h.ctx.browserTasks.get(h.agent)).toMatchObject({ pendingTarget: opened })
    expect(h.ctx.browserTasks.get(h.agent)).not.toHaveProperty('target')
    await expect(h.loop.verify(h.agent, new AbortController().signal)).resolves.toMatchObject({ status: 'verified' })
    expect(h.browser.execute.mock.calls[1]?.[0].action).toMatchObject({ kind: 'snapshot', expectedTab: opened })
    expect(browserActionSchema.safeParse(h.browser.execute.mock.calls[1]?.[0].action).success).toBe(true)
    expect(h.ctx.browserTasks.get(h.agent)?.budget.actionsUsed).toBe(2)
    await h.ctx.fiber.dispose()
  })

  it('does not open another tab after an unknown open result', async () => {
    const h = await harness()
    await h.loop.startBound(h.agent, { installationId: 'extension', goal: '读取页面', success: { text: '已打开' } }, new AbortController().signal)
    const open: BrowserOperation = { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'unknown-open',
      action: { kind: 'tab_open', url: page.url } }
    h.loop.planned(h.agent, open)
    h.loop.settle(h.agent, { requestId: open.requestId, sessionId: open.sessionId, installationId: open.installationId,
      outcome: 'unknown', delivery: 'sent' }, open.action)
    expect(h.loop.allowsAction(h.agent, { kind: 'tab_open', url: 'https://example.test/again' })).toBe(false)
    await h.ctx.fiber.dispose()
  })

  it('does not adopt an opened tab after the user chooses a page', async () => {
    const h = await harness()
    await h.loop.startBound(h.agent, { installationId: 'extension', goal: '读取页面', success: { text: '已打开' } }, new AbortController().signal)
    const open: BrowserOperation = { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'open-user-selection',
      action: { kind: 'tab_open', url: page.url } }
    h.loop.planned(h.agent, open)
    h.loop.settle(h.agent, await h.browser.execute(open, new AbortController().signal), open.action)
    const userPage = { tabId: 11, frameId: 0, documentId: 'user-document', url: 'https://example.test/user' }
    h.ctx.browserTasks.bindTargetByUser(h.agent, { expectedRevision: 0, installationId: 'extension', page: userPage })
    await h.loop.verify(h.agent, new AbortController().signal)
    expect(h.ctx.browserTasks.readTarget(h.agent).binding).toMatchObject({ page: userPage })
    expect(h.ctx.browserTasks.get(h.agent)?.target?.page).not.toEqual(page)
    await h.ctx.fiber.dispose()
  })

  it('rejects old elements after adoption', async () => {
    const h = await harness()
    await h.loop.startBound(h.agent, { installationId: 'extension', goal: '保持未完成', success: { text: '不存在' } }, new AbortController().signal)
    const open: BrowserOperation = { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'open-old-element',
      action: { kind: 'tab_open', url: page.url } }
    h.loop.planned(h.agent, open)
    h.loop.settle(h.agent, await h.browser.execute(open, new AbortController().signal), open.action)
    await h.loop.verify(h.agent, new AbortController().signal)
    const oldPage = { ...page, documentId: 'old-document' }
    expect(() => h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'old-element',
      action: { kind: 'click', element: { page: oldPage, snapshotId: 'old', elementId: 'old' }, intent: '旧元素' } })).toThrow('target mismatch')
    await h.ctx.fiber.dispose()
  })
})
