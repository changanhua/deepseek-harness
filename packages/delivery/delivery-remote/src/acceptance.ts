/** Queue-result resolution used only by the human-decision Remote operation. */

import type { AcceptanceCandidateFacts } from '@changanhua/dsh-delivery'
import {
  QueueAttemptIdRef,
  QueueWorkIdRef,
  codeChangeOutputSchema,
  codeVerifyIntentSchema,
  codeVerifyOutputSchema,
} from '@changanhua/dsh-delivery-protocol'
import { WorkId, type OperatorWorkQueue, type WorkView } from '@changanhua/dsh-task-queue'

/** Stable internal refusal for an invalid Delivery-bound Queue result. */
export class DeliveryAcceptanceCandidateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DeliveryAcceptanceCandidateError'
  }
}

function succeeded(
  queue: Pick<OperatorWorkQueue, 'get'>,
  workId: QueueWorkIdRef,
  kind: 'code.change@1' | 'code.verify@1',
): WorkView {
  let view: WorkView
  try {
    view = queue.get(WorkId(String(workId)))
  } catch (cause) {
    throw new DeliveryAcceptanceCandidateError(`Bound ${kind} Work is unavailable`, { cause })
  }
  const result = view.result
  if (
    String(view.work.id) !== workId
    || view.work.kind !== kind
    || String(view.state.workId) !== workId
    || view.state.status !== 'succeeded'
    || result === null
    || view.state.resultId !== result.id
    || result.workId !== view.work.id
    || result.kind !== kind
    || !view.attempts.some(attempt =>
      attempt.id === result.attemptId
        && attempt.workId === view.work.id
        && attempt.status === 'succeeded',
    )
  ) {
    throw new DeliveryAcceptanceCandidateError(`Bound ${kind} Work has no exact successful result`)
  }
  return view
}

/**
 * Resolve the two exact Queue results selected by already validated Delivery bindings.
 * @param queue - Trusted operator Queue view used for exact Work lookups.
 * @param changeWorkId - Queue Work selected by the bound change dispatch.
 * @param verificationWorkId - Queue Work selected by the bound verification dispatch.
 * @returns the typed acceptance candidate derived from two exact successful attempts.
 */
export function resolveAcceptanceCandidate(
  queue: Pick<OperatorWorkQueue, 'get'>,
  changeWorkId: QueueWorkIdRef,
  verificationWorkId: QueueWorkIdRef,
): AcceptanceCandidateFacts {
  const change = succeeded(queue, changeWorkId, 'code.change@1')
  const verification = succeeded(queue, verificationWorkId, 'code.verify@1')
  const changeOutput = codeChangeOutputSchema.safeParse(change.result?.output)
  if (!changeOutput.success) {
    throw new DeliveryAcceptanceCandidateError('Bound code.change@1 Work output is invalid', {
      cause: changeOutput.error,
    })
  }
  const verificationIntent = codeVerifyIntentSchema.safeParse(verification.work.intent)
  if (!verificationIntent.success) {
    throw new DeliveryAcceptanceCandidateError('Bound code.verify@1 Work intent is invalid', {
      cause: verificationIntent.error,
    })
  }
  const verificationOutput = codeVerifyOutputSchema.safeParse(verification.result?.output)
  if (!verificationOutput.success) {
    throw new DeliveryAcceptanceCandidateError('Bound code.verify@1 Work output is invalid', {
      cause: verificationOutput.error,
    })
  }
  const changeResult = change.result as NonNullable<WorkView['result']>
  const verificationResult = verification.result as NonNullable<WorkView['result']>
  return {
    completionClaim: changeOutput.data.completionClaim,
    changeQueueAttemptId: QueueAttemptIdRef(String(changeResult.attemptId)),
    verificationIntent: verificationIntent.data,
    verificationVerdict: verificationOutput.data.verificationVerdict,
    verificationQueueAttemptId: QueueAttemptIdRef(String(verificationResult.attemptId)),
  }
}
