import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import BrowserTaskService from '../src/index.ts'
import { BrowserTaskError, browserTaskProjectionDefinition, type BrowserTaskSnapshot } from '../src/index.ts'
import { validateCheckpointFacts, validateReceipt } from '../src/fold.ts'

const browserSessionId = '123e4567-e89b-42d3-a456-426614174000'
const pageA = { tabId: 1, frameId: 0, documentId: 'a', url: 'https://example.test/a' }
const tabB = { tabId: 2, windowId: 3, browserSessionId }
const pageB = { tabId: 2, frameId: 0, documentId: 'b', url: 'https://example.test/b' }

async function baseHarness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry); await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(BrowserTaskService)
  const session = ctx.sessions.create(SessionId(`scope-${Math.random()}`))
  const source = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '选择页面' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const agent = { id: session.id, options: {}, session, ctx, status: 'idle', inbox: { append() {}, remove() { return false }, nextStep: [] }, send() {}, followup() {}, steer() {}, inject() {}, cancel() {}, runMaintenance(fn: (signal: AbortSignal) => unknown) { return fn(new AbortController().signal) }, whenIdle() { return Promise.resolve() } } as unknown as Agent
  ctx.agents.register(agent)
  ctx.browserTasks.bindTargetByUser(agent, { expectedRevision: 0, installationId: 'extension', page: pageA })
  return { ctx, agent, source }
}

async function harness() {
  const { ctx, agent, source } = await baseHarness()
  let task = ctx.browserTasks.create(agent, { objective: '多页读取', sourceSeq: source.seq, target: { installationId: 'extension', page: pageA }, targetRevision: 1, scope: { kind: 'explicit-set', tabs: [{ tabId: 1, windowId: 3, browserSessionId }, tabB] }, acceptance: [{ id: 'url', kind: 'url-equals', url: pageA.url }] })
  task = ctx.browserTasks.recordCapability(agent, task, { installationId: 'extension', state: 'observed', grantEpoch: 1, scopes: ['browser:read'], actions: ['snapshot'], protocol: '1' })
  return { ctx, agent, task, source }
}

async function descendantReady(outcome: 'observed' | 'unknown' | 'failed' = 'observed') {
  const h = await baseHarness()
  const root = { tabId: 1, windowId: 3, browserSessionId }
  const target = { installationId: 'extension', page: pageA }
  let task = h.ctx.browserTasks.create(h.agent, { objective: 'Follow child pages', sourceSeq: h.source.seq, target,
    targetRevision: 1, scope: { kind: 'descendants', root }, acceptance: [{ id: 'url', kind: 'url-equals', url: pageB.url }] })
  task = h.ctx.browserTasks.recordCapability(h.agent, task, { installationId: 'extension', state: 'observed', grantEpoch: 1,
    scopes: ['browser:read', 'browser:write'], actions: ['snapshot', 'click'], protocol: '1' })
  const attempt = { attemptId: 'open-child', requestId: 'open-child', actionKind: 'click', target, write: true, grantEpoch: 1 }
  task = h.ctx.browserTasks.recordAttempt(h.agent, task, { ...attempt, stage: 'planned' })
  task = h.ctx.browserTasks.advanceAttempt(h.agent, task, { ...attempt, stage: 'dispatched' })
  const receipt = h.ctx.browserTasks.recordReceipt(h.agent, task, { requestId: attempt.requestId, actionKind: 'click', target,
    outcome, delivery: 'sent', quiescent: outcome !== 'unknown', grantEpoch: 1, transition: {
      version: 1, source: { tab: root, page: pageA }, startedAt: 1, observedAt: 2, sameTab: { kind: 'unchanged', page: pageA },
      candidates: [{ tab: tabB, relation: 'opener', attribution: 'candidate', evidence: 'created-navigation-target' }], truncated: false,
    } })
  task = h.ctx.browserTasks.advanceAttempt(h.agent, task, { ...attempt, stage: 'settled', outcome,
    quiescent: outcome !== 'unknown', settledBy: receipt })
  return { ...h, task, root, receipt }
}

describe('BrowserTask scope selection', () => {
  it('admits a witnessed child, returns to the root, and revisits the admitted member with replay proof', async () => {
    const h = await descendantReady()
    try {
      let task = h.task
      for (const [requestId, tab, page] of [['child', tabB, pageB], ['root', h.root, pageA], ['revisit', tabB, pageB]] as const) {
        const planned = h.ctx.browserTasks.selectTarget(h.agent, task, { requestId, installationId: 'extension', tab })
        task = h.ctx.browserTasks.settleSelectionOperation(h.agent, planned.task, { kind: 'result', result: {
          requestId, sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent', value: { page, tab },
        } }).task
      }
      expect(task).toMatchObject({ target: { page: pageB }, scope: { kind: 'descendants', root: h.root,
        members: [{ tab: tabB, admittedBy: { kind: 'browser-task-receipt' } }] }, budget: { actionsUsed: 3 } })
      expect(task.attempts).toHaveLength(4)
      const checkpoint = h.ctx.sessionProjections.stateOf(h.agent.session, 'browserTask')!
      expect(browserTaskProjectionDefinition.stateSchema.safeParse(checkpoint).success).toBe(true)
      const corrupted = structuredClone(checkpoint)
      const admission = corrupted.sourceFacts.find(item => item.selection?.eligibility.kind === 'descendant-candidate')!
      const attempt = corrupted.current!.attempts.find(item => item.requestId === admission.requestId)!
      if (admission.selection?.eligibility.kind !== 'descendant-candidate' || attempt.selection === undefined) throw new Error('candidate missing')
      Reflect.set(admission.selection.eligibility, 'candidateReceipt', { kind: 'browser-task-receipt', sessionSeq: 0 })
      Reflect.set(attempt, 'selection', admission.selection)
      expect(browserTaskProjectionDefinition.stateSchema.safeParse(corrupted).success).toBe(false)
    } finally { await h.ctx.fiber.dispose() }
  })

  it.each(['unknown', 'failed'] as const)('does not derive child admission from a %s input', async (outcome) => {
    const h = await descendantReady(outcome)
    try {
      expect(() => h.ctx.browserTasks.selectTarget(h.agent, h.task, { requestId: 'child', installationId: 'extension', tab: tabB }))
        .toThrow(BrowserTaskError)
      expect(h.ctx.browserTasks.get(h.agent)?.budget.actionsUsed).toBe(0)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('retains an unknown read outcome while a terminal recovery releases its selection fence', async () => {
    const h = await harness()
    try {
      const planned = h.ctx.browserTasks.selectTarget(h.agent, h.task, { requestId: 'lost-read', installationId: 'extension', tab: tabB })
      const result = { requestId: 'lost-read', sessionId: h.agent.session.id, installationId: 'extension', outcome: 'unknown' as const,
        delivery: 'sent' as const, reason: 'read_unavailable' }
      let task = h.ctx.browserTasks.settleSelectionOperation(h.agent, planned.task, { kind: 'result', result }).task
      task = h.ctx.browserTasks.settleSelectionOperation(h.agent, task, { kind: 'recovery', status: { ...result, quiescent: true } }).task
      expect(task.attempts[0]).toMatchObject({ outcome: 'unknown', quiescent: true })
      expect(task.target?.page).toEqual(pageA)
      const late = h.ctx.browserTasks.settleSelectionOperation(h.agent, task, { kind: 'recovery', status: {
        ...result, outcome: 'observed', quiescent: true, value: { page: pageB, tab: tabB },
      } })
      expect(late).toMatchObject({ disposition: 'unchanged', evidenceRecorded: false, task: { revision: task.revision } })
      expect(late.task.attempts[0]).toMatchObject({ outcome: 'unknown', quiescent: true })
      expect(h.ctx.browserTasks.selectTarget(h.agent, task, { requestId: 'fresh-read', installationId: 'extension', tab: tabB }).task.budget.actionsUsed)
        .toBe(2)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('cannot use a different lease to dispatch or settle an already planned cleanup request', async () => {
    const h = await harness()
    try {
      let task = h.task
      const target = { installationId: 'extension', page: pageA }
      for (const id of ['panel-a', 'panel-b']) {
        task = h.ctx.browserTasks.upsertResource(h.agent, task, { id, target, state: 'reserved' })
        task = h.ctx.browserTasks.upsertResource(h.agent, task, { id, target, state: 'active' })
      }
      task = h.ctx.browserTasks.recordAttempt(h.agent, task, { attemptId: 'clear-a', requestId: 'clear-a', actionKind: 'region_clear',
        target, resourceId: 'panel-a', stage: 'planned', write: true, grantEpoch: 1 })
      const context = { operation: { requestId: 'clear-a', sessionId: h.agent.session.id, installationId: 'extension',
        action: { kind: 'region_clear' as const, page: pageA, mountId: 'panel-b' } }, phase: 'execute' as const, logicalMutates: true }
      const denied = await h.ctx.agents.withInitiator(h.agent, () => h.ctx.waterfall('browser/operation-intent', context,
        () => ({ kind: 'allow' as const })))
      expect(denied).toMatchObject({ kind: 'deny', result: { reason: 'request_conflict' } })
      await h.ctx.agents.withInitiator(h.agent, () => h.ctx.parallel('browser/operation-settled', context, { kind: 'result',
        result: { requestId: 'clear-a', sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent',
          value: { cleared: true } } }))
      expect(h.ctx.browserTasks.get(h.agent)?.attempts[0]).toMatchObject({ resourceId: 'panel-a', stage: 'planned' })
      expect(h.ctx.browserTasks.get(h.agent)?.resources.map(item => item.state)).toEqual(['active', 'active'])
    } finally { await h.ctx.fiber.dispose() }
  })

  it('admits only the planned mount that owns its unfinished reservation', async () => {
    const h = await harness()
    try {
      const target = { installationId: 'extension', page: pageA }
      let task = h.ctx.browserTasks.recordAttempt(h.agent, h.task, { attemptId: 'mount', requestId: 'mount', actionKind: 'entry_mount',
        resourceId: 'panel', target, stage: 'planned', write: true, grantEpoch: 1 })
      task = h.ctx.browserTasks.upsertResource(h.agent, task, { id: 'panel', target, state: 'reserved' })
      expect(task.blockers).toEqual(['cleanup'])
      const context = { operation: { requestId: 'mount', sessionId: h.agent.session.id, installationId: 'extension',
        action: { kind: 'entry_mount' as const, page: pageA, mountId: 'panel', selector: 'article', label: 'Save' } },
      phase: 'execute' as const, logicalMutates: true }
      const admit = (input: typeof context) => h.ctx.agents.withInitiator(h.agent, () => h.ctx.waterfall('browser/operation-intent', input,
        () => ({ kind: 'allow' as const })))
      expect(await admit(context)).toEqual({ kind: 'allow' })
      expect(await admit({ ...context, operation: { ...context.operation, action: { ...context.operation.action, mountId: 'unreserved' } } }))
        .toMatchObject({ kind: 'deny', result: { delivery: 'not-sent' } })
    } finally { await h.ctx.fiber.dispose() }
  })

  it('plans one exact scoped snapshot and adopts only its complete returned tab', async () => {
    const h = await harness()
    try {
      const planned = h.ctx.browserTasks.selectTarget(h.agent, h.task, { requestId: 'select-b', installationId: 'extension', tab: tabB })
      expect(planned.action).toEqual({ kind: 'snapshot', tabId: 2, frameId: 0, expectedTab: tabB })
      expect(planned.task.budget.actionsUsed).toBe(1)
      expect(planned.task.attempts[0]).toMatchObject({ selection: { tab: tabB } })
      const settled = h.ctx.browserTasks.settleSelectionOperation(h.agent, planned.task, { kind: 'result', result: { requestId: 'select-b', sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent', value: { page: pageB, tab: tabB } } })
      expect(settled).toMatchObject({ evidenceRecorded: true, task: { target: { installationId: 'extension', page: pageB } } })
      expect(settled.task.evidence[0]).toMatchObject({ state: 'current', target: { page: pageB } })
    } finally { await h.ctx.fiber.dispose() }
  })

  it('does not adopt a page when the observation omits the complete tab reference', async () => {
    const h = await harness()
    try {
      const planned = h.ctx.browserTasks.selectTarget(h.agent, h.task, { requestId: 'select-incomplete', installationId: 'extension', tab: tabB })
      const settled = h.ctx.browserTasks.settleSelectionOperation(h.agent, planned.task, { kind: 'result', result: { requestId: 'select-incomplete', sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent', value: { page: pageB } } })
      expect(settled.task.target).toEqual({ installationId: 'extension', page: pageA })
      expect(settled.task.attempts[0]).toMatchObject({ outcome: 'unknown' })
    } finally { await h.ctx.fiber.dispose() }
  })

  it('rejects a changed tab under one request identity without consuming another action', async () => {
    const h = await harness()
    try {
      const planned = h.ctx.browserTasks.selectTarget(h.agent, h.task, { requestId: 'same-id', installationId: 'extension', tab: tabB })
      expect(() => h.ctx.browserTasks.selectTarget(h.agent, planned.task, { requestId: 'same-id', installationId: 'extension', tab: { ...tabB, tabId: 1 } })).toThrow(BrowserTaskError)
      expect(h.ctx.browserTasks.get(h.agent)?.budget.actionsUsed).toBe(1)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('holds both another selection and a normal write behind an unsettled selection', async () => {
    const h = await harness()
    try {
      const planned = h.ctx.browserTasks.selectTarget(h.agent, h.task, { requestId: 'in-flight', installationId: 'extension', tab: tabB })
      expect(() => h.ctx.browserTasks.selectTarget(h.agent, planned.task, { requestId: 'other', installationId: 'extension', tab: { tabId: 1, windowId: 3, browserSessionId } })).toThrow(BrowserTaskError)
      const context = { operation: { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'write-after-select', action: { kind: 'click' as const, element: { page: pageA, snapshotId: 'snapshot', elementId: 'go' }, intent: 'test blocked write' } }, phase: 'execute' as const, logicalMutates: true }
      await expect(h.ctx.agents.withInitiator(h.agent, () => h.ctx.waterfall('browser/operation-intent', context, () => ({ kind: 'allow' as const })))).resolves.toMatchObject({ kind: 'deny' })
    } finally { await h.ctx.fiber.dispose() }
  })

  it.each([
    ['window', { ...tabB, windowId: 99 }],
    ['browser session', { ...tabB, browserSessionId: '223e4567-e89b-42d3-a456-426614174000' }],
  ])('does not adopt a snapshot with the wrong %s identity', async (_label, returnedTab) => {
    const h = await harness()
    try {
      const planned = h.ctx.browserTasks.selectTarget(h.agent, h.task, { requestId: `wrong-${_label}`, installationId: 'extension', tab: tabB })
      const settled = h.ctx.browserTasks.settleSelectionOperation(h.agent, planned.task, { kind: 'result', result: { requestId: `wrong-${_label}`, sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent', value: { page: pageB, tab: returnedTab } } })
      expect(settled.task.target).toEqual({ installationId: 'extension', page: pageA })
      expect(settled.task.attempts[0]).toMatchObject({ outcome: 'unknown' })
    } finally { await h.ctx.fiber.dispose() }
  })

  it('does not adopt after the user changes target revision after planning', async () => {
    const h = await harness()
    try {
      const planned = h.ctx.browserTasks.selectTarget(h.agent, h.task, { requestId: 'revision-drift', installationId: 'extension', tab: tabB })
      h.ctx.browserTasks.bindTargetByUser(h.agent, { expectedRevision: 1, installationId: 'extension', page: pageA })
      const settled = h.ctx.browserTasks.settleSelectionOperation(h.agent, planned.task, { kind: 'result', result: { requestId: 'revision-drift', sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent', value: { page: pageB, tab: tabB } } })
      expect(settled.task.target).toEqual({ installationId: 'extension', page: pageA })
      expect(settled.task.blockers).toContain('target-lost')
    } finally { await h.ctx.fiber.dispose() }
  })

  it.each([
    ['duplicate tab', [{ tabId: 1, windowId: 3, browserSessionId }, { tabId: 1, windowId: 4, browserSessionId }]],
    ['mixed session', [{ tabId: 1, windowId: 3, browserSessionId }, { ...tabB, browserSessionId: '223e4567-e89b-42d3-a456-426614174000' }]],
    ['over capacity', Array.from({ length: 33 }, (_, tabId) => ({ tabId: tabId + 10, windowId: 3, browserSessionId }))],
  ])('rejects an explicit scope with %s', async (_label, tabs) => {
    const h = await baseHarness()
    try {
      expect(() => h.ctx.browserTasks.create(h.agent, { objective: 'bad scope', sourceSeq: h.source.seq, target: { installationId: 'extension', page: pageA }, targetRevision: 1, scope: { kind: 'explicit-set', tabs }, acceptance: [{ id: 'url', kind: 'url-equals', url: pageA.url }] })).toThrow(BrowserTaskError)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('round-trips a legal selection receipt through checkpoint facts', async () => {
    const h = await harness()
    try {
      const planned = h.ctx.browserTasks.selectTarget(h.agent, h.task, { requestId: 'checkpoint-selection', installationId: 'extension', tab: tabB })
      const settled = h.ctx.browserTasks.settleSelectionOperation(h.agent, planned.task, { kind: 'result', result: { requestId: 'checkpoint-selection', sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent', value: { page: pageB, tab: tabB } } })
      const projection = h.ctx.sessionProjections.stateOf(h.agent.session, 'browserTask')
      expect(() => validateCheckpointFacts(settled.task, projection?.sourceFacts ?? [])).not.toThrow()
      expect(browserTaskProjectionDefinition.stateSchema.safeParse(projection).success).toBe(true)
    } finally { await h.ctx.fiber.dispose() }
  })

  it.each([
    ['single-tab scope widened', (task: BrowserTaskSnapshot) => ({ ...task, scope: { kind: 'single-tab' as const } })],
    ['forged admittedBy', (task: BrowserTaskSnapshot) => ({ ...task, scope: { kind: 'descendants' as const, root: { tabId: 1, windowId: 3, browserSessionId }, members: [{ tab: tabB, admittedBy: { kind: 'browser-task-receipt' as const, sessionSeq: 9999 } }] } })],
  ])('rejects checkpoint scope provenance with %s', async (_label, forge) => {
    const h = await harness()
    try {
      const planned = h.ctx.browserTasks.selectTarget(h.agent, h.task, { requestId: `forge-${_label}`, installationId: 'extension', tab: tabB })
      const settled = h.ctx.browserTasks.settleSelectionOperation(h.agent, planned.task, { kind: 'result', result: { requestId: `forge-${_label}`, sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent', value: { page: pageB, tab: tabB } } })
      const projection = h.ctx.sessionProjections.stateOf(h.agent.session, 'browserTask')
      expect(() => validateCheckpointFacts(forge(settled.task), projection?.sourceFacts ?? [])).toThrow()
    } finally { await h.ctx.fiber.dispose() }
  })

  it.each([1, 2])('rejects selection authority attached to a v%s receipt', (version) => {
    const base = { kind: 'browser-task/receipt', version, taskId: 'task', requestId: 'request', actionKind: 'snapshot', outcome: 'observed', delivery: 'sent', quiescent: true, grantEpoch: 1,
      selection: { kind: 'scope-tab-snapshot', installationId: 'extension', targetRevision: 1, fromTarget: { installationId: 'extension', page: pageA }, tab: tabB, eligibility: { kind: 'explicit-set' } } }
    const receipt = version === 1 ? { ...base, target: { installationId: 'extension', page: pageA } }
      : { ...base, bootstrap: { kind: 'opened-tab-snapshot', installationId: 'extension', targetRevision: 1, ...tabB, openedByRequestId: 'open' }, observation: { kind: 'none' } }
    expect(() => validateReceipt(receipt)).toThrow()
  })
})
