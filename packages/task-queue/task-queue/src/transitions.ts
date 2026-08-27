/** Shared pure lifecycle predicates used by the event fold and scheduler. */
import type { WorkFailure, WorkStatus } from './types.ts'

/**
 * Classify a WorkStatus.
 * @param status - Status to classify.
 * @returns Whether the status is terminal.
 */
export function isTerminalState(status: WorkStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled'
}

/**
 * Decide whether automatic retry is both requested and side-effect safe.
 * @param failure - Structured failure to inspect.
 * @returns True only for retriable failures whose side effect did not start.
 */
export function canAutoRetry(failure: Pick<WorkFailure, 'retriable' | 'sideEffect'>): boolean {
  return failure.retriable && failure.sideEffect === 'not-started'
}
