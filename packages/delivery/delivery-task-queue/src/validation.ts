import {
  CODE_CHANGE_KIND,
  CODE_VERIFY_KIND,
  QueueAttemptIdRef,
  canonicalDigest,
  codeChangeIntentSchema,
  codeChangeOutputSchema,
  codeVerifyIntentSchema,
  resolvedCodeChangeSchema,
  resolvedCodeVerifySchema,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  CompletionClaim,
  DispatchBinding,
  ResolvedCodeChange,
  ResolvedCodeVerify,
  WorkPacket,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  OperatorWorkQueue,
  WorkView,
} from '@deepseek-ai/dsh-task-queue'
import { AttemptId, WorkId } from '@deepseek-ai/dsh-task-queue'

type DeliveryKind = typeof CODE_CHANGE_KIND | typeof CODE_VERIFY_KIND
type DeliveryResolved = ResolvedCodeChange | ResolvedCodeVerify
type BoundChange = Extract<DispatchBinding, {
  readonly kind: typeof CODE_CHANGE_KIND
  readonly phase: 'bound'
}>
type CompletedClaim = Extract<CompletionClaim, {
  readonly disposition: 'completed'
}>
type SuccessfulChangeResult = {
  readonly result: NonNullable<WorkView['result']>
  readonly attempt: WorkView['attempts'][number]
}

function invalid(message: string): Error {
  return new Error(`Delivery Queue exact validation failed: ${message}`)
}

function validateCore(view: WorkView): void {
  const { work, state, result } = view
  if (state.workId !== work.id) {
    throw invalid('WorkState belongs to another Work id')
  }
  if (
    (state.resultId === null) !== (result === null)
    || (
      result !== null
      && (
        state.resultId !== result.id
        || result.workId !== work.id
        || result.kind !== work.kind
      )
    )
  ) {
    throw invalid('WorkState and WorkResult linkage is inconsistent')
  }
  if (view.attempts.some(attempt => attempt.workId !== work.id)) {
    throw invalid('Work view contains an Attempt owned by another Work')
  }
}

/** Require one successful Result linked to its exact successful Attempt. */
export function exactSuccessfulChangeResult(
  view: WorkView,
): SuccessfulChangeResult {
  validateCore(view)
  if (
    view.work.kind !== CODE_CHANGE_KIND
    || view.state.status !== 'succeeded'
    || view.state.activeAttemptId !== null
    || view.result === null
    || view.result.kind !== CODE_CHANGE_KIND
  ) {
    throw invalid('code-change Work has no exact successful Result')
  }
  const result = view.result
  const attempt = view.attempts.find(candidate =>
    candidate.id === result.attemptId)
  if (
    attempt === undefined
    || attempt.workId !== view.work.id
    || attempt.status !== 'succeeded'
  ) {
    throw invalid('code-change Result does not belong to a successful Attempt')
  }
  return { result, attempt }
}

function validateListGet(
  listed: WorkView,
  exact: WorkView,
): void {
  validateCore(listed)
  validateCore(exact)
  if (canonicalDigest(listed) !== canonicalDigest(exact)) {
    throw invalid('operator.list() and operator.get() disagree')
  }
}

function parseIntent(view: WorkView, kind: DeliveryKind) {
  const parsed = kind === CODE_CHANGE_KIND
    ? codeChangeIntentSchema.parse(view.work.intent)
    : codeVerifyIntentSchema.parse(view.work.intent)
  if (
    view.work.kind !== kind
    || canonicalDigest(parsed) !== view.work.intentDigest
  ) {
    throw invalid(`${kind} intent or digest is not canonical`)
  }
  return parsed
}

function parseResolved(
  view: WorkView,
  kind: DeliveryKind,
): DeliveryResolved {
  return kind === CODE_CHANGE_KIND
    ? resolvedCodeChangeSchema.parse(view.work.resolved)
    : resolvedCodeVerifySchema.parse(view.work.resolved)
}

/** Resolve one active Attempt through matching list/get views and exact facts. */
export function exactAttemptWork(
  operator: Pick<OperatorWorkQueue, 'list' | 'get'>,
  attemptId: AttemptId,
  kind: DeliveryKind,
  expectedResolved: DeliveryResolved,
): WorkView {
  const matches = operator.list().filter(view =>
    view.work.kind === kind
    && view.attempts.some(attempt => attempt.id === attemptId),
  )
  if (matches.length !== 1) {
    throw invalid(`cannot resolve one ${kind} Work for Attempt ${attemptId}`)
  }
  const listed = matches[0] as WorkView
  const exact = operator.get(listed.work.id)
  validateListGet(listed, exact)
  if (
    exact.state.status !== 'starting'
    || exact.state.activeAttemptId !== attemptId
  ) {
    throw invalid(`${kind} Attempt is not the active starting Attempt`)
  }
  const attempt = exact.attempts.find(candidate => candidate.id === attemptId)
  if (
    attempt === undefined
    || attempt.workId !== exact.work.id
    || attempt.status !== 'starting'
  ) {
    throw invalid(`${kind} Attempt linkage is inconsistent`)
  }
  const intent = parseIntent(exact, kind)
  const resolved = parseResolved(exact, kind)
  if (
    intent.packetId !== resolved.packetId
    || canonicalDigest(resolved) !== canonicalDigest(expectedResolved)
  ) {
    throw invalid(`${kind} resolved facts differ from the prepared admission`)
  }
  return exact
}

/** Cross-check one bound binding against the same exact operator list/get view. */
export function exactBoundQueueView(
  operator: Pick<OperatorWorkQueue, 'list' | 'get'>,
  binding: Extract<DispatchBinding, { readonly phase: 'bound' }>,
): WorkView {
  const workId = WorkId(String(binding.queueWorkId))
  const matches = operator.list().filter(view => view.work.id === workId)
  if (matches.length !== 1) {
    throw invalid(`bound Work ${workId} is absent or duplicated in operator.list()`)
  }
  const listed = matches[0] as WorkView
  const exact = operator.get(workId)
  validateListGet(listed, exact)
  const intent = parseIntent(exact, binding.kind)
  if (
    exact.work.id !== workId
    || intent.packetId !== binding.packetId
    || exact.work.intentDigest !== binding.inputDigest
  ) {
    throw invalid('bound binding does not match its exact Queue Work intent')
  }
  return exact
}

/** Validate the exact successful change selected for verifier preparation. */
export function exactBoundChange(
  operator: Pick<OperatorWorkQueue, 'list' | 'get'>,
  binding: BoundChange,
  packet: WorkPacket,
  targetCommit: ResolvedCodeVerify['targetCommit'],
): CompletedClaim {
  const view = exactBoundQueueView(operator, binding)
  const { result } = exactSuccessfulChangeResult(view)
  const resolved = resolvedCodeChangeSchema.parse(view.work.resolved)
  if (
    resolved.packetId !== packet.id
    || resolved.contractRevisionId !== packet.contractRevisionId
    || resolved.repositoryId !== packet.repositoryId
    || resolved.baseCommit !== packet.baseCommit
    || resolved.executorId !== binding.executorId
  ) {
    throw invalid('bound change resolved facts do not match the Packet and binding')
  }
  const output = codeChangeOutputSchema.parse(result.output)
  const claim = output.completionClaim
  if (
    claim.disposition !== 'completed'
    || claim.packetId !== packet.id
    || claim.checkpointCommit !== targetCommit
    || claim.queueWorkId !== binding.queueWorkId
    || claim.queueAttemptId !== QueueAttemptIdRef(String(result.attemptId))
  ) {
    throw invalid('bound change claim does not match the selected Queue Result')
  }
  return claim
}
