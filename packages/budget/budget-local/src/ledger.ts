import { budgetRequestSchema, budgetScopeInputSchema, budgetUsageSchema } from '@changanhua/dsh-budget'
import type { BudgetUsage } from '@changanhua/dsh-budget'
import { budgetLedgerSchema } from './schema.ts'
import type { BudgetLedger } from './schema.ts'

type Scope = BudgetLedger['scopes'][number]
type Reservation = BudgetLedger['reservations'][number]
type Totals = { requests: number; inputTokens: number; outputTokens: number; totalTokens: number }
type Refusal = { kind: 'deny' | 'pause' | 'ask'; reason: string; scopeId: string; exceptionScopes: string[] }
type Decision = { kind: 'allow'; scopeId: string; deadline: number | null; phase: Reservation['phase'] } | Refusal

function scopeOf(state: BudgetLedger, id: string): Scope {
  const scope = state.scopes.find(value => value.id === id)
  if (!scope) throw new Error('budget scope is unavailable')
  return scope
}

function chain(state: BudgetLedger, id: string): Scope[] {
  const result: Scope[] = []
  let cursor: string | null = id
  while (cursor !== null) {
    if (result.some(value => value.id === cursor)) throw new Error('budget parent cycle')
    const scope = scopeOf(state, cursor)
    result.push(scope)
    cursor = scope.parentId
  }
  return result
}

function rowOf(state: BudgetLedger, requestId: string, attemptId: string): Reservation {
  const row = state.reservations.find(value => value.request.requestId === requestId && value.request.attemptId === attemptId)
  if (!row) throw new Error('budget reservation is unavailable')
  return row
}

function amount(usage: BudgetUsage): Totals {
  const totalTokens = usage.inputTokens + usage.outputTokens
  if (!Number.isSafeInteger(totalTokens)) throw new Error('budget Token total overflow')
  return { requests: 1, ...usage, totalTokens }
}

function add(target: Totals, value: Totals): void {
  for (const key of ['requests', 'inputTokens', 'outputTokens', 'totalTokens'] as const) {
    target[key] += value[key]
    if (!Number.isSafeInteger(target[key])) throw new Error('budget aggregate overflow')
  }
}

function deadlineOf(scopes: Scope[]): number | null {
  const values = scopes.flatMap(scope => scope.limits.wallTimeMs === null ? [] : [scope.createdAt + scope.limits.wallTimeMs])
  return values.length === 0 ? null : Math.min(...values)
}

/** Read usage derived from immutable scope ancestry and retained reservations. */
export function snapshot(state: BudgetLedger, scopeId: string, now: number): {
  scope: Scope
  consumed: Totals
  reserved: Totals
  unknownRequests: number
  deadline: number | null
  remainingMs: number | null
} {
  const scopes = chain(state, scopeId)
  const consumed: Totals = { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  const reserved: Totals = { ...consumed }
  let unknownRequests = 0
  for (const row of state.reservations) {
    if (!chain(state, row.scopeId).some(value => value.id === scopeId) || row.phase === 'released') continue
    if (row.phase === 'settled' && row.usage !== null) add(consumed, amount(row.usage))
    else {
      add(reserved, amount({ inputTokens: row.request.inputTokens, outputTokens: row.request.outputTokens }))
      if (row.phase === 'unknown') unknownRequests++
    }
  }
  const deadline = deadlineOf(scopes)
  return { scope: structuredClone(scopeOf(state, scopeId)), consumed, reserved, unknownRequests, deadline,
    remainingMs: deadline === null ? null : Math.max(0, deadline - now) }
}

/** Add immutable Host-approved limits; parent changes and subject rebinding require a new explicit design. */
export function addScope(state: BudgetLedger, input: unknown, now: number): BudgetLedger {
  const parsed = budgetScopeInputSchema.parse(input)
  const existing = state.scopes.find(scope => scope.id === parsed.id)
  if (existing) {
    const { createdAt: _created, revoked: _revoked, ...definition } = existing
    if (JSON.stringify(definition) !== JSON.stringify(parsed)) throw new Error('budget scope conflict')
    return state
  }
  if (state.scopes.some(scope => scope.kind === parsed.kind && scope.subjectId === parsed.subjectId)) {
    throw new Error('budget subject already has a scope')
  }
  if (parsed.parentId !== null && !state.scopes.some(scope => scope.id === parsed.parentId)) throw new Error('budget parent is unavailable')
  return budgetLedgerSchema.parse({ ...state, lastClock: Math.max(state.lastClock, now),
    scopes: [...state.scopes, { ...parsed, createdAt: now, revoked: false }] })
}

/** Reserve one request against every ancestor; the Provider must durably commit before dispatch. */
export function reserve(state: BudgetLedger, scopeId: string, input: unknown, now: number,
  approvedScopes: readonly string[] = []): { state: BudgetLedger; decision: Decision } {
  const request = budgetRequestSchema.parse(input)
  const scopes = chain(state, scopeId)
  const previous = state.reservations.find(row => row.request.requestId === request.requestId
    && row.request.attemptId === request.attemptId)
  if (previous) {
    if (previous.scopeId !== scopeId || JSON.stringify(previous.request) !== JSON.stringify(request)) throw new Error('budget request conflict')
    return { state, decision: { kind: 'allow', scopeId, deadline: deadlineOf(scopes), phase: previous.phase } }
  }
  const refuse = (kind: Refusal['kind'], reason: string, id: string): { state: BudgetLedger; decision: Refusal } =>
    ({ state, decision: { kind, reason, scopeId: id, exceptionScopes: [] } })
  if (!Number.isSafeInteger(now) || now < state.lastClock) return refuse('pause', 'clock-regressed', scopeId)
  const requested = amount({ inputTokens: request.inputTokens, outputTokens: request.outputTokens })
  const questions: string[] = []
  for (const id of approvedScopes) {
    if (!scopes.some(scope => scope.id === id && scope.onExhausted === 'ask')) throw new Error('invalid budget exception')
  }
  for (const scope of scopes) {
    const view = snapshot(state, scope.id, now)
    if (scope.revoked) return refuse('deny', 'scope-revoked', scope.id)
    if (view.unknownRequests > 0) return refuse('pause', 'usage-unknown', scope.id)
    if (view.remainingMs !== null && view.remainingMs <= 0) return refuse('pause', 'time-exhausted', scope.id)
    for (const [key, reason] of [
      ['requests', 'requests-exhausted'], ['inputTokens', 'input-tokens-exhausted'],
      ['outputTokens', 'output-tokens-exhausted'], ['totalTokens', 'total-tokens-exhausted'],
    ] as const) {
      const ceiling = scope.limits[key]
      const excepted = exceptionUsage(state, scope.id)[key]
      if (ceiling !== null
        && view.consumed[key] + view.reserved[key] - excepted + (approvedScopes.includes(scope.id) ? 0 : requested[key]) > ceiling) {
        if (scope.onExhausted !== 'ask') return refuse(scope.onExhausted, reason, scope.id)
        if (!questions.includes(scope.id)) questions.push(scope.id)
      }
    }
  }
  const firstQuestion = questions[0]
  if (firstQuestion !== undefined) return { state, decision: { kind: 'ask', reason: 'resource-exhausted', scopeId: firstQuestion, exceptionScopes: questions } }
  const next: BudgetLedger = { ...state, lastClock: now,
    reservations: [...state.reservations, { scopeId, request, phase: 'reserved', usage: null, createdAt: now, exceptionScopes: [...approvedScopes] }] }
  return { state: next, decision: { kind: 'allow', scopeId, deadline: deadlineOf(scopes), phase: 'reserved' } }
}

/** Claim dispatch exactly once; a replay of the dispatched state cannot issue another Provider call. */
export function markDispatched(state: BudgetLedger, requestId: string, attemptId: string, now: number): BudgetLedger {
  const next = structuredClone(state)
  const row = rowOf(next, requestId, attemptId)
  if (row.phase !== 'reserved') throw new Error('budget request already dispatched or released')
  assertDispatchAllowed(next, requestId, attemptId, now)
  next.lastClock = now
  row.phase = 'dispatched'
  return next
}

/** Recheck current resource policy immediately before calling a Provider, including after the durable claim. */
export function assertDispatchAllowed(state: BudgetLedger, requestId: string, attemptId: string, now: number): void {
  const row = rowOf(state, requestId, attemptId)
  if (row.phase !== 'reserved' && row.phase !== 'dispatched') throw new Error('budget attempt is no longer dispatchable')
  if (!Number.isSafeInteger(now) || now < state.lastClock) throw new Error('budget clock regressed before dispatch')
  for (const scope of chain(state, row.scopeId)) {
    const view = snapshot(state, scope.id, now)
    if (scope.revoked) throw new Error('budget scope revoked before dispatch')
    if (view.unknownRequests > 0) throw new Error('budget usage unknown before dispatch')
    if (view.remainingMs !== null && view.remainingMs <= 0) throw new Error('budget time exhausted before dispatch')
    for (const key of ['requests', 'inputTokens', 'outputTokens', 'totalTokens'] as const) {
      const ceiling = scope.limits[key]
      if (ceiling !== null && view.consumed[key] + view.reserved[key] - exceptionUsage(state, scope.id)[key] > ceiling) throw new Error('budget ceiling exceeded before dispatch')
    }
  }
}

/** Release only a request proven not dispatched; repeated releases are idempotent. */
export function releaseReservation(state: BudgetLedger, requestId: string, attemptId: string): BudgetLedger {
  const next = structuredClone(state)
  const row = rowOf(next, requestId, attemptId)
  if (row.phase !== 'reserved' && row.phase !== 'released') throw new Error('cannot release dispatched budget')
  row.phase = 'released'
  return next
}

/** Settle exact actual usage; missing usage holds the reservation and requires explicit reconciliation. */
export function settle(state: BudgetLedger, requestId: string, attemptId: string, input: BudgetUsage | null): BudgetLedger {
  const usage = input === null ? null : budgetUsageSchema.parse(input)
  const next = structuredClone(state)
  const row = rowOf(next, requestId, attemptId)
  if (row.phase === 'settled') {
    if (JSON.stringify(row.usage) !== JSON.stringify(usage)) throw new Error('budget settlement conflict')
    return state
  }
  if (row.phase === 'unknown') throw new Error('unknown budget requires operator reconcile')
  if (row.phase !== 'dispatched') throw new Error('budget request was not dispatched')
  row.usage = usage
  row.phase = usage === null ? 'unknown' : 'settled'
  return next
}

/** Fold a restart without issuing work: unsent reservations release, dispatched ones remain uncertain. */
export function recoverLedger(input: unknown): BudgetLedger {
  const state = budgetLedgerSchema.parse(input)
  for (const row of state.reservations) {
    if (row.phase === 'reserved') row.phase = 'released'
    else if (row.phase === 'dispatched') row.phase = 'unknown'
  }
  for (const decision of state.decisions) {
    if (decision.approval === 'pending') { decision.approval = 'unavailable'; decision.kind = 'pause'; decision.reason = 'approval-interrupted' }
  }
  return state
}

/** A one-call exception cannot donate unused tokens to a later request or hide an actual overrun. */
function exceptionUsage(state: BudgetLedger, scopeId: string): Totals {
  const result: Totals = { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  for (const row of state.reservations) {
    if (row.phase === 'released' || !row.exceptionScopes.includes(scopeId)) continue
    const ceiling = amount(row.request)
    const actual = row.usage === null ? ceiling : amount(row.usage)
    add(result, { requests: 1, inputTokens: Math.min(ceiling.inputTokens, actual.inputTokens),
      outputTokens: Math.min(ceiling.outputTokens, actual.outputTokens), totalTokens: Math.min(ceiling.totalTokens, actual.totalTokens) })
  }
  return result
}
