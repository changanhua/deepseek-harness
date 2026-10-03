import { expect, test } from 'vitest'
import { createRoleObserver, createRoleReporter } from '../src/observer.ts'

test('accepts locked-core observations and refuses forged, changed, replayed or cross-role frames', () => {
  const host = createRoleObserver('subject-1', 'session-1')
  const core = createRoleReporter(host.bootstrap)
  const frame = core({ sequence: 1, kind: 'ready', value: { sessionId: 'session-1', skills: [{ id: 'skill', digest: 'actual-v2' }] } })
  expect(host.accept(frame)).toEqual({ sequence: 1, kind: 'ready', value: { sessionId: 'session-1', skills: [{ id: 'skill', digest: 'actual-v2' }] } })
  expect(() => host.accept(frame)).toThrow('observer-replay')
  expect(() => host.accept({ sequence: 2, kind: 'complete', value: { flushed: true } })).toThrow('observer-signature')
  const next = core({ sequence: 2, kind: 'complete', value: { sessionId: 'session-1', flushed: true } })
  expect(() => host.accept({ ...next, kind: 'ready' })).toThrow('observer-signature')
  const other = createRoleObserver('grader-1', 'session-2')
  expect(() => other.accept(next)).toThrow('observer-signature')
  expect(host.accept(next).kind).toBe('complete')
  const response = host.respond({ sequence: 2, kind: 'complete-result', value: null })
  expect(core.acceptResponse(response)).toEqual({ sequence: 2, kind: 'complete-result', value: null })
  expect(() => core.acceptResponse({ sequence: 2, kind: 'complete-result', value: { payload: 'forged', mac: 'a'.repeat(64) } })).toThrow('observer-signature')
  expect(() => core.acceptResponse(next)).toThrow('observer-signature')
  expect(JSON.stringify(host)).not.toContain('secret')
})
