import { describe, expect, it } from 'vitest'
import { PlanningError } from '../../planning/src/errors.ts'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { planningRemoteFailure, requirePlanningActive } from '../src/failures.ts'

describe('planning browser failure contract', () => {
  it('preserves conflict and access classifications without exposing host diagnostics', () => {
    for (const [domain, code] of [
      ['conflict', 'conflict'],
      ['idempotency-conflict', 'conflict'],
      ['unauthorized', 'denied'],
      ['not-found', 'not-found'],
      ['invalid-reference', 'bad-request'],
      ['capacity-exceeded', 'capacity-exceeded'],
      ['source-unavailable', 'unavailable'],
      ['closed', 'unavailable'],
    ] as const) {
      const failure = planningRemoteFailure(new PlanningError(domain, 'PRIVATE_HOST_DIAGNOSTIC')).failure
      expect(failure.code).toBe(code)
      expect(JSON.stringify(failure)).not.toContain('PRIVATE_HOST_DIAGNOSTIC')
    }
  })

  it('reports cancellation before any domain access and sanitizes its reason', () => {
    const controller = new AbortController()
    controller.abort('PRIVATE_ABORT_REASON')
    expect(() => {
      requirePlanningActive(controller.signal)
    }).toThrow(TypertRemoteFailure)
    const failure = planningRemoteFailure(new Error('PRIVATE_HOST_DIAGNOSTIC'), controller.signal).failure
    expect(failure.code).toBe('cancelled')
    expect(JSON.stringify(failure)).not.toContain('PRIVATE')
  })

  it('does not forward arbitrary infrastructure errors or remote details', () => {
    for (const error of [
      new Error('PRIVATE_HOST_DIAGNOSTIC'),
      new TypertRemoteFailure({ code: 'injected', message: 'PRIVATE_HOST_DIAGNOSTIC', details: { private: true } }),
    ]) {
      expect(planningRemoteFailure(error).failure).toEqual({
        code: 'internal',
        message: 'Planning operation failed',
        details: {},
      })
    }
  })
})
