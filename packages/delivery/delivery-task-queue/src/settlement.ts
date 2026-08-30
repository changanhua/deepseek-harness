import {
  codeChangeOutputSchema,
  codeVerifyOutputSchema,
  completionClaimSchema,
  verificationVerdictSchema,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  CompletionClaim,
  VerificationVerdict,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  DeliveryCodexRunnerError,
} from '@deepseek-ai/dsh-delivery-runner-codex'
import type { CodeChangeRunRequest } from '@deepseek-ai/dsh-delivery-runner-codex'
import { DeliveryVerifierError } from '@deepseek-ai/dsh-delivery-verifier'
import type { DeliveryVerificationRunRequest } from '@deepseek-ai/dsh-delivery-verifier'
import type { LiveAttempt, WorkFailure } from '@deepseek-ai/dsh-task-queue'

function failure(
  category: string,
  message: string,
  sideEffect: WorkFailure['sideEffect'],
): WorkFailure {
  return { category, message, sideEffect, retriable: false }
}

function unknownFailure(kind: string, value: unknown): WorkFailure {
  return failure(
    `${kind}-unknown`,
    /* v8 ignore next -- package-owned runner boundaries reject Error values. */
    value instanceof Error ? value.message : `${kind} rejected with a non-Error value`,
    'unknown',
  )
}

/**
 * Map a governed runner settlement into the Queue code-change outcome.
 * @param done - Runner completion owned by the live Attempt.
 * @param prepared - Attempt-bound request used to verify output provenance.
 * @returns The Queue settlement promise for `code.change@1`.
 */
export function settleChange(
  done: Promise<CompletionClaim>,
  prepared: CodeChangeRunRequest,
): LiveAttempt<'code.change@1'>['done'] {
  return done.then((claim) => {
    const parsed = completionClaimSchema.safeParse(claim)
    if (
      !parsed.success
      || parsed.data.packetId !== prepared.packet.id
      || parsed.data.queueWorkId !== prepared.queueWorkId
      || parsed.data.queueAttemptId !== prepared.queueAttemptId
    ) {
      return {
        status: 'unknown',
        failure: failure(
          'delivery-change-output',
          'Delivery Codex runner returned a claim with invalid Queue provenance',
          'unknown',
        ),
      }
    }
    return {
      status: 'succeeded',
      output: codeChangeOutputSchema.parse({ completionClaim: parsed.data }),
    }
  }, (cause: unknown) => {
    if (!(cause instanceof DeliveryCodexRunnerError)) {
      return { status: 'unknown', failure: unknownFailure('delivery-change', cause) }
    }
    switch (cause.code) {
      case 'canceled': return { status: 'canceled' }
      case 'configuration':
      case 'invalid-request':
      case 'startup':
        return {
          status: 'failed',
          failure: failure(
            `delivery-change-${cause.code}`, cause.message, 'not-started',
          ),
        }
      case 'product':
      case 'completion':
        return {
          status: 'failed',
          failure: failure(
            `delivery-change-${cause.code}`, cause.message, 'started',
          ),
        }
      case 'ownership-lost':
      case 'cleanup':
        return {
          status: 'unknown',
          failure: failure(
            `delivery-change-${cause.code}`, cause.message, 'unknown',
          ),
        }
    }
  })
}

/**
 * Map a verifier settlement into the Queue verification outcome.
 * @param done - Verifier completion owned by the live Attempt.
 * @param prepared - Attempt-bound request used to verify immutable identities.
 * @param verifierVersion - Configured verifier version required in the verdict.
 * @returns The Queue settlement promise for `code.verify@1`.
 */
export function settleVerification(
  done: Promise<VerificationVerdict>,
  prepared: DeliveryVerificationRunRequest,
  verifierVersion: string,
): LiveAttempt<'code.verify@1'>['done'] {
  return done.then((verdict) => {
    const parsed = verificationVerdictSchema.safeParse(verdict)
    if (
      !parsed.success
      || parsed.data.packetId !== prepared.packet.id
      || parsed.data.baseCommit !== prepared.packet.baseCommit
      || parsed.data.targetCommit !== prepared.resolved.targetCommit
      || parsed.data.verificationPlanDigest
        !== prepared.resolved.trustedPlan.digest
      || parsed.data.verifierVersion !== verifierVersion
    ) {
      return {
        status: 'unknown',
        failure: failure(
          'delivery-verification-output',
          'Delivery verifier returned a verdict with invalid immutable identity',
          'unknown',
        ),
      }
    }
    return {
      status: 'succeeded',
      output: codeVerifyOutputSchema.parse({ verificationVerdict: parsed.data }),
    }
  }, (cause: unknown) => {
    if (!(cause instanceof DeliveryVerifierError)) {
      return {
        status: 'unknown',
        failure: unknownFailure('delivery-verification', cause),
      }
    }
    switch (cause.code) {
      case 'canceled': return { status: 'canceled' }
      case 'configuration':
      case 'invalid-request':
        return {
          status: 'failed',
          failure: failure(
            `delivery-verification-${cause.code}`, cause.message, 'not-started',
          ),
        }
      case 'workspace-boundary':
      case 'execution':
        return {
          status: 'failed',
          failure: failure(
            `delivery-verification-${cause.code}`, cause.message, 'started',
          ),
        }
      case 'cleanup':
        return {
          status: 'unknown',
          failure: failure(
            'delivery-verification-cleanup', cause.message, 'unknown',
          ),
        }
    }
  })
}
