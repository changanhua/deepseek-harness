/** Browser-safe failure mapping for project planning. */
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { PlanningError } from '@changanhua/dsh-planning'

/**
 * Map an operation failure without exposing source text, paths or host diagnostics.
 * @param error - Domain or infrastructure error.
 * @param signal - Optional operation signal; cancellation takes precedence.
 * @returns A stable browser-safe error, with no arbitrary error detail.
 */
export function planningRemoteFailure(error: unknown, signal?: AbortSignal): TypertRemoteFailure {
  if (signal?.aborted === true) {
    return new TypertRemoteFailure({ code: 'cancelled', message: 'Planning operation was cancelled', details: {} })
  }
  if (error instanceof PlanningError) {
    const codes = {
      unauthorized: 'denied',
      'not-found': 'not-found',
      conflict: 'conflict',
      'idempotency-conflict': 'conflict',
      'invalid-reference': 'bad-request',
      'capacity-exceeded': 'capacity-exceeded',
      closed: 'unavailable',
      'source-unavailable': 'unavailable',
    } as const
    const code = codes[error.code]
    const message = error.message === 'base revision mismatch'
      ? 'Planning conflict: base revision mismatch; refresh, review and regenerate the proposal'
      : `Planning operation was refused: ${code}`
    return new TypertRemoteFailure({ code, message, details: {} })
  }
  return new TypertRemoteFailure({ code: 'internal', message: 'Planning operation failed', details: {} })
}

/**
 * Reject a cancelled caller before starting or committing a domain operation.
 * @param signal - Browser request lifetime.
 * @throws A safe cancelled failure when the request has already ended.
 */
export function requirePlanningActive(signal: AbortSignal): void {
  if (signal.aborted) throw planningRemoteFailure(signal.reason, signal)
}
