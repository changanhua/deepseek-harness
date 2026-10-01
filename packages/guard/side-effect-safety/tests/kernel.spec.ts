import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { guardedPlugin } from '../../../extensions/cordis-host-runner/src/guard.ts'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import Approval from '@deepseek-ai/dsh-user-approval'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { canonicalDigest } from '@changanhua/dsh-delivery-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import Safety, { bindSafetyAdapter } from '../src/index.ts'
import type { Config, ApprovalDraft, ActionInput, AdmittedAction, SafetyAdapter, SafetyExecutionId } from '../src/types.ts'
import { validateState, projection } from '../src/state.ts'
import type { DurableState } from '../src/state.ts'

const limits: Config = { maxExecutions: 20, maxApprovals: 20, maxActionsPerExecution: 20,
  maxRecordBytes: 65536, maxTotalBytes: 262144, maxEvidenceRefs: 8, maxAdmissionMs: 1000 }
const evidence = [{ uri: 'fixture:readback', digest: canonicalDigest('synthetic evidence') }]
const cost = { actions: 1, externalWrites: 1, resourceSpend: 2, domainUnits: { synthetic: 1 } }
function draft(): ApprovalDraft {
  return { domain: 'synthetic', subjectRef: { kind: 'fixture', id: 'target' },
    scopeDigest: canonicalDigest('scope'), policyDigest: canonicalDigest('policy'),
    startsAt: Date.now() - 100, expiresAt: Date.now() + 60_000,
    budget: { maxActions: 10, maxExternalWrites: 10, maxResourceSpend: 100, maxUnknownActions: 1,
      maxConsecutiveFailures: 3, maxRuntimeMs: 60_000, domainLimits: { synthetic: 10 } } }
}
function input(key = 'A'): ActionInput {
  return { idempotencyKey: key, kind: 'synthetic-write', targetRef: { kind: 'fixture', id: 'target' },
    parameters: { value: key }, riskCost: structuredClone(cost) }
}
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
async function harness(options: { pool?: MemoryMediaPool; root?: string; config?: Partial<Config>; approval?: boolean } = {}) {
  const ctx = new Context()
  const backend = options.root ? new JsonStorageBackend(options.root) : new MemoryStorageBackend(options.pool)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('test', backend)
  const facility = new DomainFacility(ctx, { backend: 'test' })
  ctx.provide('storageDomain', facility)
  ctx.storage.mount('domain', facility)
  await ctx.plugin(SessionStore)
  if (options.approval !== false) await ctx.plugin(Approval)
  const session = ctx.sessions.create(SessionId('safety-test'))
  session.append('turn/start', { turn: 1 })
  const request = { agent: { session } as Agent, toolName: 'activate-safety-approval' }
  const answer = ctx.on('approval/request', () => Promise.resolve('allowed-once' as const))
  let disposed = false
  const dispose = async () => { if (disposed) return; disposed = true; await ctx.fiber.dispose(); await backend.close() }
  cleanup.push(dispose)
  await ctx.plugin(Safety, { ...limits, ...options.config })
  const service = ctx.sideEffectSafety
  const adapter: SafetyAdapter = {
    confirmHuman: async d => ({ kind: 'human', actorId: 'fixture-human', draftDigest: canonicalDigest(d), evidenceRefs: evidence }),
    validate: vi.fn(async () => true),
    send: vi.fn(async () => ({ outcome: 'CONFIRMED' as const, evidenceRefs: evidence })),
    inspect: vi.fn(async () => ({ outcome: 'NOT_APPLIED' as const, evidenceRefs: evidence })),
  }
  const binding = bindSafetyAdapter(ctx, 'synthetic', adapter)
  const safety = { ...binding, snapshot: (id: SafetyExecutionId) => service.snapshot(id) }
  const rev = (id: SafetyExecutionId) => safety.snapshot(id).execution.revision
  const setup = async (d = draft()) => {
    const approval = await binding.approve(d, request)
    let execution = await safety.createExecution(approval.id, 'run')
    execution = await safety.acquireLease(execution.id, execution.revision, 30_000)
    return execution.id
  }
  const prepare = (id: SafetyExecutionId, value = input()) => binding.prepare(id, rev(id), value)
  const handle = async (id: SafetyExecutionId, value = input()) => {
    const a = await prepare(id, value)
    return binding.admit(id, rev(id), a.id, value.parameters)
  }
  return { ctx, backend, facility, safety, binding, adapter, request, session, answer, dispose, setup, prepare, handle, rev }
}

describe('SSP-WP1 durable synthetic kernel', () => {
  it('runs UNKNOWN → restart → block B → reconcile NOT_APPLIED → B, without replay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-safety-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const first = await harness({ root })
    first.adapter.send = vi.fn(async () => ({ outcome: 'UNKNOWN' as const, evidenceRefs: [] }))
    const id = await first.setup(), h = await first.handle(id)
    const a = await first.binding.execute(h)
    expect(a.phase).toBe('UNKNOWN')
    expect(first.adapter.send).toHaveBeenCalledTimes(1)
    await first.dispose()
    const next = await harness({ root })
    expect(next.safety.snapshot(id).breaker).toBe('RECONCILING')
    await expect(next.prepare(id, input('B'))).rejects.toThrow('unresolved-action')
    const duplicate = await next.prepare(id)
    expect(duplicate.id).toBe(a.id)
    expect(duplicate.phase).toBe('UNKNOWN')
    await expect(next.binding.admit(id, next.rev(id), a.id, input().parameters)).rejects.toThrow()
    await expect(next.binding.execute(h)).rejects.toThrow('invalid-admitted-handle')
    await next.binding.reconcile(id, next.rev(id), a.id)
    expect(next.safety.snapshot(id).execution.actions[0]?.phase).toBe('NOT_APPLIED')
    await next.safety.acquireLease(id, next.rev(id), 30_000)
    const b = await next.binding.execute(await next.handle(id, input('B')))
    expect(b.phase).toBe('CONFIRMED')
    expect(next.adapter.send).toHaveBeenCalledTimes(1)
    expect(next.adapter.inspect).toHaveBeenCalledTimes(1)
    expect(next.safety.snapshot(id).spent).toEqual({ actions: 2, externalWrites: 2, resourceSpend: 4, domainUnits: { synthetic: 2 } })
    const disk = await readFile(join(root, 'side_effect_safety.json'), 'utf8')
    expect(disk).not.toContain('"parameters"')
    expect(disk).toContain(a.id)
    await next.safety.control(id, next.rev(id), 'completed')
    expect(next.safety.snapshot(id).breaker).toBe('COMPLETED')
  })

  it('persists SENT and budget before callback; failed settlement restarts as UNKNOWN', async () => {
    const pool = new MemoryMediaPool(), h = await harness({ pool }), id = await h.setup()
    h.adapter.send = vi.fn(async () => {
      const state = pool.media.get('side_effect_safety')!.global as DurableState
      expect(state.executions[0]?.actions[0]?.phase).toBe('SENT')
      expect(h.safety.snapshot(id).spent.actions).toBe(1)
      pool.failNextWrites = 1
      return { outcome: 'CONFIRMED' as const, evidenceRefs: evidence }
    })
    const handle = await h.handle(id)
    await expect(h.binding.execute(handle)).rejects.toThrow('injected write failure')
    expect(h.safety.snapshot(id).execution.actions[0]?.phase).toBe('SENT')
    await h.dispose()
    const next = await harness({ pool })
    expect(next.safety.snapshot(id).execution.actions[0]?.phase).toBe('UNKNOWN')
    expect(next.adapter.send).not.toHaveBeenCalled()
    await expect(next.prepare(id, input('B'))).rejects.toThrow('unresolved-action')
  })

  it('does not cross send on a failed SENT commit', async () => {
    const pool = new MemoryMediaPool(), h = await harness({ pool }), id = await h.setup(), handle = await h.handle(id)
    pool.failNextWrites = 1
    await expect(h.binding.execute(handle)).rejects.toThrow('injected write failure')
    expect(h.adapter.send).not.toHaveBeenCalled()
    expect(h.safety.snapshot(id).spent.actions).toBe(0)
    expect(h.safety.snapshot(id).execution.actions[0]?.phase).toBe('PREPARED')
    await expect(h.binding.execute(handle)).rejects.toThrow('invalid-admitted-handle')
  })

  it('deduplicates identical retries and latches conflicting idempotency durably', async () => {
    const pool = new MemoryMediaPool(), h = await harness({ pool }), id = await h.setup()
    const a = await h.prepare(id), revision = h.rev(id)
    const retried = await h.binding.prepare(id, 0, input())
    expect(retried).toEqual(a)
    expect(h.rev(id)).toBe(revision)
    await expect(h.prepare(id, { ...input(), parameters: { value: 'changed' } })).rejects.toThrow('idempotency-conflict')
    expect(h.safety.snapshot(id).breaker).toBe('BLOCKED')
    await h.dispose()
    const next = await harness({ pool })
    expect(next.safety.snapshot(id).reasons).toContain('idempotency-conflict')
    expect(next.safety.snapshot(id).execution.actions).toHaveLength(1)
  })

  it('rejects raw, copied, foreign, repeated and expired admitted handles', async () => {
    const h = await harness(), id = await h.setup(), handle = await h.handle(id)
    await expect(h.binding.execute(input() as unknown as AdmittedAction)).rejects.toThrow('invalid-admitted-handle')
    await expect(h.binding.execute({ ...handle })).rejects.toThrow('invalid-admitted-handle')
    const foreign = bindSafetyAdapter(h.ctx, 'other', h.adapter)
    await expect(foreign.execute(handle)).rejects.toThrow('invalid-admitted-handle')
    await h.binding.execute(handle)
    await expect(h.binding.execute(handle)).rejects.toThrow('invalid-admitted-handle')
    const old = await h.handle(id, input('B'))
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000)
    await expect(h.binding.execute(old)).rejects.toThrow('admission-expired')
    expect(h.adapter.send).toHaveBeenCalledTimes(1)
  })

  it.each(['policy', 'pause', 'release', 'revoke', 'expiry'] as const)('rechecks %s after admission', async (mode) => {
    const h = await harness(), id = await h.setup(), handle = await h.handle(id)
    if (mode === 'policy') h.adapter.validate = async () => false
    if (mode === 'pause') await h.safety.control(id, h.rev(id), 'paused')
    if (mode === 'release') await h.safety.releaseLease(id, h.rev(id))
    if (mode === 'revoke') await h.safety.revokeApproval(h.safety.snapshot(id).execution.approvalArtifactId)
    if (mode === 'expiry') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000)
    await expect(h.binding.execute(handle)).rejects.toThrow()
    expect(h.adapter.send).not.toHaveBeenCalled()
  })

  it('serializes CAS and budget consumption and forbids budget reset with another execution', async () => {
    const h = await harness(), d = draft(); d.budget.maxActions = 1
    const id = await h.setup(d), revision = h.rev(id)
    const results = await Promise.allSettled([h.binding.prepare(id, revision, input('A')), h.binding.prepare(id, revision, input('B'))])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const a = h.safety.snapshot(id).execution.actions[0]!
    const handles = await Promise.all([
      h.binding.admit(id, h.rev(id), a.id, input().parameters), h.binding.admit(id, h.rev(id), a.id, input().parameters),
    ])
    const sends = await Promise.allSettled(handles.map(handle => h.binding.execute(handle)))
    expect(sends.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(h.adapter.send).toHaveBeenCalledTimes(1)
    await expect(h.prepare(id, input('B'))).rejects.toThrow('budget-exhausted')
    await expect(h.safety.createExecution(h.safety.snapshot(id).execution.approvalArtifactId, 'reset-budget')).rejects.toThrow('approval-already-bound')
  })

  it('rejects unbudgeted dimensions and oversized costs; snapshots are detached', async () => {
    const h = await harness(), id = await h.setup()
    await expect(h.prepare(id, { ...input(), riskCost: { ...cost, domainUnits: { absent: 1 } } })).rejects.toThrow('budget-exceeded')
    await expect(h.prepare(id, { ...input(), riskCost: { ...cost, resourceSpend: 101 } })).rejects.toThrow('budget-exceeded')
    const view = h.safety.snapshot(id); view.execution.hardBlock = 'fake'; view.execution.actions.push({} as never)
    expect(h.safety.snapshot(id).execution.hardBlock).toBeNull()
    expect(h.safety.snapshot(id).execution.actions).toHaveLength(0)
  })

  it('requires actual approval seam and independent human proof; no raw allowed-once activation', async () => {
    const missing = await harness({ approval: false })
    await expect(missing.binding.approve(draft(), missing.request)).rejects.toThrow('approval-unavailable')
    const h = await harness()
    h.adapter.confirmHuman = async () => undefined
    await expect(h.binding.approve(draft(), h.request)).rejects.toThrow()
    expect((h.facility.get('side_effect_safety')!.global.get() as DurableState).approvals).toHaveLength(0)
    h.answer()
    await expect(h.binding.approve(draft(), h.request)).rejects.toThrow('approval-denied')
    expect('markConfirmed' in h.safety).toBe(false)
  })

  it('requires exact draft human confirmation and refuses expired authorization', async () => {
    const h = await harness()
    h.adapter.confirmHuman = async () => ({ kind: 'human', actorId: 'fixture', draftDigest: canonicalDigest('wrong'), evidenceRefs: evidence })
    await expect(h.binding.approve(draft(), h.request)).rejects.toThrow('approval-proof-invalid')
    h.adapter.confirmHuman = async d => ({ kind: 'human', actorId: 'fixture', draftDigest: canonicalDigest(d), evidenceRefs: evidence })
    const d = draft(); d.startsAt -= 120_000; d.expiresAt -= 120_000
    await expect(h.binding.approve(d, h.request)).rejects.toThrow('approval-invalid')
  })

  it.each(['throw', 'missing-evidence', 'unknown'] as const)('keeps %s readback unresolved without replay', async (mode) => {
    const h = await harness(), id = await h.setup()
    h.adapter.send = async () => { throw new Error('transport lost') }
    const a = await h.binding.execute(await h.handle(id))
    h.adapter.inspect = async () => {
      if (mode === 'throw') throw new Error('journal unavailable')
      return { outcome: mode === 'missing-evidence' ? 'NOT_APPLIED' : 'UNKNOWN', evidenceRefs: [] }
    }
    expect((await h.binding.reconcile(id, h.rev(id), a.id)).phase).toBe('UNKNOWN')
    await expect(h.prepare(id, input('B'))).rejects.toThrow('unresolved-action')
  })

  it('pause and abort retain sent UNKNOWN; abort cancels only PREPARED', async () => {
    const h = await harness(), id = await h.setup()
    const a = await h.prepare(id), b = await h.prepare(id, input('B'))
    h.adapter.send = async () => ({ outcome: 'UNKNOWN' as const, evidenceRefs: [] })
    await h.binding.execute(await h.binding.admit(id, h.rev(id), a.id, input().parameters))
    await h.safety.control(id, h.rev(id), 'aborted')
    const snapshot = h.safety.snapshot(id)
    expect(snapshot.execution.actions.find(v => v.id === a.id)?.phase).toBe('UNKNOWN')
    expect(snapshot.execution.actions.find(v => v.id === b.id)?.phase).toBe('CANCELLED')
    await expect(h.safety.control(id, h.rev(id), 'active')).rejects.toThrow('invalid-transition')
    await h.binding.reconcile(id, h.rev(id), a.id)
    expect(h.safety.snapshot(id).breaker).toBe('PAUSED')
  })

  it('owns adapter disposal and blocks captured handles after HMR', async () => {
    const h = await harness(), id = await h.setup(), handle = await h.handle(id)
    await h.dispose()
    expect(() => h.binding.execute(handle)).toThrow('adapter-unavailable')
    expect(h.adapter.send).not.toHaveBeenCalled()
  })

  it('blocks corrupted durable relationships instead of discarding ledger records', async () => {
    const pool = new MemoryMediaPool(), h = await harness({ pool }), id = await h.setup()
    await h.prepare(id)
    await h.dispose()
    const state = pool.media.get('side_effect_safety')!.global as DurableState
    state.executions[0]!.actions[0]!.requestDigest = canonicalDigest('tampered')
    await expect(harness({ pool })).rejects.toThrow('ledger-inconsistent')
  })

  it('enforces complete-record byte and action-count limits without partial publication', async () => {
    const h = await harness({ config: { maxActionsPerExecution: 1 } }), id = await h.setup()
    await h.prepare(id)
    const revision = h.rev(id)
    await expect(h.prepare(id, input('B'))).rejects.toThrow('storage-limit')
    expect(h.rev(id)).toBe(revision)
    const tiny = await harness({ config: { maxRecordBytes: 16 } })
    await expect(tiny.setup()).rejects.toThrow('storage-limit')
  })
})

describe('adversarial lifecycle checks', () => {
  it('rechecks time after asynchronous policy and after SENT storage latency', async () => {
    const h = await harness(), id = await h.setup(), a = await h.prepare(id)
    const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    let calls = 0
    h.adapter.validate = async () => { calls++; if (calls === 2) clock.mockReturnValue(now + 2000); return true }
    const handle = await h.binding.admit(id, h.rev(id), a.id, input().parameters)
    await expect(h.binding.execute(handle)).rejects.toThrow('admission-expired')
    expect(h.adapter.send).not.toHaveBeenCalled()
    clock.mockReturnValue(now)
    h.adapter.validate = async () => true
    const next = await h.binding.admit(id, h.rev(id), a.id, input().parameters)
    h.ctx.on('domain/changed', (event) => {
      if (event.domain === 'side_effect_safety' && h.safety.snapshot(id).execution.actions[0]?.phase === 'SENT') clock.mockReturnValue(now + 2000)
    })
    expect((await h.binding.execute(next)).phase).toBe('UNKNOWN')
    expect(h.adapter.send).not.toHaveBeenCalled()
  })

  it('does not confuse synchronous executor failure with NOT_APPLIED', async () => {
    const h = await harness(), id = await h.setup()
    h.adapter.send = () => { throw new Error('sync send failure') }
    expect((await h.binding.execute(await h.handle(id))).phase).toBe('UNKNOWN')
    h.adapter.inspect = async () => ({ outcome: 'CONFIRMED' as const, evidenceRefs: evidence })
    const a = h.safety.snapshot(id).execution.actions[0]!
    expect((await h.binding.reconcile(id, h.rev(id), a.id)).phase).toBe('CONFIRMED')
    await expect(h.binding.reconcile(id, h.rev(id), a.id)).rejects.toThrow('invalid-transition')
    await expect(h.binding.admit(id, h.rev(id), a.id, input().parameters)).rejects.toThrow('action-not-admissible')
  })

  it('binds lease to target across executions and blocks UNKNOWN even after expiry', async () => {
    const h = await harness(), id = await h.setup(), d = draft()
    d.scopeDigest = canonicalDigest('different scope')
    const approval = await h.binding.approve(d, h.request)
    const second = await h.safety.createExecution(approval.id, 'second')
    await expect(h.safety.acquireLease(second.id, second.revision, 1000)).rejects.toThrow('target-leased')
    h.adapter.send = async () => ({ outcome: 'UNKNOWN' as const, evidenceRefs: [] })
    await h.binding.execute(await h.handle(id))
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000)
    await expect(h.safety.acquireLease(second.id, h.rev(second.id), 1000)).rejects.toThrow('unresolved-action')
    expect(h.safety.snapshot(id).breaker).toBe('RECONCILING')
  })

  it('reuses exact execution and activation identities but rejects conflicting execution keys', async () => {
    const h = await harness(), d = draft(), approval = await h.binding.approve(d, h.request)
    expect(await h.binding.approve(d, h.request)).toEqual(approval)
    const e = await h.safety.createExecution(approval.id, 'run')
    expect(await h.safety.createExecution(approval.id, 'run')).toEqual(e)
    const other = await h.binding.approve({ ...d, scopeDigest: canonicalDigest('new') }, h.request)
    await expect(h.safety.createExecution(other.id, 'run')).rejects.toThrow('idempotency-conflict')
    expect(h.safety.snapshot(e.id).reasons).toContain('idempotency-conflict')
    await h.safety.revokeApproval(approval.id)
    await expect(h.binding.approve(d, h.request)).rejects.toThrow('approval-invalid')
    await expect(h.safety.createExecution(approval.id, 'new')).rejects.toThrow('approval-invalid')
  })

  it('serializes concurrent activation without duplicate artifacts', async () => {
    const h = await harness(), d = draft()
    const approvals = await Promise.all([h.binding.approve(d, h.request), h.binding.approve(d, h.request)])
    expect(approvals[0]).toEqual(approvals[1])
  })

  it('policy exceptions, digest mismatch, target mismatch and wrong binding fail closed', async () => {
    const h = await harness(), id = await h.setup(), a = await h.prepare(id)
    await expect(h.binding.admit(id, h.rev(id), a.id, { wrong: true })).rejects.toThrow('payload-conflict')
    h.adapter.validate = async () => { throw new Error('unavailable') }
    await expect(h.binding.admit(id, h.rev(id), a.id, input().parameters)).rejects.toThrow('policy-unavailable')
    await expect(h.prepare(id, { ...input('B'), targetRef: { kind: 'fixture', id: 'other' } })).rejects.toThrow('target-mismatch')
    const other = bindSafetyAdapter(h.ctx, 'other', h.adapter)
    await expect(other.prepare(id, h.rev(id), input())).rejects.toThrow('domain-mismatch')
    await expect(other.approve(draft(), h.request)).rejects.toThrow('domain-mismatch')
    expect(() => bindSafetyAdapter(h.ctx, 'synthetic', h.adapter)).toThrow('adapter-unavailable')
    expect(h.adapter.send).not.toHaveBeenCalled()
  })

  it('rejects expired, future and malformed leases; validates completion and pause/resume', async () => {
    const h = await harness(), id = await h.setup()
    await expect(h.safety.acquireLease(id, h.rev(id) - 1, 100)).rejects.toThrow('revision-conflict')
    await expect(h.safety.acquireLease(id, h.rev(id), 0)).rejects.toThrow('lease-denied')
    await expect(h.safety.control(id, h.rev(id), 'completed')).rejects.toThrow('completion-unverified')
    await h.safety.control(id, h.rev(id), 'paused')
    await expect(h.prepare(id)).rejects.toThrow()
    await h.safety.control(id, h.rev(id), 'active')
    const a = await h.prepare(id)
    await expect(h.safety.control(id, h.rev(id), 'completed')).rejects.toThrow('completion-unverified')
    await h.binding.execute(await h.binding.admit(id, h.rev(id), a.id, input().parameters))
    await h.safety.control(id, h.rev(id), 'completed')
    await expect(h.safety.control(id, h.rev(id), 'active')).rejects.toThrow('invalid-transition')
    await h.dispose()
    expect(() => h.safety.snapshot(id)).toThrow('closed')
    await expect(h.safety.releaseLease(id, 0)).rejects.toThrow('closed')
  })

  it('retains UNKNOWN if settlement proof exceeds configured bounds', async () => {
    const h = await harness({ config: { maxEvidenceRefs: 1 } }), id = await h.setup()
    h.adapter.send = async () => ({ outcome: 'CONFIRMED' as const, evidenceRefs: [...evidence, ...evidence] })
    const a = await h.binding.execute(await h.handle(id))
    expect(a.phase).toBe('UNKNOWN')
    expect(h.safety.snapshot(id).spent.actions).toBe(1)
  })

  it('invalidates only the disposing adapter and permits a new binding after disposal', async () => {
    const h = await harness(), id = await h.setup()
    let binding!: ReturnType<typeof bindSafetyAdapter>
    const plugin = (ctx: Context) => { binding = bindSafetyAdapter(ctx, 'isolated', h.adapter) }
    const fiber = await h.ctx.plugin(Object.assign(plugin, { inject: ['sideEffectSafety'] }))
    await fiber.dispose()
    await expect(binding.prepare(id, h.rev(id), input())).rejects.toThrow('adapter-unavailable')
    const again = bindSafetyAdapter(h.ctx, 'isolated', h.adapter)
    expect(again).toBeDefined()
  })

  it('keeps runtime and failure budgets deterministic', async () => {
    const h = await harness(), d = draft(); d.budget.maxConsecutiveFailures = 1
    const id = await h.setup(d)
    h.adapter.send = async () => ({ outcome: 'NOT_APPLIED' as const, evidenceRefs: evidence })
    await h.binding.execute(await h.handle(id))
    expect(h.safety.snapshot(id).reasons).toContain('budget-exhausted')
    await expect(h.prepare(id, input('B'))).rejects.toThrow('budget-exhausted')
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000)
    expect(h.safety.snapshot(id).reasons).toContain('runtime-budget')
  })
})

describe('durable boundary validation', () => {
  it('rejects duplicate identities, broken bindings, invalid windows and excessive evidence', async () => {
    const pool = new MemoryMediaPool(), h = await harness({ pool }), id = await h.setup()
    await h.prepare(id)
    const source = structuredClone(pool.media.get('side_effect_safety')!.global as DurableState)
    const corruptions: Array<(state: DurableState) => void> = [
      (state) => { state.approvals.push(structuredClone(state.approvals[0]!)) },
      (state) => { state.executions.push(structuredClone(state.executions[0]!)) },
      (state) => { state.approvals[0]!.expiresAt = state.approvals[0]!.startsAt },
      (state) => { state.approvals[0]!.approvedBy.draftDigest = canonicalDigest('wrong') },
      (state) => { state.executions[0]!.requestDigest = canonicalDigest('wrong') },
      (state) => { state.executions[0]!.actions.push(structuredClone(state.executions[0]!.actions[0]!)) },
      (state) => { state.executions[0]!.lease!.targetRef.id = 'wrong' },
      (state) => {
        const duplicate = structuredClone(state.executions[0]!)
        duplicate.id = 'other' as never; duplicate.idempotencyKey = 'other'; duplicate.lease = null; duplicate.actions = []
        state.executions.push(duplicate)
      },
      (state) => { state.executions[0]!.lease!.expiresAt = state.approvals[0]!.expiresAt + 1 },
      (state) => { state.executions[0]!.lease!.acquiredAt = state.approvals[0]!.startsAt - 1 },
      (state) => { state.executions[0]!.control = 'completed' },
      (state) => {
        const action = state.executions[0]!.actions[0]!
        action.phase = 'SENT'; action.sentAt = Date.now(); action.sentRevision = 1; action.riskCost.resourceSpend = 101
        action.requestDigest = canonicalDigest({ kind: action.kind, targetRef: action.targetRef,
          parametersDigest: action.parametersDigest, riskCost: action.riskCost })
      },
      (state) => { state.executions[0]!.lease!.expiresAt = state.executions[0]!.lease!.acquiredAt },
      (state) => { state.executions[0]!.actions[0]!.phase = 'UNKNOWN' },
      (state) => { state.executions[0]!.actions[0]!.phase = 'CONFIRMED'; state.executions[0]!.actions[0]!.sentAt = Date.now() },
    ]
    for (const corrupt of corruptions) {
      const state = structuredClone(source); corrupt(state)
      expect(() =>{  validateState(state, limits) }).toThrow('ledger-inconsistent')
    }
    for (const config of [{ maxApprovals: 0 }, { maxExecutions: 0 }, { maxTotalBytes: 1 }]) {
      expect(() =>{  validateState(source, { ...limits, ...config }) }).toThrow('storage-limit')
    }
    const approvalOverflow = structuredClone(source)
    approvalOverflow.approvals[0]!.approvedBy.evidenceRefs = Array.from({ length: 9 }, () => ({ ...evidence[0]! }))
    expect(() =>{  validateState(approvalOverflow, limits) }).toThrow('storage-limit')
    const actionOverflow = structuredClone(source)
    actionOverflow.executions[0]!.actions[0]!.evidenceRefs = Array.from({ length: 9 }, () => ({ ...evidence[0]! }))
    expect(() =>{  validateState(actionOverflow, limits) }).toThrow('storage-limit')
    const unknown = structuredClone(source)
    unknown.approvals[0]!.budget.maxUnknownActions = 0
    unknown.executions[0]!.actions[0]!.phase = 'UNKNOWN'
    unknown.executions[0]!.actions[0]!.sentAt = Date.now()
    expect(projection(unknown.executions[0]!, unknown.approvals[0]!, Date.now(), 'other').reasons).toContain('unknown-budget')
  })

  it('reports missing record identity instead of silently creating a replacement', async () => {
    const h = await harness(), id = await h.setup()
    expect(() => h.safety.snapshot('missing' as SafetyExecutionId)).toThrow('execution-missing')
    await expect(h.safety.revokeApproval('missing' as never)).rejects.toThrow('approval-missing')
    await expect(h.binding.admit(id, h.rev(id), 'missing' as never, {})).rejects.toThrow('action-missing')
    const a = await h.prepare(id)
    await h.binding.execute(await h.binding.admit(id, h.rev(id), a.id, input().parameters))
    await h.safety.control(id, h.rev(id), 'completed')
    await expect(h.prepare(id, input('new'))).rejects.toThrow('execution-not-active')
  })

  it('reopens a prepared record without pretending it was sent', async () => {
    const pool = new MemoryMediaPool(), h = await harness({ pool }), id = await h.setup()
    await h.prepare(id)
    await h.dispose()
    const restarted = await harness({ pool })
    expect(restarted.safety.snapshot(id).execution.actions[0]?.phase).toBe('PREPARED')
    await restarted.safety.releaseLease(id, restarted.rev(id))
    await restarted.dispose()
    const third = await harness({ pool })
    expect(third.safety.snapshot(id).execution.actions).toHaveLength(1)
    expect(third.adapter.send).not.toHaveBeenCalled()
  })

  it('can release an absent lease and refuse an invalid approval window at acquisition', async () => {
    const h = await harness(), d = draft(), approval = await h.binding.approve(d, h.request)
    const e = await h.safety.createExecution(approval.id, 'run')
    await h.safety.releaseLease(e.id, e.revision)
    await h.safety.revokeApproval(approval.id)
    await expect(h.safety.acquireLease(e.id, h.rev(e.id), 1000)).rejects.toThrow('lease-denied')
  })
})

it('Dynamic Cordis service proxy cannot register a forged adapter, mutate storage, or settle an action', async () => {
  const h = await harness(), id = await h.setup()
  await h.prepare(id)
  for (const member of ['bindAdapter', 'settle', 'transaction', 'commit', 'domain', 'handles', 'config',
    'createExecution', 'acquireLease', 'releaseLease', 'control', 'revokeApproval']) {
    let observed: unknown = 'not-run'
    const fiber = await h.ctx.plugin(guardedPlugin({
      name: `probe-${member}`, inject: ['sideEffectSafety'],
      apply(ctx: Context) { observed = Reflect.get(ctx.sideEffectSafety, member) },
    }, (error) => { throw error }))
    expect(observed).toBeUndefined()
    await fiber.dispose()
  }
  expect(h.safety.snapshot(id).execution.actions[0]?.phase).toBe('PREPARED')
  expect(h.adapter.send).not.toHaveBeenCalled()
})

it('concurrent approval cannot reactivate an artifact revoked while human proof was pending', async () => {
  const h = await harness(), d = draft()
  let waiting!: () => void, release!: () => void
  const reached = new Promise<void>((resolve) => { waiting = resolve })
  const blocked = new Promise<void>((resolve) => { release = resolve })
  let confirmations = 0
  h.adapter.confirmHuman = async (value) => {
    if (++confirmations === 2) { waiting(); await blocked }
    return { kind: 'human', actorId: 'fixture', draftDigest: canonicalDigest(value), evidenceRefs: evidence }
  }
  const first = h.binding.approve(d, h.request), second = h.binding.approve(d, h.request)
  await reached
  const approval = await first
  await h.safety.revokeApproval(approval.id)
  release()
  await expect(second).rejects.toThrow('approval-invalid')
})

it('independent targets can acquire separate leases', async () => {
  const h = await harness()
  await h.setup()
  const d = draft(); d.subjectRef.id = 'another-target'
  const approval = await h.binding.approve(d, h.request)
  const e = await h.safety.createExecution(approval.id, 'other-target')
  await h.safety.acquireLease(e.id, e.revision, 1000)
  expect(h.safety.snapshot(e.id).breaker).toBe('READY')
})

it('fails closed if durable state is replaced underneath an in-flight settlement', async () => {
  const h = await harness(), id = await h.setup()
  h.adapter.send = async () => {
    const global = h.facility.get('side_effect_safety')!.global
    const corrupted = structuredClone(global.get()) as DurableState
    corrupted.executions[0]!.actions[0]!.phase = 'UNKNOWN'
    await global.set(corrupted)
    return { outcome: 'CONFIRMED', evidenceRefs: evidence }
  }
  await expect(h.binding.execute(await h.handle(id))).rejects.toThrow('invalid-transition')
  expect(h.safety.snapshot(id).execution.actions[0]?.phase).toBe('UNKNOWN')
})

it('fails closed when foreign unresolved target state appears after lease admission', async () => {
  const h = await harness(), id = await h.setup()
  const a = await h.prepare(id)
  const d = draft(); d.scopeDigest = canonicalDigest('second approval')
  const approval = await h.binding.approve(d, h.request)
  const second = await h.safety.createExecution(approval.id, 'second')
  const global = h.facility.get('side_effect_safety')!.global
  const injected = structuredClone(global.get()) as DurableState
  const foreign = injected.executions.find(e => e.id === second.id)!
  foreign.actions.push({ ...a, executionId: second.id, approvalArtifactId: approval.id, phase: 'UNKNOWN', sentAt: Date.now() })
  await global.set(injected)
  await expect(h.binding.admit(id, h.rev(id), a.id, input().parameters)).rejects.toThrow('unresolved-action')
  expect(h.adapter.send).not.toHaveBeenCalled()
})

it('rejects a service-shaped object without the static Host registration capability', () => {
  const ctx = new Context()
  ctx.provide('sideEffectSafety', {} as Safety)
  expect(() => bindSafetyAdapter(ctx, 'fake', {} as SafetyAdapter)).toThrow('host-binding-unavailable')
})

it.each(['storageDomain', 'storage', 'storage.backend.test', 'domainAlias', 'storageAlias', 'backendAlias', 'kvAlias'])
('Dynamic Cordis cannot reach raw storage through %s', async (name) => {
  const h = await harness(), id = await h.setup()
  await h.prepare(id)
  h.ctx.provide('storage.backend.test', h.backend)
  h.ctx.provide('domainAlias', h.facility)
  h.ctx.provide('storageAlias', h.ctx.storage)
  h.ctx.provide('backendAlias', h.backend)
  h.ctx.provide('kvAlias', h.backend.kv)
  await expect(h.ctx.plugin(guardedPlugin({
    name: 'probe-storage-authority', inject: [name],
    apply(ctx: Context) { ctx.get(name) },
  }, (error) => { throw error }))).rejects.toThrow('raw storage authority is Host-only')
  expect(h.safety.snapshot(id).execution.actions[0]?.phase).toBe('PREPARED')
  expect(h.adapter.send).not.toHaveBeenCalled()
})

it('withholds raw storage properties, returns, descriptors and symbols from dynamic services', async () => {
  const h = await harness(), id = await h.setup()
  await h.prepare(id)
  h.ctx.provide('business', {
    storage: h.ctx.storage,
    getStorage: () => h.facility,
    laterStorage: async () => h.backend,
    ordinary: () => 'ok',
  })
  let dynamic!: Context
  const fiber = await h.ctx.plugin(guardedPlugin({ name: 'property-probe', inject: ['business', 'sideEffectSafety'],
    apply(ctx: Context) { dynamic = ctx },
  }, (error) => { throw error }))
  const business = dynamic.get('business') as {
    storage: unknown
    getStorage(): unknown
    laterStorage(): Promise<unknown>
    ordinary(): string
  }
  expect(() => business.storage).toThrow('raw storage authority is Host-only')
  expect(() => business.getStorage()).toThrow('raw storage authority is Host-only')
  await expect(business.laterStorage()).rejects.toThrow('raw storage authority is Host-only')
  expect(business.ordinary()).toBe('ok')
  for (const key of ['valueOf', '__proto__', 'constructor', '__defineGetter__', 'prototype']) {
    expect(Reflect.get(business, key)).toBeUndefined()
    expect(Reflect.get(dynamic.sideEffectSafety, key)).toBeUndefined()
  }
  expect(Object.getOwnPropertyDescriptors(business)).toEqual({})
  expect(Object.getPrototypeOf(business)).toBeNull()
  expect(Reflect.ownKeys(dynamic.sideEffectSafety)).toEqual([])
  expect(Reflect.get(business, Symbol('unknown'))).toBeUndefined()
  expect(() => Reflect.get(dynamic, 'storage')).toThrow('raw storage authority is Host-only')
  await fiber.dispose()
})

it.each(['on', 'once'] as const)('Dynamic ctx.%s receives detached domain events and cannot forge ledger state', async (method) => {
  const h = await harness(), id = await h.setup()
  let observed = 0
  const fiber = await h.ctx.plugin(guardedPlugin({ name: 'event-probe', apply(ctx: Context) {
    ctx[method]('domain/changed', (change) => {
      if (change.domain !== 'side_effect_safety' || change.operation !== 'put') return
      observed++
      const state = change.value as DurableState
      const action = state.executions[0]!.actions[0]!
      action.phase = 'CONFIRMED'; action.sentAt = Date.now(); action.settledAt = Date.now(); action.evidenceRefs = evidence
    })
  } }, (error) => { throw error }))
  await h.prepare(id)
  expect(observed).toBe(1)
  expect(h.safety.snapshot(id).execution.actions[0]?.phase).toBe('PREPARED')
  expect(h.adapter.send).not.toHaveBeenCalled()
  await fiber.dispose()
})

it('denies management capabilities from another domain and after disposal while queued', async () => {
  const h = await harness(), id = await h.setup()
  const foreign = bindSafetyAdapter(h.ctx, 'foreign', h.adapter)
  const approvalId = h.safety.snapshot(id).execution.approvalArtifactId
  await expect(foreign.createExecution(approvalId, 'foreign')).rejects.toThrow('domain-mismatch')
  await expect(foreign.acquireLease(id, h.rev(id), 10)).rejects.toThrow('domain-mismatch')
  await expect(foreign.releaseLease(id, h.rev(id))).rejects.toThrow('domain-mismatch')
  await expect(foreign.control(id, h.rev(id), 'paused')).rejects.toThrow('domain-mismatch')
  await expect(foreign.revokeApproval(approvalId)).rejects.toThrow('domain-mismatch')
  const action = await h.prepare(id)
  let entered!: () => void, release!: () => void
  const reached = new Promise<void>((resolve) => { entered = resolve })
  const pending = new Promise<void>((resolve) => { release = resolve })
  h.adapter.validate = async () => { entered(); await pending; return true }
  const admission = h.binding.admit(id, h.rev(id), action.id, input().parameters)
  await reached
  const mutation = foreign.control(id, h.rev(id), 'paused')
  const admissionResult = expect(admission).rejects.toThrow('adapter-unavailable')
  const mutationResult = expect(mutation).rejects.toThrow('adapter-unavailable')
  const closing = h.dispose()
  await Promise.resolve()
  release()
  await Promise.all([admissionResult, mutationResult, closing])
})

it('counts consecutive failures by durable send order even when preparation order and timestamps differ', async () => {
  const pool = new MemoryMediaPool(), h = await harness({ pool })
  const d = draft(); d.budget.maxConsecutiveFailures = 1
  const id = await h.setup(d)
  const fixed = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(fixed)
  const a = await h.prepare(id), b = await h.prepare(id, input('B'))
  await h.binding.execute(await h.binding.admit(id, h.rev(id), b.id, input('B').parameters))
  h.adapter.send = async () => ({ outcome: 'NOT_APPLIED', evidenceRefs: evidence })
  await h.binding.execute(await h.binding.admit(id, h.rev(id), a.id, input().parameters))
  const view = h.safety.snapshot(id)
  expect(view.execution.actions[0]?.sentAt).toBe(view.execution.actions[1]?.sentAt)
  expect(view.execution.actions[0]!.sentRevision).toBeGreaterThan(view.execution.actions[1]!.sentRevision!)
  expect(view.breaker).toBe('BLOCKED')
  await expect(h.prepare(id, input('C'))).rejects.toThrow('budget-exhausted')
  const source = structuredClone(pool.media.get('side_effect_safety')!.global as DurableState)
  for (const corrupt of [
    (state: DurableState) => { state.executions[0]!.actions[0]!.sentRevision = null },
    (state: DurableState) => { state.executions[0]!.actions[0]!.sentRevision = state.executions[0]!.revision + 1 },
    (state: DurableState) => { state.executions[0]!.actions[0]!.sentRevision = state.executions[0]!.actions[1]!.sentRevision },
  ]) {
    const state = structuredClone(source); corrupt(state)
    expect(() => { validateState(state, limits) }).toThrow('ledger-inconsistent')
  }
  await h.dispose()
  const restarted = await harness({ pool })
  expect(restarted.safety.snapshot(id).reasons).toContain('budget-exhausted')
  expect(restarted.adapter.send).not.toHaveBeenCalled()
})
