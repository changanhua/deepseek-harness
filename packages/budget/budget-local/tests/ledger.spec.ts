import { describe, expect, test } from 'vitest'
import { addScope, markDispatched, recoverLedger, releaseReservation, reserve, settle, snapshot } from '../src/ledger.ts'
import { emptyLedger } from '../src/schema.ts'

const limits = { requests: 2, inputTokens: 100, outputTokens: 100, totalTokens: 150, wallTimeMs: 1000 }
const root = () => addScope(emptyLedger(), { id: 'root', kind: 'workflow', subjectId: 'run', parentId: null, limits, onExhausted: 'deny' }, 100)
const call = (id: string) => ({ requestId: id, attemptId: '1', inputDigest: 'a'.repeat(64), inputTokens: 20, outputTokens: 30 })

describe('durable budget ledger', () => {
  test('reserves against all ancestors and does not count idempotent replay twice', () => {
    const state = addScope(root(), { id: 'child', kind: 'session', subjectId: 'session', parentId: 'root', limits: { ...limits, requests: 5 }, onExhausted: 'deny' }, 110)
    const first = reserve(state, 'child', call('a'), 120)
    expect(first.decision.kind).toBe('allow')
    expect(reserve(first.state, 'child', call('a'), 121).state).toEqual(first.state)
    const second = reserve(first.state, 'child', call('b'), 122)
    const denied = reserve(second.state, 'child', call('c'), 123)
    expect(denied.decision).toMatchObject({ kind: 'deny', reason: 'requests-exhausted', scopeId: 'root' })
    expect(snapshot(second.state, 'root', 123).reserved.requests).toBe(2)
  })

  test('rejects a reused request identity with changed input or scope', () => {
    const first = reserve(root(), 'root', call('a'), 120)
    expect(() => reserve(first.state, 'root', { ...call('a'), inputDigest: 'b'.repeat(64) }, 121)).toThrow(/conflict/u)
  })

  test('settles actual usage, releases only unsent work and rejects illegal transitions', () => {
    const first = reserve(root(), 'root', call('a'), 120)
    const dispatched = markDispatched(first.state, 'a', '1', 121)
    expect(() => releaseReservation(dispatched, 'a', '1')).toThrow(/dispatched/u)
    const done = settle(dispatched, 'a', '1', { inputTokens: 10, outputTokens: 8 })
    expect(snapshot(done, 'root', 125).consumed).toEqual({ requests: 1, inputTokens: 10, outputTokens: 8, totalTokens: 18 })
    expect(settle(done, 'a', '1', { inputTokens: 10, outputTokens: 8 })).toEqual(done)
    expect(() => settle(done, 'a', '1', { inputTokens: 9, outputTokens: 8 })).toThrow(/conflict/u)
    const next = reserve(done, 'root', call('b'), 126)
    const released = releaseReservation(next.state, 'b', '1')
    expect(snapshot(released, 'root', 127).reserved.requests).toBe(0)
    expect(() => markDispatched(released, 'b', '1', 128)).toThrow()
  })

  test('retains missing usage as unknown and refuses subsequent automatic dispatch', () => {
    const first = reserve(root(), 'root', call('a'), 120)
    const unknown = settle(markDispatched(first.state, 'a', '1', 121), 'a', '1', null)
    expect(snapshot(unknown, 'root', 125).unknownRequests).toBe(1)
    expect(reserve(unknown, 'root', call('b'), 126).decision).toMatchObject({ kind: 'pause', reason: 'usage-unknown' })
    expect(() => settle(unknown, 'a', '1', { inputTokens: 1, outputTokens: 1 })).toThrow(/reconcile/u)
  })

  test('restart releases pre-dispatch reservations but retains dispatched uncertainty', () => {
    const a = reserve(root(), 'root', call('a'), 120)
    const b = reserve(a.state, 'root', call('b'), 121)
    const state = markDispatched(b.state, 'a', '1', 122)
    const recovered = recoverLedger(JSON.parse(JSON.stringify(state)))
    expect(snapshot(recovered, 'root', 125)).toMatchObject({ unknownRequests: 1, reserved: { requests: 1 } })
    expect(recoverLedger(recovered)).toEqual(recovered)
  })

  test('honors wall clock and token ceilings before admitting a request', () => {
    expect(reserve(root(), 'root', call('a'), 1100).decision).toMatchObject({ kind: 'pause', reason: 'time-exhausted' })
    expect(reserve(root(), 'root', { ...call('a'), inputTokens: 101 }, 120).decision).toMatchObject({ reason: 'input-tokens-exhausted' })
    expect(reserve(root(), 'root', { ...call('a'), outputTokens: 101 }, 120).decision).toMatchObject({ reason: 'output-tokens-exhausted' })
    expect(reserve(root(), 'root', { ...call('a'), inputTokens: 80, outputTokens: 80 }, 120).decision).toMatchObject({ reason: 'total-tokens-exhausted' })
  })

  test('rejects invalid parent bindings, duplicate subjects and clock rollback', () => {
    expect(() => addScope(root(), { id: 'child', kind: 'goal', subjectId: 'goal', parentId: 'missing', limits, onExhausted: 'pause' }, 120)).toThrow(/parent/u)
    expect(() => addScope(root(), { id: 'other', kind: 'workflow', subjectId: 'run', parentId: null, limits, onExhausted: 'deny' }, 120)).toThrow(/subject/u)
    expect(reserve(root(), 'root', call('a'), 90).decision).toMatchObject({ kind: 'pause', reason: 'clock-regressed' })
  })

  test('rechecks expiry, revocation and newly unknown usage at the final dispatch claim', () => {
    const first = reserve(root(), 'root', call('a'), 120)
    expect(() => markDispatched(first.state, 'a', '1', 1100)).toThrow(/time/u)
    const revoked = structuredClone(first.state)
    revoked.scopes[0]!.revoked = true
    expect(() => markDispatched(revoked, 'a', '1', 121)).toThrow(/revoked/u)
    const second = reserve(first.state, 'root', call('b'), 121)
    const unknown = settle(markDispatched(second.state, 'a', '1', 122), 'a', '1', null)
    expect(() => markDispatched(unknown, 'b', '1', 123)).toThrow(/unknown/u)
  })
})
