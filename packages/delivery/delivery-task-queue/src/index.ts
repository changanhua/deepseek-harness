/**
 * Personal Delivery admission bridge and exclusive Queue WorkKind owner.
 *
 * @module @deepseek-ai/dsh-delivery-task-queue
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Delivery from '@deepseek-ai/dsh-delivery'
import {
  CODE_CHANGE_KIND,
  CODE_VERIFY_KIND,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  canonicalDigest,
  codeChangeIntentSchema,
  codeChangeOutputSchema,
  resolvedCodeChangeSchema,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  CodeChangeIntent,
  CodeChangeOutput,
  CodeVerifyIntent,
  CodeVerifyOutput,
  DispatchBinding,
  DispatchBindingId,
  ExecutorId,
  ResolvedCodeChange,
  ResolvedCodeVerify,
  WorkPacketId,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  CODEX_APP_SERVER_PERMISSION_MODES,
  MAX_MODEL_OUTPUT_BYTES,
} from '@deepseek-ai/dsh-delivery-runner-codex'
import type {
  CodeChangeRunRequest,
  CodexAppServerPermissionMode,
} from '@deepseek-ai/dsh-delivery-runner-codex'
import {
  MAX_VERIFICATION_OUTPUT_BYTES,
} from '@deepseek-ai/dsh-delivery-verifier'
import type { DeliveryVerificationRunRequest } from '@deepseek-ai/dsh-delivery-verifier'
import type RepositoryWorkspace from '@deepseek-ai/dsh-repo-workspace'
import {
  WorkId,
} from '@deepseek-ai/dsh-task-queue'
import type {
  OperatorWorkQueue,
  WorkKindDefinition,
} from '@deepseek-ai/dsh-task-queue'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

export const name = 'delivery-task-queue'
export const inject = [
  'delivery',
  'deliveryEvidence',
  'repoWorkspace',
  'subprocess',
  'taskQueue',
]

const DEFAULT_EXECUTOR_ID = 'codex'
const DEFAULT_DISPOSE_GRACE_MS = 5_000
const DEFAULT_OUTPUT_BYTES = 64 * 1024
const DEFAULT_RESOURCE = 'agent-run'
const DEFAULT_MAX_ATTEMPTS = 1
const DEFAULT_VERIFIER_VERSION = 'personal-delivery-v1'

/** Loader-owned composition policy for both Delivery Queue handlers. */
export interface Config {
  /** Stable executor recorded on code-change bindings. */
  readonly executorId?: string
  /** Optional Codex model override. */
  readonly model?: string
  /** Native unattended Codex approval and sandbox policy. */
  readonly permissionMode?: CodexAppServerPermissionMode
  /** Explicit child environment layered after credential scrubbing. */
  readonly env?: Record<string, string>
  /** Process-tree termination grace shared by runner and verifier. */
  readonly disposeGraceMs?: number
  /** Maximum retained UTF-8 bytes from Codex assistant output. */
  readonly modelOutputBytes?: number
  /** Maximum collected bytes from one verification check. */
  readonly verificationOutputBytes?: number
  /** Queue resource serialized across expensive Agent work. */
  readonly resource?: string
  /** Queue retry ceiling for both governed work kinds. */
  readonly maxAttempts?: number
  /** Stable verifier implementation identity persisted in verdicts. */
  readonly verifierVersion?: string
}

/** Schemastery loader contract owned by the sole runner/verifier composer. */
export const Config: z<Config> = z.object({
  executorId: z.string().min(1).default(DEFAULT_EXECUTOR_ID),
  model: z.string().min(1),
  permissionMode: z.union([...CODEX_APP_SERVER_PERMISSION_MODES])
    .default('never'),
  env: z.dict(z.string()).default({}),
  disposeGraceMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS)
    .default(DEFAULT_DISPOSE_GRACE_MS),
  modelOutputBytes: z.number().step(1).min(1).max(MAX_MODEL_OUTPUT_BYTES)
    .default(DEFAULT_OUTPUT_BYTES),
  verificationOutputBytes: z.number().step(1).min(1)
    .max(MAX_VERIFICATION_OUTPUT_BYTES).default(DEFAULT_OUTPUT_BYTES),
  resource: z.string().min(1).default(DEFAULT_RESOURCE),
  maxAttempts: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)
    .default(DEFAULT_MAX_ATTEMPTS),
  verifierVersion: z.string().min(1).default(DEFAULT_VERIFIER_VERSION),
})

declare module '@deepseek-ai/dsh-task-queue' {
  interface WorkKindMap {
    'code.change@1': WorkKindDefinition<
      CodeChangeIntent,
      ResolvedCodeChange,
      CodeChangeRunRequest,
      CodeChangeOutput
    >
    'code.verify@1': WorkKindDefinition<
      CodeVerifyIntent,
      ResolvedCodeVerify,
      DeliveryVerificationRunRequest,
      CodeVerifyOutput
    >
  }
}

/** Trusted host capabilities needed to authorize and persist Queue admissions. */
export interface DeliveryQueueBridgeDependencies {
  readonly delivery: Pick<
    Delivery,
    'beginDispatch' | 'bindDispatch' | 'getDispatchBinding' | 'getWorkPacket'
  >
  readonly queue: Pick<OperatorWorkQueue, 'enqueue' | 'get'>
  readonly repoWorkspace: Pick<
    RepositoryWorkspace,
    'inspectRange' | 'inspectRevision'
  >
}

/** Human-authorized input for one code-change admission. */
export interface StartCodeChangeRequest {
  readonly packetId: WorkPacketId
  readonly executorId: ExecutorId
}

/** Human-authorized selection of the successful change to verify. */
export interface StartVerificationRequest {
  readonly packetId: WorkPacketId
  readonly changeBindingId: DispatchBindingId
}

/** Stable Queue bridge failure classification. */
export type DeliveryTaskQueueErrorCode =
  | 'unavailable'
  | 'packet-not-found'
  | 'executor-not-allowed'
  | 'change-binding-invalid'
  | 'change-work-invalid'
  | 'change-output-invalid'
  | 'repository-range-invalid'

/** Typed failure emitted while the concrete handler implementation is unavailable. */
export class DeliveryTaskQueueError extends Error {
  /**
   * @param code - Stable bridge failure classification.
   * @param message - Human-readable diagnostic.
   * @param options - Optional underlying failure.
   */
  constructor(
    readonly code: DeliveryTaskQueueErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'DeliveryTaskQueueError'
  }
}

/**
 * Admit one ownerless code-change WorkItem and bind its Queue identity.
 *
 * The caller supplies no idempotency key. The bridge derives the exact intent
 * digest and stable cross-store identity from the Packet and WorkKind.
 *
 * Before either store is mutated, the bridge proves that the Packet exists and
 * that a required executor preference, when present, matches the selection.
 *
 * @param dependencies - Trusted Delivery, Queue, and repository host surfaces.
 * @param request - Packet and operator-selected executor.
 * @returns the durable bound dispatch.
 */
export async function startCodeChange(
  dependencies: DeliveryQueueBridgeDependencies,
  request: StartCodeChangeRequest,
): Promise<DispatchBinding> {
  const packet = dependencies.delivery.getWorkPacket(request.packetId)
  if (packet?.id !== request.packetId) {
    throw new DeliveryTaskQueueError(
      'packet-not-found',
      'Cannot admit code change because the selected Delivery Packet does not exist',
    )
  }
  if (
    packet.executorPreference.mode === 'required'
    && packet.executorPreference.executorId !== request.executorId
  ) {
    throw new DeliveryTaskQueueError(
      'executor-not-allowed',
      'Cannot admit code change because the selected executor does not match the Packet requirement',
    )
  }
  const intent: CodeChangeIntent = Object.freeze({
    packetId: request.packetId,
  })
  const idempotencyKey =
    'delivery:' + request.packetId + ':' + CODE_CHANGE_KIND
  const binding = await dependencies.delivery.beginDispatch({
    idempotencyKey,
    packetId: request.packetId,
    inputDigest: canonicalDigest(intent),
    kind: CODE_CHANGE_KIND,
    executorId: request.executorId,
  })
  if (binding.phase === 'bound') return binding
  const workId = await dependencies.queue.enqueue({
    kind: CODE_CHANGE_KIND,
    title: 'Change code for Delivery Packet ' + request.packetId,
    input: intent,
    idempotencyKey,
  })
  return dependencies.delivery.bindDispatch({
    bindingId: binding.id,
    queueWorkId: QueueWorkIdRef(String(workId)),
  })
}

/**
 * Admit one ownerless immutable-target verification and bind its Queue identity.
 *
 * The request selects only a Packet and its successful change binding. Before
 * `beginDispatch`, the bridge proves all of the following without writing to
 * either store: the Packet exists; the binding is a bound change for that exact
 * Packet; its exact Queue Work intent, digest, resolved Packet/base/executor,
 * and successful Result agree; the completed claim carries the same Packet,
 * Work, and Attempt identities; and the claimed checkpoint is a descendant of
 * the Packet base. The immutable target and trusted verification-plan digest
 * are derived from those facts, never accepted from a browser or other caller.
 *
 * @param dependencies - Trusted Delivery, Queue, and repository host surfaces.
 * @param request - Packet and bound successful change selected for verification.
 * @returns the durable bound dispatch.
 */
export async function startVerification(
  dependencies: DeliveryQueueBridgeDependencies,
  request: StartVerificationRequest,
): Promise<DispatchBinding> {
  const packet = dependencies.delivery.getWorkPacket(request.packetId)
  if (packet?.id !== request.packetId) {
    throw new DeliveryTaskQueueError(
      'packet-not-found',
      'Cannot admit verification because the selected Delivery Packet does not exist',
    )
  }

  const changeBinding = dependencies.delivery.getDispatchBinding(
    request.changeBindingId,
  )
  if (
    changeBinding?.id !== request.changeBindingId
    || changeBinding.packetId !== packet.id
    || changeBinding.kind !== CODE_CHANGE_KIND
    || changeBinding.phase !== 'bound'
  ) {
    throw new DeliveryTaskQueueError(
      'change-binding-invalid',
      'Cannot admit verification because the selected binding is not a bound code change for the Packet',
    )
  }

  const changeWorkId = WorkId(String(changeBinding.queueWorkId))
  let changeWork: ReturnType<OperatorWorkQueue['get']>
  try {
    changeWork = dependencies.queue.get(changeWorkId)
  } catch (cause) {
    throw new DeliveryTaskQueueError(
      'change-work-invalid',
      'Cannot admit verification because the bound code-change WorkItem is unavailable',
      { cause },
    )
  }
  if (
    changeWork.work.id !== changeWorkId
    || changeWork.work.kind !== CODE_CHANGE_KIND
    || changeWork.state.workId !== changeWorkId
    || changeWork.state.status !== 'succeeded'
    || changeWork.result === null
    || changeWork.state.resultId !== changeWork.result.id
    || changeWork.result.workId !== changeWorkId
    || changeWork.result.kind !== CODE_CHANGE_KIND
  ) {
    throw new DeliveryTaskQueueError(
      'change-work-invalid',
      'Cannot admit verification because the bound code-change WorkItem has no exact successful result',
    )
  }

  const parsedIntent = codeChangeIntentSchema.safeParse(changeWork.work.intent)
  if (
    !parsedIntent.success
    || parsedIntent.data.packetId !== packet.id
    || changeWork.work.intentDigest !== canonicalDigest(parsedIntent.data)
  ) {
    throw new DeliveryTaskQueueError(
      'change-work-invalid',
      'Cannot admit verification because the bound code-change WorkItem intent is not the exact canonical Packet intent',
      parsedIntent.success ? undefined : { cause: parsedIntent.error },
    )
  }
  if (changeBinding.inputDigest !== canonicalDigest(parsedIntent.data)) {
    throw new DeliveryTaskQueueError(
      'change-binding-invalid',
      'Cannot admit verification because the selected binding digest does not match its exact Queue intent',
    )
  }

  const parsedResolved = resolvedCodeChangeSchema.safeParse(
    changeWork.work.resolved,
  )
  if (
    !parsedResolved.success
    || parsedResolved.data.packetId !== packet.id
    || parsedResolved.data.contractRevisionId !== packet.contractRevisionId
    || parsedResolved.data.repositoryId !== packet.repositoryId
    || parsedResolved.data.baseCommit !== packet.baseCommit
    || parsedResolved.data.executorId !== changeBinding.executorId
  ) {
    throw new DeliveryTaskQueueError(
      'change-work-invalid',
      'Cannot admit verification because the bound code-change WorkItem was not resolved for the exact Packet base and selected executor',
      parsedResolved.success ? undefined : { cause: parsedResolved.error },
    )
  }

  const parsedOutput = codeChangeOutputSchema.safeParse(changeWork.result.output)
  if (!parsedOutput.success) {
    throw new DeliveryTaskQueueError(
      'change-output-invalid',
      'Cannot admit verification because the code-change result output is invalid',
      { cause: parsedOutput.error },
    )
  }
  const claim = parsedOutput.data.completionClaim
  if (
    claim.disposition !== 'completed'
    || claim.packetId !== packet.id
    || claim.queueWorkId !== changeBinding.queueWorkId
    || claim.queueAttemptId !== QueueAttemptIdRef(String(changeWork.result.attemptId))
  ) {
    throw new DeliveryTaskQueueError(
      'change-output-invalid',
      'Cannot admit verification because the completion claim does not match the selected Packet and Queue result',
    )
  }

  let base
  let target
  let range
  try {
    base = await dependencies.repoWorkspace.inspectRevision({
      repositoryId: packet.repositoryId,
      commit: packet.baseCommit,
    })
    target = await dependencies.repoWorkspace.inspectRevision({
      repositoryId: packet.repositoryId,
      commit: claim.checkpointCommit,
    })
    range = await dependencies.repoWorkspace.inspectRange({ base, target })
  } catch (cause) {
    throw new DeliveryTaskQueueError(
      'repository-range-invalid',
      'Cannot admit verification because the Packet base and claimed checkpoint could not be verified',
      { cause },
    )
  }
  if (
    base.repositoryId !== packet.repositoryId
    || base.commit !== packet.baseCommit
    || target.repositoryId !== packet.repositoryId
    || target.commit !== claim.checkpointCommit
    || range.repositoryId !== packet.repositoryId
    || range.baseCommit !== packet.baseCommit
    || range.targetCommit !== claim.checkpointCommit
    || !range.descendsFromBase
  ) {
    throw new DeliveryTaskQueueError(
      'repository-range-invalid',
      'Cannot admit verification because the claimed checkpoint is not an exact descendant of the Packet base',
    )
  }

  const intent: CodeVerifyIntent = Object.freeze({
    packetId: request.packetId,
    targetCommit: claim.checkpointCommit,
    verificationPlanDigest: packet.verificationPlan.digest,
  })
  const idempotencyKey =
    'delivery:' + request.packetId + ':' + CODE_VERIFY_KIND + ':'
    + claim.checkpointCommit + ':' + packet.verificationPlan.digest
  const binding = await dependencies.delivery.beginDispatch({
    idempotencyKey,
    packetId: request.packetId,
    inputDigest: canonicalDigest(intent),
    kind: CODE_VERIFY_KIND,
  })
  if (binding.phase === 'bound') return binding
  const workId = await dependencies.queue.enqueue({
    kind: CODE_VERIFY_KIND,
    title: 'Verify Delivery Packet ' + request.packetId + ' at '
      + claim.checkpointCommit,
    input: intent,
    idempotencyKey,
  })
  return dependencies.delivery.bindDispatch({
    bindingId: binding.id,
    queueWorkId: QueueWorkIdRef(String(workId)),
  })
}

/**
 * Register the two Delivery WorkHandlers for this plugin lifetime.
 *
 * This scaffold freezes declaration ownership and the admission API only.
 * Concrete handler registration is unavailable in this package state.
 *
 * @param _ctx - Cordis context carrying the declared dependencies.
 */
export function apply(_ctx: Context, _config: Config): never {
  throw new DeliveryTaskQueueError(
    'unavailable',
    'Delivery Queue handler implementation is not installed; registration remains unavailable',
  )
}
