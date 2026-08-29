/** Stable browser failure classification for Personal Delivery Remote operations. */

import { DeliveryError } from '@deepseek-ai/dsh-delivery'
import { DeliveryEvidenceError } from '@deepseek-ai/dsh-delivery-evidence'
import { DeliveryGitHubIntakeError } from '@deepseek-ai/dsh-delivery-github-intake'
import { DeliveryTaskQueueError } from '@deepseek-ai/dsh-delivery-task-queue'
import { RepositoryWorkspaceError } from '@deepseek-ai/dsh-repo-workspace'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { DeliveryAcceptanceCandidateError } from './acceptance.ts'
import { DeliveryProjectionError } from './projection.ts'

/** Stable browser failure code shared by all six explicit operations and snapshot. */
export type DeliveryRemoteErrorCode =
  | 'bad-request'
  | 'not-found'
  | 'conflict'
  | 'denied'
  | 'cancelled'
  | 'unavailable'
  | 'internal'

/**
 * Map trusted-domain failures without exposing arbitrary infrastructure text.
 * @param operation - Stable Remote operation name used in safe diagnostics.
 * @param error - Domain or infrastructure failure to classify.
 * @param signal - Optional operation signal used to recognize cancellation.
 * @returns a stable Typert failure safe for browser transport.
 */
export function remoteFailure(
  operation: string,
  error: unknown,
  signal?: AbortSignal,
): TypertRemoteFailure {
  if (signal?.aborted === true) {
    return new TypertRemoteFailure({
      code: 'cancelled',
      message: `Delivery ${operation} was cancelled`,
      details: { operation },
    })
  }
  if (error instanceof TypertRemoteFailure) {
    const known = new Set<DeliveryRemoteErrorCode>([
      'bad-request', 'not-found', 'conflict', 'denied', 'cancelled', 'unavailable', 'internal',
    ])
    const code = known.has(error.failure.code as DeliveryRemoteErrorCode)
      ? error.failure.code as DeliveryRemoteErrorCode
      : 'internal'
    return new TypertRemoteFailure({
      code,
      message: `Delivery ${operation} failed: ${code}`,
      details: { operation },
    })
  }
  if (error instanceof DeliveryError) {
    const code: DeliveryRemoteErrorCode = error.code === 'not-found'
      ? 'not-found'
      : error.code === 'idempotency-conflict'
        ? 'conflict'
        : error.code === 'acceptance-denied'
          ? 'denied'
          : error.code === 'unavailable'
            ? 'unavailable'
            : 'bad-request'
    return new TypertRemoteFailure({
      code,
      message: `Delivery ${operation} was refused: ${error.code}`,
      details: { operation, domain: 'delivery', domainCode: error.code },
    })
  }
  if (error instanceof DeliveryTaskQueueError) {
    const code: DeliveryRemoteErrorCode = error.code === 'unavailable'
      ? 'unavailable'
      : error.code.endsWith('-not-found')
        ? 'not-found'
        : 'denied'
    return new TypertRemoteFailure({
      code,
      message: `Delivery ${operation} admission was refused: ${error.code}`,
      details: { operation, domain: 'delivery-task-queue', domainCode: error.code },
    })
  }
  if (error instanceof DeliveryGitHubIntakeError) {
    return new TypertRemoteFailure({
      code: error.code === 'unavailable' ? 'unavailable' : 'bad-request',
      message: `Delivery issue import failed: ${error.code}`,
      details: { operation, domain: 'delivery-github-intake', domainCode: error.code },
    })
  }
  if (error instanceof DeliveryEvidenceError) {
    const code: DeliveryRemoteErrorCode = error.code === 'not-found'
      ? 'not-found'
      : error.code === 'unavailable'
        ? 'unavailable'
        : 'denied'
    return new TypertRemoteFailure({
      code,
      message: `Delivery evidence ${operation} failed: ${error.code}`,
      details: { operation, domain: 'delivery-evidence', domainCode: error.code },
    })
  }
  if (error instanceof RepositoryWorkspaceError) {
    const code: DeliveryRemoteErrorCode = error.code === 'unavailable'
      ? 'unavailable'
      : error.code.endsWith('-not-found') || error.code === 'revision-not-found'
        ? 'not-found'
        : 'denied'
    return new TypertRemoteFailure({
      code,
      message: `Delivery repository operation failed: ${error.code}`,
      details: { operation, domain: 'repo-workspace', domainCode: error.code },
    })
  }
  if (error instanceof DeliveryProjectionError || error instanceof DeliveryAcceptanceCandidateError) {
    return new TypertRemoteFailure({
      code: 'denied',
      message: `Delivery ${operation} projection was refused`,
      details: { operation, domain: 'delivery-projection' },
    })
  }
  return new TypertRemoteFailure({
    code: 'internal',
    message: `Delivery ${operation} failed`,
    details: { operation },
  })
}

/**
 * Reject a pre-aborted Remote call before it starts any provider operation.
 * @param signal - Operation-local caller signal.
 * @param operation - Stable Remote operation name used in the cancellation failure.
 */
export function requireActive(signal: AbortSignal, operation: string): void {
  if (signal.aborted) throw remoteFailure(operation, signal.reason, signal)
}
