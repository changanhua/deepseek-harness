import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import BrowserTaskService, { BrowserTaskError } from '../src/index.ts'
import { validateReceipt } from '../src/fold.ts'

const sessionId = '123e4567-e89b-42d3-a456-426614174000'
const opened = { tabId: 7, windowId: 3, browserSessionId: sessionId }
const page = { tabId: 7, frameId: 0, documentId: 'opened-document', url: 'https://example.test/opened' }

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry); await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(BrowserTaskService)
  const session = ctx.sessions.create(SessionId(`bootstrap-${Math.random()}`))
  const source = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '打开一个新标签页' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const agent = { id: session.id, options: {}, session, ctx, status: 'idle',
    inbox: { append() {}, remove() { return false }, nextStep: [] },
    send() {}, followup() {}, steer() {}, inject() {}, cancel() {},
    runMaintenance(fn: (signal: AbortSignal) => unknown) { return fn(new AbortController().signal) },
    whenIdle() { return Promise.resolve() },
  } as unknown as Agent
  ctx.agents.register(agent)
  return { ctx, agent, source }
}

describe('target-free BrowserTask bootstrap', () => {
  it('requires the explicit null-selection revision for a target-free task', async () => {
    const { ctx, agent, source } = await harness()
    expect(() => ctx.browserTasks.create(agent, {
      objective: '打开新页面', sourceSeq: source.seq,
      acceptance: [{ id: 'page', kind: 'url-equals', url: 'https://example.test/' }],
    })).toThrow(BrowserTaskError)
    await ctx.fiber.dispose()
  })

  async function targetFreeTask(maxActions = 40) {
    const h = await harness()
    let task = h.ctx.browserTasks.create(h.agent, { objective: '打开新页面', sourceSeq: h.source.seq,
      targetRevision: 0, maxActions, acceptance: [{ id: 'page', kind: 'url-equals', url: page.url }] })
    task = h.ctx.browserTasks.recordCapability(h.agent, task, { installationId: 'extension', state: 'observed',
      grantEpoch: 1, scopes: ['browser:read', 'browser:write'], actions: ['tab_open', 'snapshot'], protocol: '1', targetFreeOpen: true })
    return { ...h, task }
  }

  it('admits the last planned budget slot once and rejects another URL under that request identity', async () => {
    const h = await targetFreeTask(1)
    try {
      const context = { operation: { requestId: 'last-open', sessionId: h.agent.session.id,
        installationId: 'extension', action: { kind: 'tab_open' as const, url: page.url } },
      phase: 'execute' as const, logicalMutates: true }
      const admit = (input: typeof context) => h.ctx.agents.withInitiator(h.agent, () =>
        h.ctx.waterfall('browser/operation-intent', input, () => ({ kind: 'allow' as const })))
      expect(await admit(context)).toEqual({ kind: 'allow' })
      expect(await admit(context)).toEqual({ kind: 'allow' })
      expect(await admit({ ...context, operation: { ...context.operation, action: { ...context.operation.action, url: 'https://example.test/another' } } }))
        .toMatchObject({ kind: 'deny', result: { reason: 'request_conflict', delivery: 'not-sent' } })
      expect(h.ctx.browserTasks.get(h.agent)?.budget.actionsUsed).toBe(1)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('refuses dispatch when the user clears the selection while the intent is being flushed', async () => {
    const h = await targetFreeTask()
    try {
      const context = { operation: { requestId: 'open-during-clear', sessionId: h.agent.session.id,
        installationId: 'extension', action: { kind: 'tab_open' as const, url: page.url } },
      phase: 'execute' as const, logicalMutates: true }
      await h.ctx.agents.withInitiator(h.agent, () => h.ctx.waterfall('browser/operation-intent', context, () => ({ kind: 'allow' as const })))
      h.ctx.on('session/flush', async () => {
        await Promise.resolve()
        h.ctx.browserTasks.clearTargetByUser(h.agent, 0)
      })
      let dispatched = false
      const decision = await h.ctx.agents.withInitiator(h.agent, () => h.ctx.waterfall('browser/dispatch-intent', {
        ...context, transportRequestId: context.operation.requestId, transportMutates: true, grantEpoch: 1,
      }, () => { dispatched = true; return { kind: 'allow' as const } }))
      expect(decision).toMatchObject({ kind: 'deny', result: { reason: 'browser_target_changed', delivery: 'not-sent' } })
      expect(dispatched).toBe(false)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('treats an observed open without opened:true and an exact UUID tab reference as unknown', async () => {
    const h = await targetFreeTask()
    const task = h.ctx.browserTasks.recordAttempt(h.agent, h.task, { attemptId: 'open', requestId: 'open',
      actionKind: 'tab_open', grantEpoch: 1, stage: 'planned', write: true,
      bootstrap: { kind: 'target-free-open', installationId: 'extension', targetRevision: 0, url: page.url } })
    const settled = h.ctx.browserTasks.settleBootstrapOperation(h.agent, task, { kind: 'result', result: {
      requestId: 'open', sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent',
      value: { tab: opened } } })
    expect(settled.task).toMatchObject({ blockers: ['unknown-attempt'] })
    expect(settled.task).not.toHaveProperty('pendingTarget')
    expect(settled.task.attempts[0]).toMatchObject({ outcome: 'unknown' })
    await h.ctx.fiber.dispose()
  })

  it('can reread after an interrupted snapshot and adopts its exact tab with one evidence item', async () => {
    const h = await targetFreeTask()
    let task = h.ctx.browserTasks.recordAttempt(h.agent, h.task, { attemptId: 'open', requestId: 'open',
      actionKind: 'tab_open', grantEpoch: 1, stage: 'planned', write: true,
      bootstrap: { kind: 'target-free-open', installationId: 'extension', targetRevision: 0, url: page.url } })
    task = h.ctx.browserTasks.settleBootstrapOperation(h.agent, task, { kind: 'result', result: {
      requestId: 'open', sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent',
      value: { opened: true, tab: opened } } }).task
    task = h.ctx.browserTasks.recordAttempt(h.agent, task, { attemptId: 'interrupted', requestId: 'interrupted',
      actionKind: 'snapshot', grantEpoch: 1, stage: 'planned', write: false,
      bootstrap: { kind: 'opened-tab-snapshot', installationId: 'extension', targetRevision: 0, ...opened, openedByRequestId: 'open' } })
    task = h.ctx.browserTasks.settleBootstrapOperation(h.agent, task, { kind: 'result', result: {
      requestId: 'interrupted', sessionId: h.agent.session.id, installationId: 'extension', outcome: 'unknown', delivery: 'sent' } }).task
    task = h.ctx.browserTasks.recordAttempt(h.agent, task, { attemptId: 'snapshot', requestId: 'snapshot',
      actionKind: 'snapshot', grantEpoch: 1, stage: 'planned', write: false,
      bootstrap: { kind: 'opened-tab-snapshot', installationId: 'extension', targetRevision: 0, ...opened, openedByRequestId: 'open' } })
    const settled = h.ctx.browserTasks.settleBootstrapOperation(h.agent, task, { kind: 'result', result: {
      requestId: 'snapshot', sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent',
      value: { page, text: 'opened' } } })
    expect(settled).toMatchObject({ evidenceRecorded: true, task: { target: { installationId: 'extension', page } } })
    expect(settled.task).not.toHaveProperty('pendingTarget')
    expect(settled.task.evidence).toHaveLength(1)
    expect(settled.task.budget.actionsUsed).toBe(0)
    const duplicate = h.ctx.browserTasks.settleBootstrapOperation(h.agent, settled.task, { kind: 'result', result: {
      requestId: 'snapshot', sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent',
      value: { page, text: 'opened' } } })
    expect(duplicate).toMatchObject({ disposition: 'unchanged', evidenceRecorded: true, receipt: settled.receipt })
    expect(duplicate.task.evidence).toHaveLength(1)
    await h.ctx.fiber.dispose()
  })

  it('keeps the opened history but blocks reuse after the exact tab reference is stale', async () => {
    const h = await targetFreeTask()
    let task = h.ctx.browserTasks.recordAttempt(h.agent, h.task, { attemptId: 'open', requestId: 'open',
      actionKind: 'tab_open', grantEpoch: 1, stage: 'planned', write: true,
      bootstrap: { kind: 'target-free-open', installationId: 'extension', targetRevision: 0, url: page.url } })
    task = h.ctx.browserTasks.settleBootstrapOperation(h.agent, task, { kind: 'result', result: {
      requestId: 'open', sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent',
      value: { opened: true, tab: opened } } }).task
    task = h.ctx.browserTasks.recordAttempt(h.agent, task, { attemptId: 'snapshot', requestId: 'snapshot',
      actionKind: 'snapshot', grantEpoch: 1, stage: 'planned', write: false,
      bootstrap: { kind: 'opened-tab-snapshot', installationId: 'extension', targetRevision: 0, ...opened, openedByRequestId: 'open' } })
    const settled = h.ctx.browserTasks.settleBootstrapOperation(h.agent, task, { kind: 'result', result: {
      requestId: 'snapshot', sessionId: h.agent.session.id, installationId: 'extension', outcome: 'failed', delivery: 'sent', reason: 'tab_reference_stale' } })
    expect(settled.task).toMatchObject({ pendingTarget: opened, blockers: ['target-lost'] })
    await h.ctx.fiber.dispose()
  })

  it('reconciles an unknown open once, clears its write blocker, and keeps the settled retry idempotent', async () => {
    const h = await targetFreeTask()
    let task = h.ctx.browserTasks.recordAttempt(h.agent, h.task, { attemptId: 'open', requestId: 'open',
      actionKind: 'tab_open', grantEpoch: 1, stage: 'planned', write: true,
      bootstrap: { kind: 'target-free-open', installationId: 'extension', targetRevision: 0, url: page.url } })
    task = h.ctx.browserTasks.settleBootstrapOperation(h.agent, task, { kind: 'result', result: {
      requestId: 'open', sessionId: h.agent.session.id, installationId: 'extension', outcome: 'unknown', delivery: 'sent' } }).task
    expect(h.ctx.browserTasks.settleBootstrapOperation(h.agent, task, { kind: 'recovery', status: {
      requestId: 'open', sessionId: h.agent.session.id, installationId: 'extension', outcome: 'unknown', delivery: 'sent', quiescent: true } }))
      .toMatchObject({ disposition: 'unchanged', task: { blockers: ['unknown-attempt'] } })
    const recovered = h.ctx.browserTasks.settleBootstrapOperation(h.agent, task, { kind: 'recovery', status: {
      requestId: 'open', sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent',
      quiescent: true, value: { opened: true, tab: opened } } })
    expect(recovered.task).toMatchObject({ pendingTarget: opened, blockers: [] })
    const unchanged = h.ctx.browserTasks.settleBootstrapOperation(h.agent, recovered.task, { kind: 'recovery', status: {
      requestId: 'open', sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent',
      quiescent: true, value: { opened: true, tab: opened } } })
    expect(unchanged).toMatchObject({ disposition: 'unchanged', evidenceRecorded: false })
    await h.ctx.fiber.dispose()
  })

  it('rejects malformed v2 receipt observations instead of accepting a synthetic page authority', () => {
    expect(() => validateReceipt({ kind: 'browser-task/receipt', version: 2, taskId: 'task', requestId: 'open',
      actionKind: 'tab_open', bootstrap: { kind: 'target-free-open', installationId: 'extension', targetRevision: 0, url: page.url },
      observation: { kind: 'opened-tab', tab: { ...opened, browserSessionId: 'not-a-uuid' } }, outcome: 'observed',
      delivery: 'sent', quiescent: true, grantEpoch: 1 })).toThrow('receipt opened-tab invalid')
  })
})
