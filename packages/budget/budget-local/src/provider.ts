import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import Budget, { BudgetError, budgetReferenceSchema, budgetRequestSchema, budgetScopeInputSchema, budgetUsageSchema } from '@changanhua/dsh-budget'
import type {
  BudgetApprover, BudgetAuthority, BudgetChunkObservation, BudgetDecisionRecord, BudgetReference, BudgetRequest, BudgetReservationView,
  BudgetScopeInput, BudgetSnapshot, BudgetSubject, BudgetSubjectResolver, BudgetUsage,
} from '@changanhua/dsh-budget'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { budgetLedgerSchema, emptyLedger } from './schema.ts'
import type { BudgetLedger } from './schema.ts'
import { addScope, assertDispatchAllowed, markDispatched, recoverLedger, reserve, settle, snapshot } from './ledger.ts'

const domainSpec = defineDomain({
  name: 'resource_budget', version: 1, layout: 'single',
  requires: ['single-writer', 'commit-sync', 'private-root'] as const,
  global: { schema: budgetLedgerSchema, initial: emptyLedger() }, tables: {},
})

/** Explicit capacity bounds for the authoritative local account. */
export interface Config { maxScopes: number; maxReservations: number; maxLedgerBytes: number }

function referenceOf(scope: BudgetSnapshot['scope']): BudgetReference {
  const { revoked: _revoked, ...definition } = scope
  return { id: scope.id, version: '1', digest: createHash('sha256').update(JSON.stringify(definition)).digest('hex') }
}

/** Single-writer persistent budget owner; reservations, usage and unknown outcomes share one atomic account. */
export class LocalBudget extends Budget {
  static inject = ['storageDomain']
  static Config: z<Config> = z.object({
    maxScopes: z.number().step(1).min(1).required(),
    maxReservations: z.number().step(1).min(1).required(),
    maxLedgerBytes: z.number().step(1).min(1024).required(),
  })
  private domain?: Domain<typeof domainSpec>
  private tail: Promise<unknown> = Promise.resolve()
  private closing = false
  private fault?: BudgetError
  private readonly scopes = new AsyncLocalStorage<readonly BudgetReference[]>()
  private readonly resolvers = new Map<string, BudgetSubjectResolver>()
  private readonly requiredResolvers = new Set<string>()
  private resolverGeneration = 0
  private approver: { callback: BudgetApprover } | undefined
  private readonly shutdown = new AbortController()
  private readonly calls = new Map<string, Promise<void>>()

  private readonly config: Config
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = LocalBudget.Config(config)
    this.ctx.effect(() => async () => {
      this.closing = true
      this.shutdown.abort(new BudgetError('BUDGET_CLOSED', 'Budget owner is closing'))
      await Promise.allSettled([...this.calls.values()])
      await this.tail
      await this.domain?.close()
      this.resolvers.clear()
      this.scopes.disable()
    }, 'budget.close()')
  }

  protected async [Service.init](): Promise<void> {
    this.domain = await this.ctx.storageDomain.open(domainSpec)
    const before = this.domain.global.get()
    const recovered = recoverLedger(before)
    if (JSON.stringify(before) !== JSON.stringify(recovered)) await this.domain.global.set(recovered)
  }

  private current(): BudgetLedger {
    if (!this.domain || this.closing) throw new BudgetError('BUDGET_UNAVAILABLE', 'Budget owner is unavailable')
    if (this.fault) throw new BudgetError('BUDGET_STORAGE_UNKNOWN', 'Budget persistence requires recovery')
    return this.domain.global.get()
  }

  private mutate<T>(operation: (state: BudgetLedger) => { state: BudgetLedger
    value: T } | Promise<{ state: BudgetLedger; value: T }>, cleanup = false): Promise<T> {
    const task = this.tail.then(async () => {
      if (!this.domain || this.fault || (this.closing && !cleanup)) throw new BudgetError('BUDGET_UNAVAILABLE', 'Budget owner cannot commit')
      const before = this.domain.global.get()
      const result = await operation(before)
      const next = budgetLedgerSchema.parse(result.state)
      if (next.scopes.length > this.config.maxScopes || next.reservations.length > this.config.maxReservations
        || next.decisions.length > this.config.maxReservations
        || ledgerCapacityBytes(next) > this.config.maxLedgerBytes) {
        throw new BudgetError('BUDGET_CAPACITY', 'Budget account capacity exceeded')
      }
      if (JSON.stringify(before) !== JSON.stringify(next)) {
        try { await this.domain.global.set(next) }
        catch (_error) {
          this.fault = new BudgetError('BUDGET_STORAGE_UNKNOWN', 'Budget commit outcome requires recovery')
          throw this.fault
        }
      }
      return result.value
    })
    this.tail = task.then(() => {}, () => {})
    return task
  }

  async createScope(input: BudgetScopeInput, authorize: BudgetAuthority): Promise<BudgetSnapshot> {
    const parsed = budgetScopeInputSchema.parse(input)
    if (typeof authorize !== 'function') throw new BudgetError('BUDGET_AUTHORITY_REQUIRED', 'A trusted budget authority is required')
    await this.mutate(async (state) => {
      await authorize()
      return { state: addScope(state, parsed, Date.now()), value: undefined }
    })
    return this.inspect(parsed.id)
  }

  inspect(reference: BudgetReference | string): BudgetSnapshot {
    const view = snapshot(this.current(), typeof reference === 'string' ? reference : reference.id, Date.now())
    const actual = referenceOf(view.scope)
    if (typeof reference !== 'string' && (!budgetReferenceSchema.safeParse(reference).success || reference.digest !== actual.digest)) {
      throw new BudgetError('BUDGET_REFERENCE_CONFLICT', 'Budget authorization reference changed')
    }
    return { ...view, reference: actual }
  }

  scopeFor(subject: BudgetSubject): BudgetSnapshot | undefined {
    const scope = this.current().scopes.find(row => row.kind === subject.kind && row.subjectId === subject.id)
    return scope ? this.inspect(scope.id) : undefined
  }

  async revoke(scopeId: string, authorize: BudgetAuthority): Promise<void> {
    if (typeof authorize !== 'function') throw new BudgetError('BUDGET_AUTHORITY_REQUIRED', 'A trusted budget authority is required')
    await this.mutate(async (state) => {
      await authorize()
      const next = structuredClone(state)
      const scope = next.scopes.find(value => value.id === scopeId)
      if (!scope) throw new BudgetError('BUDGET_SCOPE_MISSING', 'Budget scope is unavailable')
      scope.revoked = true
      return { state: next, value: undefined }
    })
  }

  reservation(requestId: string, attemptId: string): BudgetReservationView | undefined {
    return structuredClone(this.current().reservations.find(row => row.request.requestId === requestId
      && row.request.attemptId === attemptId))
  }

  decision(requestId: string, attemptId: string): BudgetDecisionRecord | undefined {
    return structuredClone(this.current().decisions.find(row => row.request.requestId === requestId && row.request.attemptId === attemptId))
  }

  registerApprover(approver: BudgetApprover): () => void {
    if (this.approver) throw new BudgetError('BUDGET_APPROVER_CONFLICT', 'Budget approver already registered')
    const registration = { callback: approver }
    this.approver = registration
    const dispose = this.ctx.effect(() => () => { if (this.approver === registration) this.approver = undefined }, 'budget.approver()')
    return () => { void dispose() }
  }

  private async admit(scope: { id: string; generation: number }, request: ReturnType<typeof budgetRequestSchema.parse>,
    signal: AbortSignal) {
    const initial = await this.mutate((state) => {
      signal.throwIfAborted()
      if (scope.generation !== this.resolverGeneration) throw new BudgetError('BUDGET_CONTEXT_CHANGED', 'Budget context was revoked')
      const prior = state.decisions.find(row => row.request.requestId === request.requestId && row.request.attemptId === request.attemptId)
      if (prior) {
        if (prior.scopeId !== scope.id || JSON.stringify(prior.request) !== JSON.stringify(request)) throw new BudgetError('BUDGET_REQUEST_CONFLICT', 'Budget attempt input changed')
        throw new BudgetError('BUDGET_ATTEMPT_REPLAY', 'Budget attempt already has a retained decision')
      }
      const now = Date.now()
      const result = reserve(state, scope.id, request, now)
      const ids: string[] = []
      let cursor: string | null = scope.id
      while (cursor !== null) {
        ids.push(cursor)
        const parent = state.scopes.find(row => row.id === cursor)
        if (!parent) throw new BudgetError('BUDGET_SCOPE_MISSING', 'Budget ancestor is unavailable')
        cursor = parent.parentId
      }
      const snapshots = ids.map(id => this.inspect(id))
      const record = { request, scopeId: scope.id, kind: result.decision.kind,
        reason: result.decision.kind === 'allow' ? 'within-limits' : result.decision.reason, createdAt: now,
        approval: result.decision.kind === 'ask' ? 'pending' as const : null, snapshots }
      return { state: { ...result.state, decisions: [...result.state.decisions, record] }, value: result.decision }
    })
    if (initial.kind !== 'ask') return initial
    const approver = this.approver
    let outcome: Awaited<ReturnType<BudgetApprover>> = 'unavailable'
    if (approver) {
      try { outcome = await approver.callback({ request: structuredClone(request),
        scopes: initial.exceptionScopes.map(id => this.inspect(id)) }, signal) }
      catch { outcome = signal.aborted ? 'cancelled' : 'unavailable' }
    }
    if (signal.aborted) outcome = 'cancelled'
    if (approver !== this.approver || !['allowed-once', 'rejected', 'cancelled', 'unavailable'].includes(outcome)) outcome = 'unavailable'
    const final = await this.mutate((state) => {
      const next = structuredClone(state)
      const record = next.decisions.find(row => row.request.requestId === request.requestId && row.request.attemptId === request.attemptId)
      if (!record) throw new BudgetError('BUDGET_ATTEMPT_REPLAY', 'Budget approval decision is unavailable')
      record.approval = outcome
      if (outcome !== 'allowed-once' || scope.generation !== this.resolverGeneration || signal.aborted) {
        record.kind = outcome === 'rejected' ? 'deny' : 'pause'
        record.reason = `approval-${outcome === 'allowed-once' ? 'context-changed' : outcome}`
        return { state: next, value: { kind: record.kind, reason: record.reason, scopeId: scope.id, exceptionScopes: [] } }
      }
      const result = reserve(next, scope.id, request, Date.now(), initial.exceptionScopes)
      record.kind = result.decision.kind === 'ask' ? 'pause' : result.decision.kind
      record.reason = result.decision.kind === 'allow' ? 'approved-once' : result.decision.reason
      return { state: result.state, value: result.decision }
    }, true)
    if (outcome !== 'allowed-once') throw new BudgetError(outcome === 'rejected' ? 'BUDGET_APPROVAL_REJECTED' : 'BUDGET_APPROVAL_UNAVAILABLE', `Budget approval ${outcome}`)
    return final
  }

  async reconcile(requestId: string, attemptId: string, usage: BudgetUsage, authorize: BudgetAuthority): Promise<void> {
    const parsed = budgetUsageSchema.parse(usage)
    if (typeof authorize !== 'function') throw new BudgetError('BUDGET_AUTHORITY_REQUIRED', 'A trusted budget authority is required')
    await this.mutate(async (state) => {
      await authorize()
      const next = structuredClone(state)
      const row = next.reservations.find(value => value.request.requestId === requestId && value.request.attemptId === attemptId)
      if (!row || row.phase !== 'unknown') throw new BudgetError('BUDGET_RECONCILE_CONFLICT', 'Only an unknown reservation can be reconciled')
      row.phase = 'settled'
      row.usage = parsed
      return { state: next, value: undefined }
    })
  }

  registerSubjectResolver(owner: string, resolver: BudgetSubjectResolver): () => void {
    if (this.resolvers.has(owner)) throw new BudgetError('BUDGET_RESOLVER_CONFLICT', 'Budget context resolver already registered')
    this.resolvers.set(owner, resolver)
    this.requiredResolvers.add(owner)
    this.resolverGeneration++
    const dispose = this.ctx.effect(() => () => {
      if (this.resolvers.get(owner) === resolver) { this.resolvers.delete(owner); this.resolverGeneration++ }
    }, 'budget.subjectResolver()')
    return () => { void dispose() }
  }

  async withScope<T>(reference: BudgetReference, operation: () => Promise<T>): Promise<T> {
    this.inspect(reference)
    return await this.scopes.run([...(this.scopes.getStore() ?? []), structuredClone(reference)], operation)
  }

  private async modelScope(): Promise<{ id: string; generation: number }> {
    if ([...this.requiredResolvers].some(owner => !this.resolvers.has(owner))) throw new BudgetError('BUDGET_CONTEXT_CHANGED', 'A required budget context owner is unavailable')
    const generation = this.resolverGeneration
    const ids = (this.scopes.getStore() ?? []).map(reference => this.inspect(reference).scope.id)
    for (const resolver of this.resolvers.values()) {
      for (const subject of await resolver()) {
        const scope = this.current().scopes.find(value => value.kind === subject.kind && value.subjectId === subject.id)
        if (scope) ids.push(scope.id)
      }
    }
    if (generation !== this.resolverGeneration) throw new BudgetError('BUDGET_CONTEXT_CHANGED', 'Budget context changed during resolution')
    if (ids.length === 0) throw new BudgetError('BUDGET_SCOPE_MISSING', 'No Host-authorized budget scope is bound')
    const state = this.current()
    const ancestors = (id: string): string[] => {
      const result: string[] = []
      let scope = state.scopes.find(value => value.id === id)
      while (scope) { result.push(scope.id); scope = state.scopes.find(value => value.id === scope?.parentId) }
      return result
    }
    const selected = ids.map(ancestors).sort((a, b) => b.length - a.length)[0]
    if (!selected?.[0] || ids.some(id => !selected.includes(id))) {
      throw new BudgetError('BUDGET_CONTEXT_CONFLICT', 'Active budget scopes do not share one parent chain')
    }
    return { id: selected[0], generation }
  }

  /**
   * Reserve, dispatch once and settle the complete provider stream under the current scope chain.
   * @param input - Request identity and bounded input/output reservation, validated before admission.
   * @param dispatch - Actual provider call, invoked only after durable admission and freshness checks.
   * @param observe - Chunk usage and terminal-state projection.
   * @param signal - Caller cancellation combined with scope deadlines and disposal.
   * @returns Provider chunks; terminal publication waits for durable accounting.
   */
  async * streamModel<T>(
    input: BudgetRequest, dispatch: (signal: AbortSignal) => AsyncIterable<T>,
    observe: (chunk: T) => BudgetChunkObservation, signal?: AbortSignal,
  ): AsyncIterable<T> {
    const request = budgetRequestSchema.parse(input)
    const key = JSON.stringify([request.requestId, request.attemptId])
    if (this.calls.has(key)) throw new BudgetError('BUDGET_ATTEMPT_BUSY', 'Budget attempt is already active')
    const completion = Promise.withResolvers<void>()
    this.calls.set(key, completion.promise)
    let owned = false
    let invoked = false
    let settled = false
    let usage: BudgetUsage | null = null
    let terminal: { chunk: T } | undefined
    const releaseUnsent = () => this.mutate((state) => {
      const next = structuredClone(state)
      const row = next.reservations.find(value => value.request.requestId === request.requestId
        && value.request.attemptId === request.attemptId)
      if (!row || (row.phase !== 'reserved' && row.phase !== 'dispatched')) throw new BudgetError('BUDGET_RELEASE_CONFLICT', 'Budget attempt cannot be released')
      row.phase = 'released'
      return { state: next, value: undefined }
    }, true)
    try {
      signal?.throwIfAborted()
      const scope = await this.modelScope()
      const deadline = this.inspect(scope.id).deadline
      const remaining = deadline === null ? null : deadline - Date.now()
      const admissionSignal = AbortSignal.any([this.shutdown.signal, ...(signal ? [signal] : []),
        ...(remaining !== null ? [AbortSignal.timeout(Math.max(0, Math.min(remaining, 2_147_483_647)))] : [])])
      const decision = await this.admit(scope, request, admissionSignal)
      if (decision.kind !== 'allow') {
        throw new BudgetError(decision.kind === 'ask' ? 'BUDGET_APPROVAL_REQUIRED' : 'BUDGET_EXHAUSTED', decision.reason)
      }
      if (decision.phase !== 'reserved') throw new BudgetError('BUDGET_ATTEMPT_REPLAY', 'Budget attempt already has a retained outcome')
      owned = true
      const signals = [this.shutdown.signal, ...(signal ? [signal] : [])]
      if (decision.deadline !== null) {
        const remaining = decision.deadline - Date.now()
        if (remaining <= 0) throw new BudgetError('BUDGET_EXHAUSTED', 'time-exhausted')
        signals.push(AbortSignal.timeout(Math.min(remaining, 2_147_483_647)))
      }
      const combined = AbortSignal.any(signals)
      combined.throwIfAborted()
      await this.mutate((state) => {
        if (scope.generation !== this.resolverGeneration) throw new BudgetError('BUDGET_CONTEXT_CHANGED', 'Budget context was revoked')
        return { state: markDispatched(state, request.requestId, request.attemptId, Date.now()), value: undefined }
      })
      const fresh = await this.modelScope()
      if (fresh.id !== scope.id || fresh.generation !== scope.generation) throw new BudgetError('BUDGET_CONTEXT_CHANGED', 'Budget caller changed before dispatch')
      combined.throwIfAborted()
      try { assertDispatchAllowed(this.current(), request.requestId, request.attemptId, Date.now()) }
      catch { throw new BudgetError('BUDGET_EXHAUSTED', 'Budget no longer permits dispatch') }
      invoked = true
      for await (const chunk of dispatch(combined)) {
        if (terminal) throw new BudgetError('BUDGET_STREAM_PROTOCOL', 'Provider emitted output after its terminal chunk')
        const observation = observe(chunk)
        if (observation.usage !== undefined) {
          usage = null
          if (observation.usage !== null) usage = budgetUsageSchema.parse(observation.usage)
        }
        if (observation.terminal) terminal = { chunk }
        else yield chunk
      }
      await this.mutate(state => ({ state: settle(state, request.requestId, request.attemptId, usage), value: undefined }), true)
      settled = true
      if (terminal) yield terminal.chunk
    } finally {
      try {
        if (owned && !settled && !this.fault) {
          if (!invoked) await releaseUnsent()
          else await this.mutate(state => ({ state: settle(state, request.requestId, request.attemptId, usage), value: undefined }), true)
        }
      } finally { this.calls.delete(key); completion.resolve() }
    }
  }
}

export default LocalBudget

/** Reserve storage for a terminal receipt before admitting a call, including maximum safe usage counters. */
function ledgerCapacityBytes(state: BudgetLedger): number {
  const projected = {
    ...state,
    lastClock: Number.MAX_SAFE_INTEGER,
    decisions: state.decisions.map(row => ({ ...row, reason: 'x'.repeat(128), kind: 'pause', approval: 'allowed-once' })),
    reservations: state.reservations.map(row => row.phase === 'settled' || row.phase === 'released' ? row : {
      ...row, phase: 'dispatched', usage: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: Number.MAX_SAFE_INTEGER },
    }),
  }
  return Buffer.byteLength(JSON.stringify(projected))
}
