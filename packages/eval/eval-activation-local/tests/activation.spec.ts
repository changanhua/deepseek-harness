import { expect, test, vi, type MockInstance } from 'vitest'
import { evalContractDigest } from '@changanhua/dsh-eval'
import LocalEvalActivation from '../src/index.ts'
import { setup } from '../../../budget/budget-agent/tests/harness.ts'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

const digest = (value: unknown) => evalContractDigest(value)

function requestFor(h: Awaited<ReturnType<typeof setup>>, grantId: string) {
  const goal = h.ctx.goals.get(h.agent)
  const budget = h.ctx.budget.scopeFor({ kind: 'session', id: h.agent.id })
  if (!goal || !budget) throw new Error('missing Goal/Budget fixture')
  const access = { actorId: 'operator', workspaceId: 'workspace-1', authorize: () => {} }
  return { access, request: { idempotencyKey: grantId, grant: { id: grantId, actorId: access.actorId,
    workspaceId: access.workspaceId, sessionId: String(h.agent.id), goal: { id: goal.id, revision: goal.revision },
    decisionDigest: digest('gate'), gateId: 'gate', budgetRef: budget.reference,
    expiresAt: Date.now() + 60000, maxActivations: 1 as const },
  work: { id: 'work', attemptId: 'attempt', terminalDigest: digest('terminal') }, followup: 'Continue from the accepted result.' } }
}

test('provider disposal cancels its active continuation and joins the Agent before closing the ledger', async () => {
  const h = await setup(4, 'deny'), started = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const pending: Promise<unknown>[] = []
  const stream = vi.spyOn(h.adapter, 'stream').mockImplementation(async function* (options: GenerateOptions): AsyncIterable<StreamChunk> {
    const signal = options.signal
    if (!signal) throw new Error('missing real request cancellation signal')
    let detach = () => {}
    const stopped = new Promise<void>((resolve) => {
      const abort = () => { resolve() }
      if (signal.aborted) resolve()
      else signal.addEventListener('abort', abort, { once: true })
      detach = () => { signal.removeEventListener('abort', abort) }
    })
    started.resolve(undefined)
    try { await Promise.race([stopped, release.promise]) } finally { detach() }
    signal.throwIfAborted()
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  try {
    h.ctx.goals.create(h.agent, { objective: 'stop when the continuation owner unloads', maxGoalRounds: 2 })
    h.ctx.goals.disarm(h.agent)
    const { access, request } = requestFor(h, 'unload')
    const owner = await h.ctx.plugin(LocalEvalActivation, { maxRecords: 8, maxLedgerBytes: 128 * 1024,
      exclusiveGoalDriver: true, host: { verify: async () => 'approved' } })
    const activation = h.ctx.evalActivation.activate(access, request)
    pending.push(activation)
    await started.promise
    const disposal = owner.dispose()
    pending.push(disposal)
    await disposal
    await activation
    expect(h.agent.status).toBe('idle')
    expect(h.ctx.get('evalActivation')).toBeUndefined()
    expect(h.agent.session.events.some(event => event.type === 'turn/end')).toBe(true)
  } finally { release.resolve(undefined); await Promise.allSettled(pending); stream.mockRestore(); await h.close() }
})

test('different Grants targeting one Session wait for its current activation before verification', async () => {
  const h = await setup(4, 'deny'), entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const pending: Promise<unknown>[] = []
  try {
    h.ctx.goals.create(h.agent, { objective: 'serialize continuation', maxGoalRounds: 3 })
    h.ctx.goals.disarm(h.agent)
    const first = requestFor(h, 'first'), second = requestFor(h, 'second')
    const checks: string[] = []
    await h.ctx.plugin(LocalEvalActivation, { maxRecords: 8, maxLedgerBytes: 128 * 1024, exclusiveGoalDriver: true,
      host: { verify: async (_access, grant) => {
        checks.push(grant.id)
        if (checks.length === 1) { entered.resolve(undefined); await release.promise }
        return 'approved'
      } } })
    const one = h.ctx.evalActivation.activate(first.access, first.request)
    pending.push(one)
    await entered.promise
    const two = h.ctx.evalActivation.activate(second.access, second.request).then(value => ({ value }), (error: unknown) => ({ error }))
    pending.push(two)
    const secondId = digest({ workspaceId: second.access.workspaceId, grantId: second.request.grant.id })
    await vi.waitFor(async () => { expect((await h.ctx.evalActivation.get(second.access, secondId)).phase).toBe('pending') })
    expect(checks).toEqual(['first'])
    release.resolve(undefined)
    await one
    expect(await two).toMatchObject({ error: { code: 'blocked' } })
    expect(h.adapter.requests).toHaveLength(1)
  } finally { release.resolve(undefined); await Promise.allSettled(pending); await h.close() }
})

test('expiry during the final asynchronous authorization prevents followup', async () => {
  const h = await setup(4, 'deny')
  let clock: MockInstance<() => number> | undefined
  try {
    h.ctx.goals.create(h.agent, { objective: 'do not dispatch an expired Grant', maxGoalRounds: 2 })
    h.ctx.goals.disarm(h.agent)
    const { access, request } = requestFor(h, 'expiring')
    let now = Date.now(), checks = 0
    clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    await h.ctx.plugin(LocalEvalActivation, { maxRecords: 8, maxLedgerBytes: 128 * 1024, exclusiveGoalDriver: true,
      host: { verify: async () => {
        if (++checks === 2) now = request.grant.expiresAt + 1
        return 'approved'
      } } })
    await expect(h.ctx.evalActivation.activate(access, request)).rejects.toMatchObject({ code: 'expired' })
    expect(h.adapter.requests).toHaveLength(0)
    expect(h.ctx.goals.get(h.agent)?.roundsStarted).toBe(0)
  } finally { clock?.mockRestore(); await h.close() }
})

test('one approved grant emits at most one Goal round but requires persistence before reporting consumption', async () => {
  const h = await setup(4, 'deny')
  try {
    await h.ctx.plugin(LocalEvalActivation, { maxRecords: 8, maxLedgerBytes: 128 * 1024, exclusiveGoalDriver: true,
      host: { verify: async () => 'approved' } })
    const created = h.ctx.goals.create(h.agent, { objective: 'continue exactly once', maxGoalRounds: 2 })
    h.ctx.goals.disarm(h.agent)
    const budget = h.ctx.budget.scopeFor({ kind: 'session', id: h.agent.id })!
    const access = { actorId: 'operator', workspaceId: 'workspace-1', authorize: () => {} }
    const grant = { id: 'grant-1', actorId: access.actorId, workspaceId: access.workspaceId, sessionId: String(h.agent.id),
      goal: created, decisionDigest: digest('gate'), gateId: 'gate-1', budgetRef: budget.reference, expiresAt: Date.now() + 60_000, maxActivations: 1 as const }
    const request = { idempotencyKey: 'activation-1', grant, work: { id: 'work-1', attemptId: 'attempt-1', terminalDigest: digest('terminal') }, followup: 'resume from accepted Eval' }
    const [first, duplicate] = await Promise.all([h.ctx.evalActivation.activate(access, request),
      h.ctx.evalActivation.activate(access, request)])
    expect(first.phase).toBe('needs-attention')
    expect(first.reason).toBe('delivery-unproven')
    expect(duplicate).toEqual(first)
    const goal = h.ctx.goals.get(h.agent)
    expect(goal).toMatchObject({ id: created.id, roundsStarted: 1, activation: 'disarmed' })
    expect(h.agent.session.events.filter(event => event.type === 'user/message' && event.data.source.kind === 'goal')).toHaveLength(1)
    await expect(h.ctx.evalActivation.activate(access, { ...request, work: { ...request.work, id: 'work-2' } })).rejects.toMatchObject({ code: 'conflict' })
  } finally { await h.close() }
})

test('expired Grant and rejected Host verification never dispatch a Goal round', async () => {
  const h = await setup(4, 'deny')
  try {
    let checks = 0
    await h.ctx.plugin(LocalEvalActivation, { maxRecords: 8, maxLedgerBytes: 128 * 1024, exclusiveGoalDriver: true,
      host: { verify: async () => { checks++; return 'blocked' } } })
    const created = h.ctx.goals.create(h.agent, { objective: 'must remain stopped', maxGoalRounds: 2 })
    h.ctx.goals.disarm(h.agent)
    const budget = h.ctx.budget.scopeFor({ kind: 'session', id: h.agent.id })!
    const access = { actorId: 'operator', workspaceId: 'workspace-1', authorize: () => {} }
    const grant = { id: 'grant-negative', actorId: access.actorId, workspaceId: access.workspaceId, sessionId: String(h.agent.id),
      goal: created, decisionDigest: digest('gate'), gateId: 'gate-negative', budgetRef: budget.reference, expiresAt: Date.now() + 60_000, maxActivations: 1 as const }
    const request = { idempotencyKey: 'negative', grant, work: { id: 'work-negative', attemptId: 'attempt-negative', terminalDigest: digest('terminal') }, followup: 'must not run' }
    await expect(h.ctx.evalActivation.activate(access, { ...request, grant: { ...grant, expiresAt: Date.now() - 1 } })).rejects.toMatchObject({ code: 'expired' })
    expect(checks).toBe(0)
    expect((await h.ctx.evalActivation.activate(access, request)).phase).toBe('blocked')
    expect(checks).toBe(1)
    expect(h.ctx.goals.get(h.agent)).toMatchObject({ roundsStarted: 0, activation: 'disarmed' })
    expect(h.agent.session.events.filter(event => event.type === 'user/message' && event.data.source.kind === 'goal')).toHaveLength(0)
  } finally { await h.close() }
})
