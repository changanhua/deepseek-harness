/** Durable, Host-only side-effect admission and recovery. @module @changanhua/dsh-side-effect-safety */
import { randomUUID } from 'node:crypto'
import { Context, Service, symbols } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { canonicalDigest } from '@changanhua/dsh-delivery-protocol'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-user-approval'
import {
  safetyDomain, validateState, fail, SafetyError, draftSchema, proofSchema, approvalSchema,
  actionSchema, executionSchema, intentInputSchema, settlementSchema, same, projection, budgetAllows,
} from './state.ts'
import type { DurableState } from './state.ts'
import type {
  Config, SafetyExecutionId, SafetyApprovalId, SafetyActionId, SafetyLeaseId, SafetyExecution,
  SafetyApproval, SafetyAction, SafetyAdapter, SafetyBinding, AdmittedAction, SafetySnapshot, Settlement,
} from './types.ts'
export type * from './types.ts'
export { SafetyError } from './state.ts'

declare module '@deepseek-ai/cordis' { interface Context { sideEffectSafety: SideEffectSafety } }
interface HandleRecord {
  binding: object
  executionId: SafetyExecutionId
  actionId: SafetyActionId
  revision: number
  leaseId: SafetyLeaseId
  parameters: unknown
  expiresAt: number
}
const hostBindings = new WeakMap<SideEffectSafety, (ctx: Context, domain: string, adapter: SafetyAdapter) => SafetyBinding>()
/**
 * Install a static Host adapter without publishing registration as a Cordis service method.
 * Dynamic Cordis's sandbox cannot import this module; its service proxy exposes no registration or settlement capability.
 * @param ctx - Trusted static plugin context; its lifecycle owns the adapter.
 * @param domain - Domain identity.
 * @param adapter - Human proof, policy, private sender and lookup-only inspector.
 * @returns the adapter-local execution capability.
 */
export function bindSafetyAdapter(ctx: Context, domain: string, adapter: SafetyAdapter): SafetyBinding {
  const service = ctx.sideEffectSafety
  const original = Reflect.get(service, symbols.original) as SideEffectSafety
  const bind = hostBindings.get(original)
  if (!bind) fail('host-binding-unavailable')
  return bind(ctx, domain, adapter)
}
const positive = () => s.number().min(1).step(1).required()

/** One Storage Domain writer owns all business leases and durable action records. */
export class SideEffectSafety extends Service {
  static inject = ['storageDomain']
  static Config: s<Config> = s.object({
    maxExecutions: positive(), maxApprovals: positive(), maxActionsPerExecution: positive(),
    maxRecordBytes: positive(), maxTotalBytes: positive(), maxEvidenceRefs: positive(), maxAdmissionMs: positive(),
  })
  #domain!: Domain<typeof safetyDomain>
  readonly #owner = randomUUID()
  readonly #handles = new WeakMap<object, HandleRecord>()
  readonly #bindings = new Set<string>()
  readonly #pending = new Set<Promise<unknown>>()
  #tail: Promise<void> = Promise.resolve()
  #closed = false

  readonly #config: Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'sideEffectSafety')
    this.#config = Object.freeze({ ...config })
    for (const method of ['snapshot'] as const) {
      Object.defineProperty(this, method, { value: this[method].bind(this), configurable: true })
    }
    hostBindings.set(this, (owner, domain, adapter) => this.#bindAdapter(owner, domain, adapter))
  }

  protected async [Service.init](): Promise<void> {
    this.#domain = await this.ctx.storageDomain.open(safetyDomain)
    this.ctx.effect(() => async () => {
      this.#closed = true
      await Promise.allSettled([...this.#pending])
      await this.#tail
      await this.#domain.close()
    }, 'sideEffectSafety.close')
    const state = structuredClone(this.#domain.global.get())
    validateState(state, this.#config)
    let changed = false
    for (const e of state.executions) {
      let recovered = false
      if (e.lease && !e.lease.released) { e.lease.released = true; recovered = true }
      for (const a of e.actions) {
        if (a.phase === 'SENT' || a.phase === 'RECONCILING') { a.phase = 'UNKNOWN'; recovered = true }
      }
      if (recovered) { e.revision++; changed = true }
    }
    if (changed) await this.#commit(state)
  }

  /**
   * Bind a trusted Host policy and private executor to one domain. Disposal invalidates its handles.
   * No tool, Remote method, or default adapter exports this authority to an Agent.
   * @param ctx - Owning plugin's lifecycle context.
   * @param domain - Domain identity fixed for this binding.
   * @param adapter - Trusted approval proof, policy, executor, and lookup-only readback.
   * @returns the binding-local admission and execution capability.
   */
  #bindAdapter(ctx: Context, domain: string, adapter: SafetyAdapter): SafetyBinding {
    if (this.#closed || this.#bindings.has(domain)) fail('adapter-unavailable')
    this.#bindings.add(domain)
    const token = {}, alive = { value: true }
    ctx.effect(() => () => { alive.value = false; this.#bindings.delete(domain) }, 'sideEffectSafety.adapter')
    const assertAlive = () => { if (!alive.value || this.#closed) fail('adapter-unavailable') }
    const owned = (state: DurableState, id: SafetyExecutionId, revision?: number) => {
      assertAlive()
      const e = this.#execution(state, id)
      if (e.domain !== domain) fail('domain-mismatch')
      if (revision !== undefined && e.revision !== revision) fail('revision-conflict')
      return e
    }
    const validate = async (state: DurableState, e: SafetyExecution, a: SafetyAction, parameters: unknown) => {
      this.#assertGate(state, e, a)
      if (canonicalDigest(parameters) !== a.parametersDigest) fail('payload-conflict')
      const approval = this.#approval(state, e.approvalArtifactId)
      let allowed = false
      try { allowed = await adapter.validate(structuredClone(a), structuredClone(approval), structuredClone(parameters)) }
      catch { fail('policy-unavailable') }
      if (!allowed) fail('policy-denied')
      assertAlive()
      // Clock and revocation checks are repeated after asynchronous policy resolution.
      this.#assertGate(state, e, a)
    }
    const binding: SafetyBinding = {
      createExecution: (...args) => this.#createExecution(...args, (state) => {
        assertAlive()
        if (this.#approval(state, args[0]).domain !== domain) fail('domain-mismatch')
      }),
      acquireLease: (...args) => this.#acquireLease(...args, (state) => { owned(state, args[0]) }),
      releaseLease: (...args) => this.#releaseLease(...args, (state) => { owned(state, args[0]) }),
      control: (...args) => this.#control(...args, (state) => { owned(state, args[0]) }),
      revokeApproval: (...args) => this.#revokeApproval(...args, (state) => {
        assertAlive()
        if (this.#approval(state, args[0]).domain !== domain) fail('domain-mismatch')
      }),
      approve: async (input, request) => {
        assertAlive()
        const draft = draftSchema.parse(structuredClone(input))
        if (draft.domain !== domain) fail('domain-mismatch')
        const digest = canonicalDigest(draft)
        const existing = this.#domain.global.get().approvals.find(a => a.approvedBy.draftDigest === digest)
        if (existing) {
          if (existing.revoked || existing.expiresAt <= Date.now()) fail('approval-invalid')
          return structuredClone(existing)
        }
        const approval = this.ctx.get('approval')
        if (!approval) fail('approval-unavailable')
        const outcome = await approval.request({ ...request,
          reason: `Activate side-effect approval ${digest}: ${JSON.stringify(draft)}` })
        if (outcome !== 'allowed-once') fail('approval-denied')
        const proof = proofSchema.parse(await adapter.confirmHuman(structuredClone(draft), request))
        if (proof.draftDigest !== digest || proof.evidenceRefs.length > this.#config.maxEvidenceRefs) fail('approval-proof-invalid')
        return this.#transaction((state) => {
          assertAlive()
          const prior = state.approvals.find(a => a.approvedBy.draftDigest === digest)
          if (prior) {
            if (prior.revoked || prior.expiresAt <= Date.now()) fail('approval-invalid')
            return structuredClone(prior)
          }
          if (draft.expiresAt <= Date.now()) fail('approval-invalid')
          const record = approvalSchema.parse({ ...draft, id: `approval-${randomUUID()}`,
            createdAt: Date.now(), approvedBy: proof, revoked: false })
          state.approvals.push(record)
          return structuredClone(record)
        })
      },
      prepare: (id, revision, input) => {
        const { parameters, ...fields } = structuredClone(input)
        const intent = intentInputSchema.parse(fields)
        const parametersDigest = canonicalDigest(parameters)
        const requestDigest = canonicalDigest({
          kind: intent.kind, targetRef: intent.targetRef, parametersDigest, riskCost: intent.riskCost,
        })
        return this.#transaction((state) => {
          const e = owned(state, id)
          const prior = e.actions.find(a => a.idempotencyKey === intent.idempotencyKey)
          if (prior) {
            if (prior.requestDigest !== requestDigest) {
              e.hardBlock = 'idempotency-conflict'; e.revision++; fail('idempotency-conflict')
            }
            return structuredClone(prior)
          }
          if (e.revision !== revision) fail('revision-conflict')
          this.#assertGate(state, e)
          if (!same(intent.targetRef, e.targetRef)) fail('target-mismatch')
          const record = actionSchema.parse({ ...intent, id: `action-${randomUUID()}`, executionId: e.id,
            domain, parametersDigest, requestDigest, approvalArtifactId: e.approvalArtifactId,
            phase: 'PREPARED', preparedAt: Date.now(), sentAt: null, sentRevision: null, settledAt: null, evidenceRefs: [] })
          if (!budgetAllows(e, this.#approval(state, e.approvalArtifactId), record.riskCost)) fail('budget-exceeded')
          e.actions.push(record); e.revision++
          return structuredClone(record)
        })
      },
      admit: (id, revision, actionId, input) => {
        const parameters = structuredClone(input)
        return this.#serialize(async () => {
          const state = this.#domain.global.get(), e = owned(state, id, revision), a = this.#action(e, actionId)
          await validate(state, e, a, parameters)
          const lease = e.lease as NonNullable<SafetyExecution['lease']>
          const handle = Object.freeze({ actionId }) as AdmittedAction
          this.#handles.set(handle, { binding: token, executionId: id, actionId, revision,
            leaseId: lease.id, parameters, expiresAt: Math.min(Date.now() + this.#config.maxAdmissionMs, lease.expiresAt) })
          return handle
        })
      },
      execute: (handle) => {
        assertAlive()
        const found = this.#handles.get(handle)
        if (!found || found.binding !== token) return Promise.reject(new SafetyError('invalid-admitted-handle'))
        this.#handles.delete(handle)
        const operation = (async () => {
          const started = await this.#serialize(async () => {
            const state = structuredClone(this.#domain.global.get())
            const e = owned(state, found.executionId, found.revision), a = this.#action(e, found.actionId)
            if (Date.now() >= found.expiresAt || e.lease?.id !== found.leaseId) fail('admission-expired')
            await validate(state, e, a, found.parameters)
            if (Date.now() >= found.expiresAt) fail('admission-expired')
            a.phase = 'SENT'; a.sentAt = Date.now(); a.sentRevision = ++e.revision
            await this.#commit(state)
            assertAlive()
            // Invoke while still owning the serial lane: no pause/revoke can interleave after SENT.
            let work: Promise<Settlement>
            try {
              work = Date.now() >= found.expiresAt || Date.now() >= this.#approval(state, e.approvalArtifactId).expiresAt
                ? Promise.resolve({ outcome: 'UNKNOWN', evidenceRefs: [] })
                : Promise.resolve(adapter.send(structuredClone(a), structuredClone(found.parameters)))
            }
            catch { work = Promise.resolve({ outcome: 'UNKNOWN', evidenceRefs: [] }) }
            return { action: structuredClone(a), work: work.catch(() => ({ outcome: 'UNKNOWN' as const, evidenceRefs: [] })) }
          })
          const result = await started.work
          return this.#settle(found.executionId, found.actionId, 'SENT', result)
        })()
        return this.#track(operation)
      },
      reconcile: (id, revision, actionId) => {
        const operation = (async () => {
          const action = await this.#transaction((state) => {
            const e = owned(state, id, revision), a = this.#action(e, actionId)
            if (a.phase !== 'UNKNOWN') fail('invalid-transition')
            a.phase = 'RECONCILING'; e.revision++
            return structuredClone(a)
          })
          let result: Settlement
          try { result = await adapter.inspect(action) }
          catch { result = { outcome: 'UNKNOWN', evidenceRefs: [] } }
          return this.#settle(id, actionId, 'RECONCILING', result)
        })()
        return this.#track(operation)
      },
    }
    return Object.freeze(binding)
  }

  /**
   * Freeze an execution against exactly one approved target and budget.
   * @param approvalId - Previously activated artifact identity.
   * @param idempotencyKey - Stable identity of this execution request.
   * @returns the existing identical execution or newly durable record.
   */
  #createExecution(approvalId: SafetyApprovalId, idempotencyKey: string,
    authorize: (state: DurableState) => void): Promise<SafetyExecution> {
    return this.#transaction((state) => {
      authorize(state)
      const a = this.#approval(state, approvalId), requestDigest = canonicalDigest({ approvalId })
      const prior = state.executions.find(e => e.idempotencyKey === idempotencyKey)
      if (prior) {
        if (prior.requestDigest !== requestDigest) { prior.hardBlock = 'idempotency-conflict'; prior.revision++; fail('idempotency-conflict') }
        return structuredClone(prior)
      }
      if (a.revoked || a.expiresAt <= Date.now()) fail('approval-invalid')
      // One artifact owns one risk budget; a second execution must never reset that budget.
      if (state.executions.some(e => e.approvalArtifactId === approvalId)) fail('approval-already-bound')
      const e = executionSchema.parse({ id: `execution-${randomUUID()}`, idempotencyKey, requestDigest,
        approvalArtifactId: approvalId, domain: a.domain, targetRef: a.subjectRef, revision: 0,
        createdAt: Date.now(), control: 'active', hardBlock: null, lease: null, actions: [] })
      state.executions.push(e)
      return structuredClone(e)
    })
  }

  /**
   * Acquire exclusive target ownership within this Host's durable store.
   * @param id - Execution identity.
   * @param expectedRevision - Last observed execution revision.
   * @param durationMs - Explicit lease window, bounded by approval expiry.
   * @returns the committed lease-bearing execution.
   */
  #acquireLease(id: SafetyExecutionId, expectedRevision: number, durationMs: number,
    authorize: (state: DurableState) => void): Promise<SafetyExecution> {
    return this.#transaction((state) => {
      authorize(state)
      const e = this.#cas(state, id, expectedRevision), a = this.#approval(state, e.approvalArtifactId), now = Date.now()
      if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || a.revoked || now < a.startsAt || now >= a.expiresAt
        || e.hardBlock || e.control !== 'active') fail('lease-denied')
      for (const other of state.executions) {
        if (other.domain !== e.domain || !same(other.targetRef, e.targetRef)) continue
        if (other.actions.some(action => ['SENT', 'UNKNOWN', 'RECONCILING'].includes(action.phase))) fail('unresolved-action')
        if (other.lease && !other.lease.released && other.lease.expiresAt > now) fail('target-leased')
      }
      e.lease = { id: brandString<SafetyLeaseId>(`lease-${randomUUID()}`), owner: this.#owner, executionId: e.id,
        approvalArtifactId: a.id, targetRef: structuredClone(e.targetRef), acquiredAt: now,
        expiresAt: Math.min(a.expiresAt, now + durationMs), released: false }
      e.revision++
      return structuredClone(e)
    })
  }

  /**
   * Release unsent authority; sent facts and unknown effects remain durable.
   * @param id - Execution identity.
   * @param revision - Expected revision.
   * @returns the updated execution.
   */
  #releaseLease(id: SafetyExecutionId, revision: number, authorize: (state: DurableState) => void): Promise<SafetyExecution> {
    return this.#transaction((state) => {
      authorize(state)
      const e = this.#cas(state, id, revision)
      if (e.lease) e.lease.released = true
      e.revision++
      return structuredClone(e)
    })
  }

  /**
   * Host kill switch; pause blocks new work, abort cancels only PREPARED actions.
   * @param id - Execution identity.
   * @param revision - Expected revision.
   * @param control - Requested control; abort and completion cannot be resumed.
   * @returns committed execution, retaining all possible external effects.
   */
  #control(id: SafetyExecutionId, revision: number, control: 'active' | 'paused' | 'aborted' | 'completed', authorize: (state: DurableState) => void): Promise<SafetyExecution> {
    return this.#transaction((state) => {
      authorize(state)
      const e = this.#cas(state, id, revision)
      if (e.control === 'aborted' || e.control === 'completed') fail('invalid-transition')
      if (control === 'completed' && (e.hardBlock || !e.actions.length
        || e.actions.some(a => !['CONFIRMED', 'NOT_APPLIED'].includes(a.phase)))) fail('completion-unverified')
      e.control = control
      if (control === 'aborted') for (const a of e.actions) if (a.phase === 'PREPARED') a.phase = 'CANCELLED'
      if ((control === 'aborted' || control === 'completed') && e.lease) e.lease.released = true
      e.revision++
      return structuredClone(e)
    })
  }

  /**
   * Revoke future use without erasing action history or stopping required readback.
   * @param id - Exact approved artifact identity.
   */
  #revokeApproval(id: SafetyApprovalId, authorize: (state: DurableState) => void): Promise<void> {
    return this.#transaction((state) => { authorize(state); this.#approval(state, id).revoked = true })
  }

  /**
   * Return detached committed state and a current-clock breaker projection.
   * @param id - Execution identity.
   * @returns bounded snapshot with no action payload or evidence bytes.
   */
  snapshot(id: SafetyExecutionId): SafetySnapshot {
    if (this.#closed) fail('closed')
    const state = this.#domain.global.get(), e = this.#execution(state, id)
    return projection(e, this.#approval(state, e.approvalArtifactId), Date.now(), this.#owner)
  }

  #assertGate(state: DurableState, e: SafetyExecution, action?: SafetyAction): void {
    const approval = this.#approval(state, e.approvalArtifactId)
    const view = projection(e, approval, Date.now(), this.#owner)
    if (!['READY', 'RUNNING'].includes(view.breaker) || e.control !== 'active') fail(view.reasons[0] ?? 'execution-not-active')
    if (state.executions.some(other => other.id !== e.id && other.domain === e.domain && same(other.targetRef, e.targetRef)
      && other.actions.some(a => ['SENT', 'UNKNOWN', 'RECONCILING'].includes(a.phase)))) fail('unresolved-action')
    if (action && (action.phase !== 'PREPARED' || !budgetAllows(e, approval, action.riskCost))) fail('action-not-admissible')
  }
  #execution(state: DurableState, id: SafetyExecutionId): SafetyExecution {
    return state.executions.find(e => e.id === id) ?? fail('execution-missing')
  }
  #approval(state: DurableState, id: SafetyApprovalId): SafetyApproval {
    return state.approvals.find(a => a.id === id) ?? fail('approval-missing')
  }
  #action(e: SafetyExecution, id: SafetyActionId): SafetyAction { return e.actions.find(a => a.id === id) ?? fail('action-missing') }
  #cas(state: DurableState, id: SafetyExecutionId, revision: number): SafetyExecution {
    const e = this.#execution(state, id)
    if (e.revision !== revision) fail('revision-conflict')
    return e
  }
  #settle(id: SafetyExecutionId, actionId: SafetyActionId, phase: 'SENT' | 'RECONCILING', input: Settlement): Promise<SafetyAction> {
    const parsed = settlementSchema.safeParse(input)
    const result = parsed.success && parsed.data.evidenceRefs.length <= this.#config.maxEvidenceRefs
      ? parsed.data : { outcome: 'UNKNOWN' as const, evidenceRefs: [] }
    return this.#transaction((state) => {
      const e = this.#execution(state, id), a = this.#action(e, actionId)
      if (a.phase !== phase) fail('invalid-transition')
      a.phase = result.outcome; a.evidenceRefs = structuredClone(result.evidenceRefs)
      a.settledAt = result.outcome === 'UNKNOWN' ? null : Date.now(); e.revision++
      return structuredClone(a)
    }, true)
  }
  #track<T>(operation: Promise<T>): Promise<T> {
    this.#pending.add(operation)
    void operation.then(() => this.#pending.delete(operation), () => this.#pending.delete(operation))
    return operation
  }
  #serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(work)
    this.#tail = result.then(() => {}, () => {})
    return result
  }
  #transaction<T>(change: (state: DurableState) => T, duringClose = false): Promise<T> {
    if (this.#closed && !duringClose) return Promise.reject(new SafetyError('closed'))
    return this.#serialize(async () => {
      const state = structuredClone(this.#domain.global.get())
      let result: T
      try { result = change(state) }
      catch (error) {
        if (error instanceof SafetyError && error.code === 'idempotency-conflict') await this.#commit(state)
        throw error
      }
      await this.#commit(state)
      return result
    })
  }
  async #commit(state: DurableState): Promise<void> {
    validateState(state, this.#config)
    await this.#domain.global.set(state)
  }
}
export default SideEffectSafety
