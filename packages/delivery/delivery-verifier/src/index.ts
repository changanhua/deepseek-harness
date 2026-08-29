/**
 * Independent fixed-plan verification runner for Personal Delivery.
 *
 * @module @deepseek-ai/dsh-delivery-verifier
 */

import type {
  BoundDeliveryEvidenceWriter,
  StoredDeliveryEvidence,
} from '@deepseek-ai/dsh-delivery-evidence'
import type {
  CompletionClaim,
  ContractRevision,
  EvidenceId,
  EvidenceRef,
  ResolvedCodeVerify,
  VerificationCheckId,
  VerificationVerdict,
  WorkPacket,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  RepositoryRangeFacts,
  VerificationWorkspaceLease,
} from '@deepseek-ai/dsh-repo-workspace'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Hard ceiling for retained verification subprocess output. */
export const MAX_VERIFICATION_OUTPUT_BYTES = 64 * 1024 * 1024

/** Stable verifier failure classification. */
export type DeliveryVerifierErrorCode = 'configuration' | 'unavailable'

/** Typed failure returned while the concrete verifier implementation is unavailable. */
export class DeliveryVerifierError extends Error {
  /**
   * @param code - Stable verifier failure classification.
   * @param message - Human-readable diagnostic.
   * @param options - Optional underlying failure.
   */
  constructor(
    readonly code: DeliveryVerifierErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'DeliveryVerifierError'
  }
}

/** Trusted host dependencies fixed before one verifier closure is created. */
export interface DeliveryVerifierDependencies {
  /** Shared subprocess capability used for trusted fixed-argv checks. */
  readonly subprocess: Pick<SubprocessRuntime, 'spawn'>
  /** Stable implementation identity retained in every verdict. */
  readonly verifierVersion: string
  /** Grace in milliseconds for terminating a verification subprocess tree. */
  readonly disposeGraceMs: number
  /** Maximum bytes collected for one verification check output. */
  readonly verificationOutputBytes: number
}

/** Successful code-change claim eligible for immutable-target verification. */
export type CompletedChangeClaim = Extract<
  CompletionClaim,
  { readonly disposition: 'completed' }
>

/** Attempt-local inputs assembled by the Queue bridge. */
export interface DeliveryVerificationRunRequest {
  readonly contract: ContractRevision
  readonly packet: WorkPacket
  readonly resolved: ResolvedCodeVerify
  /**
   * Completed change Result already cross-checked by the Queue bridge: packet ids match and
   * checkpointCommit equals resolved.targetCommit exactly. The verifier reads
   * every required object named by completionClaim.evidenceIds.
   */
  readonly completionClaim: CompletedChangeClaim
  /** Independently derive ancestry and complete changed-path facts. */
  readonly inspectRange: (signal: AbortSignal) => Promise<RepositoryRangeFacts>
  /** Open the read/execute-only Attempt checkout only when verification starts. */
  readonly openWorkspace: (signal: AbortSignal) => Promise<VerificationWorkspaceLease>
  /** Bind evidence provenance to the exact planned verification check. */
  readonly evidenceFor: (checkId: VerificationCheckId) => BoundDeliveryEvidenceWriter
  /** Resolve a durable evidence id before integrity-checked byte reads. */
  readonly resolveEvidence: (
    evidenceId: EvidenceId,
    signal: AbortSignal,
  ) => Promise<EvidenceRef | undefined>
  /** Read bytes only through the evidence provider's integrity boundary. */
  readonly readEvidence: (
    reference: EvidenceRef,
    signal: AbortSignal,
  ) => Promise<StoredDeliveryEvidence>
}

/** Live verifier ownership published synchronously at the side-effect boundary. */
export interface DeliveryVerificationRun {
  readonly done: Promise<VerificationVerdict>
  /** Request cancellation and wait until the verifier has processed it. */
  cancel(reason: string): Promise<void>
}

/** Start independent verification for one immutable target. */
export type StartDeliveryVerification = (
  request: DeliveryVerificationRunRequest,
  signal: AbortSignal,
) => DeliveryVerificationRun

function configuration(message: string): DeliveryVerifierError {
  return new DeliveryVerifierError('configuration', message)
}

function validateDependencies(
  dependencies: DeliveryVerifierDependencies,
): void {
  if (dependencies.verifierVersion.trim() === '') {
    throw configuration('verifierVersion must not be blank')
  }
  if (
    !Number.isInteger(dependencies.disposeGraceMs)
    || dependencies.disposeGraceMs < 1
    || dependencies.disposeGraceMs > MAX_TIMER_DELAY_MS
  ) {
    throw configuration(
      `disposeGraceMs must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  if (
    !Number.isSafeInteger(dependencies.verificationOutputBytes)
    || dependencies.verificationOutputBytes < 1
    || dependencies.verificationOutputBytes > MAX_VERIFICATION_OUTPUT_BYTES
  ) {
    throw configuration(
      `verificationOutputBytes must be a positive safe integer no greater than ${MAX_VERIFICATION_OUTPUT_BYTES}`,
    )
  }
}

function unavailableRun(): DeliveryVerificationRun {
  const error = new DeliveryVerifierError(
    'unavailable',
    'Delivery verifier implementation is not installed; fixed-plan execution remains unavailable',
  )
  const done = Promise.reject<VerificationVerdict>(error)
  // Keep probing the scaffold deterministic without an unhandled rejection.
  void done.catch(() => undefined)
  return Object.freeze({
    done,
    cancel: (_reason: string) => Promise.resolve(),
  })
}

/**
 * Create an independent Delivery verifier closure.
 *
 * @param dependencies - Trusted subprocess capability and verifier identity.
 * @returns a stable closure whose concrete verifier implementation is unavailable.
 */
export function createDeliveryVerifier(
  dependencies: DeliveryVerifierDependencies,
): StartDeliveryVerification {
  validateDependencies(dependencies)
  return (
    _request: DeliveryVerificationRunRequest,
    _signal: AbortSignal,
  ) => unavailableRun()
}
