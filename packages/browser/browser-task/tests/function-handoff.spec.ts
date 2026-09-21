import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import BrowserTaskService, { BrowserTaskError } from '../src/index.ts'

const page = { tabId: 9, frameId: 0, documentId: 'doc-a', url: 'https://example.test/a' }
const target = { installationId: 'chrome-a', page }
const owner = { kind: 'browser-installation' as const, installationId: 'chrome-a', grantEpoch: 7,
  pluginId: 'plugin-a', packageId: 'package-a', pluginRunId: 'run-a', handoffId: 'handoff-a' }

async function ready(options: {
  acceptance?: boolean
  resource?: 'active' | 'pending' | 'none'
  unknownWrite?: boolean
  delegationStatus?: string
} = {}) {
  const ctx = new Context(); await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(BrowserTaskService)
  const session = ctx.sessions.create(SessionId(`handoff-${Math.random()}`))
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '交付页面功能' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const agent = {
    id: session.id, options: {}, session, ctx, status: 'idle',
    inbox: { append() {}, remove() { return false }, nextStep: [] },
    send() {}, followup() {}, steer() {}, inject() {}, cancel() {},
    runMaintenance(fn: (signal: AbortSignal) => unknown) { return fn(new AbortController().signal) },
    whenIdle() { return Promise.resolve() },
  } as unknown as Agent
  const unregister = ctx.agents.register(agent)
  ctx.browserTasks.bindTargetByUser(agent, { expectedRevision: 0, installationId: target.installationId, page })
  let task = ctx.browserTasks.create(agent, { objective: '交付页面功能', sourceSeq: 0, target, targetRevision: 1,
    acceptance: [{ id: 'url', kind: 'url-equals', url: page.url }] })
  task = ctx.browserTasks.recordCapability(agent, task, { installationId: 'chrome-a', state: 'observed', grantEpoch: 7,
    scopes: ['browser:read', 'browser:write'], actions: ['snapshot', 'region_render'], protocol: '1' })
  task = ctx.browserTasks.recordEvidence(agent, task, { id: 'evidence-a', state: 'current', source: { kind: 'user', sessionSeq: 0 },
    digest: 'sha256:evidence-a', target, grantEpoch: 7 })
  if (options.acceptance !== false) {
    const check = ctx.browserTasks.recordCheck(agent, task, { checkerId: 'check-a', target, grantEpoch: 7,
      evaluations: [{ clauseId: 'url', satisfied: true, evidenceIds: ['evidence-a'] }] })
    task = ctx.browserTasks.evaluate(agent, task, [{ clauseId: 'url', satisfied: true, evidenceIds: ['evidence-a'], checkerRef: check }])
  }
  if (options.resource !== 'none') {
    task = ctx.browserTasks.upsertResource(agent, task, { id: 'panel', state: 'reserved', target })
    if (options.resource !== 'pending') task = ctx.browserTasks.upsertResource(agent, task, { id: 'panel', state: 'active', target })
  }
  const work = { callId: 'cordis-call', kind: 'cordis' as const, status: options.delegationStatus ?? 'running',
    identity: { mode: 'cordis' as const, pluginId: owner.pluginId, packageId: owner.packageId, pluginRunId: owner.pluginRunId }, evidenceIds: [] }
  const fact = session.append('browser-task/delegation', { kind: 'browser-task/delegation', version: 1, taskId: task.id, work })
  task = ctx.browserTasks.linkDelegatedWork(agent, task, { ...work, source: { kind: 'browser-task-delegation', sessionSeq: fact.seq } })
  if (options.unknownWrite) {
    task = ctx.browserTasks.recordAttempt(agent, task, { attemptId: 'unknown', requestId: 'unknown', actionKind: 'click', grantEpoch: 7, stage: 'planned', write: true, target })
    task = ctx.browserTasks.advanceAttempt(agent, task, { ...task.attempts.at(-1)!, stage: 'dispatched' })
    const receipt = ctx.browserTasks.recordReceipt(agent, task, { requestId: 'unknown', actionKind: 'click', target,
      outcome: 'unknown', delivery: 'sent', quiescent: false, grantEpoch: 7 })
    task = ctx.browserTasks.advanceAttempt(agent, task, { ...task.attempts.at(-1)!, stage: 'settled', outcome: 'unknown', quiescent: false, settledBy: receipt })
  }
  return { ctx, agent, session, task, unregister }
}

const pageRequest = (overrides: Record<string, unknown> = {}) => ({ owner, resourceIds: ['panel'],
  scope: { kind: 'page' as const, target, targetRevision: 1 }, ...overrides })
const globalRequest = () => ({ owner, resourceIds: [], scope: { kind: 'global' as const } })

describe('BrowserTask function handoff', () => {
  it('keeps ordinary retained upserts forbidden', async () => {
    const h = await ready()
    expect(() => h.ctx.browserTasks.upsertResource(h.agent, h.task, { id: 'panel', state: 'retained', target,
      owner, disposition: 'owner-transfer', dispositionSource: { kind: 'browser-task-function-handoff', sessionSeq: 99 } } as never)).toThrow(BrowserTaskError)
    await h.ctx.fiber.dispose()
  })

  it.each([
    ['stale target revision', { scope: { kind: 'page', target, targetRevision: 2 } }],
    ['wrong page', { scope: { kind: 'page', target: { ...target, page: { ...page, documentId: 'other' } }, targetRevision: 1 } }],
    ['installation', { owner: { ...owner, installationId: 'chrome-b' } }],
    ['epoch', { owner: { ...owner, grantEpoch: 8 } }],
    ['plugin', { owner: { ...owner, pluginId: 'plugin-b' } }],
    ['package', { owner: { ...owner, packageId: 'package-b' } }],
    ['run', { owner: { ...owner, pluginRunId: 'run-b' } }],
    ['resources', { resourceIds: [] }],
  ])('rejects mismatched %s before appending', async (_label, override) => {
    const h = await ready(); const before = h.session.events.length
    expect(() => h.ctx.browserTasks.handoffFunction(h.agent, h.task, pageRequest(override))).toThrow(BrowserTaskError)
    expect(h.session.events).toHaveLength(before); await h.ctx.fiber.dispose()
  })

  it.each([
    ['acceptance', { acceptance: false }], ['unknown write', { unknownWrite: true }],
    ['pending resource', { resource: 'pending' as const }], ['Cordis status', { delegationStatus: 'completed' }],
  ])('rejects invalid %s state', async (_label, options) => {
    const h = await ready(options)
    expect(() => h.ctx.browserTasks.handoffFunction(h.agent, h.task, pageRequest())).toThrow(BrowserTaskError)
    await h.ctx.fiber.dispose()
  })

  it('rejects stale refs, dead agents, global-with-page-resources, and page-without-resources', async () => {
    const stale = await ready()
    expect(() => stale.ctx.browserTasks.handoffFunction(stale.agent,
      { id: stale.task.id, revision: stale.task.revision - 1 }, pageRequest())).toThrow(BrowserTaskError)
    const dead = await ready(); dead.unregister()
    expect(() => dead.ctx.browserTasks.handoffFunction(dead.agent, dead.task, pageRequest())).toThrow(BrowserTaskError)
    const global = await ready()
    expect(() => global.ctx.browserTasks.handoffFunction(global.agent, global.task, globalRequest())).toThrow(BrowserTaskError)
    const pageOnly = await ready({ resource: 'none' })
    expect(() => pageOnly.ctx.browserTasks.handoffFunction(pageOnly.agent, pageOnly.task,
      { ...pageRequest(), resourceIds: [] })).toThrow(BrowserTaskError)
    await stale.ctx.fiber.dispose(); await dead.ctx.fiber.dispose(); await global.ctx.fiber.dispose(); await pageOnly.ctx.fiber.dispose()
  })

  it('durably transfers exact page resources and passes the completion gate', async () => {
    const h = await ready(); const before = h.session.events.length
    const handed = h.ctx.browserTasks.handoffFunction(h.agent, h.task, pageRequest())
    expect(handed.functionHandoff).toMatchObject({ owner, scope: pageRequest().scope,
      resourceIds: ['panel'], createdBySessionId: h.agent.session.id })
    expect(typeof handed.functionHandoff?.source.sessionSeq).toBe('number')
    expect(handed.resources).toEqual([expect.objectContaining({ id: 'panel', state: 'retained', owner,
      disposition: 'owner-transfer' })])
    const dispositionSource = handed.resources[0]?.dispositionSource
    expect(dispositionSource?.kind).toBe('browser-task-function-handoff')
    expect(typeof (dispositionSource?.kind === 'browser-task-function-handoff' ? dispositionSource.sessionSeq : undefined)).toBe('number')
    const added = h.session.events.slice(before)
    expect(added.map(event => event.type)).toEqual(['browser-task/function-handoff', 'browser-task/change'])
    expect(added[0]?.data).toMatchObject({ taskId: h.task.id, taskRevision: h.task.revision, owner,
      createdBySessionId: h.agent.session.id, resourceIds: ['panel'], scope: pageRequest().scope })
    expect(h.ctx.browserTasks.terminate(h.agent, handed, 'completed')).toMatchObject({ phase: 'terminal', outcome: 'completed' })
    await h.ctx.fiber.dispose()
  })

  it('supports a global handoff only when no Browser resource exists', async () => {
    const h = await ready({ resource: 'none' })
    const handed = h.ctx.browserTasks.handoffFunction(h.agent, h.task, globalRequest())
    expect(handed.resources).toEqual([])
    expect(handed.functionHandoff).toMatchObject({ owner, scope: { kind: 'global' }, resourceIds: [] })
    expect(h.ctx.browserTasks.terminate(h.agent, handed, 'completed')).toMatchObject({ outcome: 'completed' })
    await h.ctx.fiber.dispose()
  })

  it('fails replay of the same handoff fact', async () => {
    const h = await ready(); h.ctx.browserTasks.handoffFunction(h.agent, h.task, pageRequest())
    const fact = h.session.events.find(event => event.type === 'browser-task/function-handoff')!
    h.session.append('browser-task/function-handoff', fact.data)
    expect(() => h.ctx.browserTasks.get(h.agent)).toThrow('browser task replay failed')
    await h.ctx.fiber.dispose()
  })
})
