import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import BrowserTaskService from '../src/index.ts'

const pageA = { tabId: 11, frameId: 0, documentId: 'doc-a', url: 'https://example.test/a' }
const pageB = { tabId: 12, frameId: 0, documentId: 'doc-b', url: 'https://example.test/b' }

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(BrowserTaskService)
  const session = ctx.sessions.create(SessionId(`target-${Math.random()}`))
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '固定页面 A' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const agent = {
    id: session.id, options: {}, session, ctx, status: 'idle',
    inbox: { append() {}, remove() { return false }, nextStep: [] },
    send() {}, followup() {}, steer() {}, inject() {}, cancel() {},
    runMaintenance(fn: (signal: AbortSignal) => unknown) { return fn(new AbortController().signal) },
    whenIdle() { return Promise.resolve() },
  } as unknown as Agent
  ctx.agents.register(agent)
  return { ctx, agent, session }
}

describe('Session-owned browser target binding', () => {
  it('publishes the fixed target as the sole meaning of current page in model context', async () => {
    const { ctx, agent } = await harness()
    ctx.browserTasks.bindTargetByUser(agent, {
      expectedRevision: 0, installationId: 'chrome-a', page: pageA,
    })
    const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent })
    const target = assembly.contexts.find(context => context.name === 'browser:target')?.text
    expect(target).toContain('The user fixed the browser target for this Session')
    expect(target).toContain('"installationId":"chrome-a"')
    expect(target).toContain('"tabId":11')
    expect(target).toContain('"url":"https://example.test/a"')
    expect(target).toContain('Never choose another tab from active flags')
    await ctx.fiber.dispose()
  })

  it('does not promote a task-local target into an implicit Session binding', async () => {
    const { ctx, agent } = await harness()
    ctx.browserTasks.create(agent, { objective: 'legacy direct task', sourceSeq: 0,
      target: { installationId: 'chrome-a', page: pageA },
      acceptance: [{ id: 'url', kind: 'url-equals', url: pageA.url }] })
    const context = { operation: { sessionId: agent.session.id, installationId: 'chrome-a',
      requestId: 'legacy-target', action: { kind: 'page_map' as const, page: pageA } },
    phase: 'execute' as const, logicalMutates: false }
    expect(await ctx.agents.withInitiator(agent, () => ctx.waterfall(
      'browser/operation-intent', context, () => ({ kind: 'allow' as const }),
    ))).toMatchObject({
      kind: 'deny', result: { delivery: 'not-sent', reason: 'browser_target_unbound' },
    })
    expect(ctx.browserTasks.readTarget(agent)).toEqual({ revision: 0, binding: null })
    await ctx.fiber.dispose()
  })

  it('persists only an explicit user binding with a monotonic revision', async () => {
    const { ctx, agent, session } = await harness()
    const first = ctx.browserTasks.bindTargetByUser(agent, {
      expectedRevision: 0, installationId: 'chrome-a', page: pageA,
    })
    expect(first).toMatchObject({
      revision: 1, installationId: 'chrome-a', page: pageA, boundBy: 'user',
    })
    expect(typeof first.boundAt).toBe('number')
    expect(ctx.browserTasks.readTarget(agent)).toEqual({ revision: 1, binding: first })
    const before = session.snapshotEvents().length
    expect(() => ctx.browserTasks.bindTargetByUser(agent, {
      expectedRevision: 0, installationId: 'chrome-a', page: pageB,
    })).toThrow('browser target revision changed')
    expect(session.snapshotEvents()).toHaveLength(before)
    expect(ctx.browserTasks.clearTargetByUser(agent, 1)).toEqual({ revision: 2, binding: null })
    expect(ctx.browserTasks.readTarget(agent)).toEqual({ revision: 2, binding: null })
    await ctx.fiber.dispose()
  })

  it('rejects another tab and a binding switch before dispatch without redirecting the request', async () => {
    const { ctx, agent } = await harness()
    ctx.browserTasks.bindTargetByUser(agent, {
      expectedRevision: 0, installationId: 'chrome-a', page: pageA,
    })
    const next = vi.fn(() => ({ kind: 'allow' as const }))
    const wrong = {
      operation: { sessionId: agent.session.id, installationId: 'chrome-a', requestId: 'wrong-tab',
        action: { kind: 'page_map' as const, page: pageB } },
      phase: 'execute' as const, logicalMutates: false,
    }
    expect(await ctx.agents.withInitiator(agent, () => ctx.waterfall(
      'browser/operation-intent', wrong, next,
    ))).toMatchObject({ kind: 'deny', result: { delivery: 'not-sent', reason: 'browser_target_mismatch' } })
    expect(next).not.toHaveBeenCalled()

    const exact = {
      operation: { sessionId: agent.session.id, installationId: 'chrome-a', requestId: 'captured-a',
        action: { kind: 'page_map' as const, page: pageA } },
      phase: 'execute' as const, logicalMutates: false,
    }
    expect(await ctx.agents.withInitiator(agent, () => ctx.waterfall(
      'browser/operation-intent', exact, next,
    ))).toEqual({ kind: 'allow' })
    ctx.browserTasks.bindTargetByUser(agent, {
      expectedRevision: 1, installationId: 'chrome-a', page: pageB,
    })
    expect(await ctx.agents.withInitiator(agent, () => ctx.waterfall('browser/dispatch-intent', {
      ...exact, transportRequestId: exact.operation.requestId, transportMutates: false, grantEpoch: 1,
    }, next))).toMatchObject({
      kind: 'deny', result: { delivery: 'not-sent', reason: 'browser_target_changed' },
    })
    expect(ctx.browserTasks.readTarget(agent)).toMatchObject({ revision: 2, binding: { page: pageB } })
    await ctx.fiber.dispose()
  })

  it('keeps the selected tab across navigation while refusing another tab', async () => {
    const { ctx, agent } = await harness()
    ctx.browserTasks.bindTargetByUser(agent, {
      expectedRevision: 0, installationId: 'chrome-a', page: pageA,
    })
    const allow = () => ({ kind: 'allow' as const })
    const currentSnapshot = { operation: { sessionId: agent.session.id, installationId: 'chrome-a',
      requestId: 'current-document', action: { kind: 'snapshot' as const, tabId: pageA.tabId, frameId: 0 } },
    phase: 'execute' as const, logicalMutates: false }
    await expect(ctx.agents.withInitiator(agent, () => ctx.waterfall(
      'browser/operation-intent', currentSnapshot, allow,
    ))).resolves.toEqual({ kind: 'allow' })
    const navigated = { ...pageA, documentId: 'doc-a-next', url: 'https://example.test/a-next' }
    await expect(ctx.agents.withInitiator(agent, () => ctx.waterfall('browser/operation-intent', {
      operation: { ...currentSnapshot.operation, requestId: 'navigated-page',
        action: { kind: 'page_map' as const, page: navigated } },
      phase: 'execute' as const, logicalMutates: false,
    }, allow))).resolves.toEqual({ kind: 'allow' })
    await expect(ctx.agents.withInitiator(agent, () => ctx.waterfall('browser/operation-intent', {
      operation: { ...currentSnapshot.operation, requestId: 'other-tab',
        action: { kind: 'snapshot' as const, tabId: pageB.tabId, frameId: 0 } },
      phase: 'execute' as const, logicalMutates: false,
    }, allow))).resolves.toMatchObject({
      kind: 'deny', result: { delivery: 'not-sent', reason: 'browser_target_mismatch' },
    })
    expect(ctx.browserTasks.readTarget(agent)).toMatchObject({ revision: 1, binding: { page: pageA } })
    await ctx.fiber.dispose()
  })
})
