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
  ExecutorId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  canonicalDigest,
  codeChangeIntentSchema,
  codeChangeOutputSchema,
  codeVerifyIntentSchema,
  contractRevisionSchema,
  resolvedCodeChangeSchema,
  resolvedCodeVerifySchema,
  workPacketSchema,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  CodeChangeIntent,
  CodeChangeOutput,
  CodeVerifyIntent,
  CodeVerifyOutput,
  DispatchBinding,
  DispatchBindingId,
  ResolvedCodeChange,
  ResolvedCodeVerify,
  WorkPacketId,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  CODEX_APP_SERVER_PERMISSION_MODES,
  MAX_MODEL_OUTPUT_BYTES,
  createCodexChangeRunner,
} from '@deepseek-ai/dsh-delivery-runner-codex'
import type {
  CodeChangeRunRequest,
  CodexAppServerPermissionMode,
  StartCodeChange as StartCodeChangeRun,
} from '@deepseek-ai/dsh-delivery-runner-codex'
import {
  MAX_VERIFICATION_OUTPUT_BYTES,
  createDeliveryVerifier,
} from '@deepseek-ai/dsh-delivery-verifier'
import type {
  DeliveryVerificationRunRequest,
  StartDeliveryVerification,
} from '@deepseek-ai/dsh-delivery-verifier'
import type DeliveryEvidence from '@deepseek-ai/dsh-delivery-evidence'
import type RepositoryWorkspace from '@deepseek-ai/dsh-repo-workspace'
import {
  WorkId,
  createVerifiedOperatorAuthority,
} from '@deepseek-ai/dsh-task-queue'
import type {
  OperatorWorkQueue,
  WorkHandler,
  WorkKindDefinition,
} from '@deepseek-ai/dsh-task-queue'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { reconcileDeliveryQueueBindings } from './recovery.ts'
import { settleChange, settleVerification } from './settlement.ts'
import {
  exactAttemptWork,
  exactBoundChange,
  exactSuccessfulChangeResult,
} from './validation.ts'

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
  readonly executorId?: typeof DEFAULT_EXECUTOR_ID
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
  executorId: z.const(DEFAULT_EXECUTOR_ID).default(DEFAULT_EXECUTOR_ID),
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
  | 'handler-input-invalid'
  | 'handler-attempt-invalid'
  | 'reconciliation-invalid'

/** Typed failure emitted by Delivery admission, handler, and recovery boundaries. */
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
    request.executorId !== ExecutorId(DEFAULT_EXECUTOR_ID)
    || (
      packet.executorPreference.mode === 'required'
      && packet.executorPreference.executorId !== request.executorId
    )
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
  try {
    exactSuccessfulChangeResult(changeWork)
  } catch (cause) {
    throw new DeliveryTaskQueueError(
      'change-work-invalid',
      'Cannot admit verification because the successful Result has no exact successful Attempt',
      { cause },
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

interface ResolvedBridgeConfig {
  readonly executorId: ExecutorId
  readonly model?: string
  readonly permissionMode: CodexAppServerPermissionMode
  readonly env: Readonly<Record<string, string>>
  readonly disposeGraceMs: number
  readonly modelOutputBytes: number
  readonly verificationOutputBytes: number
  readonly resource: string
  readonly maxAttempts: number
  readonly verifierVersion: string
}

type HandlerRegistration = (() => void) & { activate(): void }

/** Trusted dependencies shared by both package-owned Queue handlers. */
export interface DeliveryWorkHandlerDependencies {
  readonly delivery: Pick<
    Delivery,
    'getContractRevision' | 'getWorkPacket' | 'snapshot'
  >
  readonly operator: Pick<OperatorWorkQueue, 'list' | 'get'>
  readonly repoWorkspace: Pick<
    RepositoryWorkspace,
    | 'inspectRange'
    | 'inspectRevision'
    | 'openChange'
    | 'openVerification'
  >
  readonly evidence: Pick<DeliveryEvidence, 'bind' | 'read' | 'resolve'>
  readonly startChange: StartCodeChangeRun
  readonly startVerification: StartDeliveryVerification
}

function resolvedConfig(config: Config): ResolvedBridgeConfig {
  const parsed = Config(config) as Required<Omit<Config, 'model'>>
    & Pick<Config, 'model'>
  return Object.freeze({
    executorId: ExecutorId(parsed.executorId),
    ...parsed.model === undefined ? {} : { model: parsed.model },
    permissionMode: parsed.permissionMode,
    env: Object.freeze({ ...parsed.env }),
    disposeGraceMs: parsed.disposeGraceMs,
    modelOutputBytes: parsed.modelOutputBytes,
    verificationOutputBytes: parsed.verificationOutputBytes,
    resource: parsed.resource,
    maxAttempts: parsed.maxAttempts,
    verifierVersion: parsed.verifierVersion,
  })
}

function changePolicyDigest(config: ResolvedBridgeConfig) {
  return canonicalDigest({
    executorId: config.executorId,
    ...config.model === undefined ? {} : { model: config.model },
    permissionMode: config.permissionMode,
    env: config.env,
    disposeGraceMs: config.disposeGraceMs,
    modelOutputBytes: config.modelOutputBytes,
  })
}

function handlerError(
  code: Extract<
    DeliveryTaskQueueErrorCode,
    'handler-input-invalid' | 'handler-attempt-invalid'
  >,
  message: string,
): DeliveryTaskQueueError {
  return new DeliveryTaskQueueError(code, message)
}

function exactRecords(
  dependencies: DeliveryWorkHandlerDependencies,
  packetId: WorkPacketId,
) {
  const packet = workPacketSchema.parse(
    dependencies.delivery.getWorkPacket(packetId),
  )
  const contract = contractRevisionSchema.parse(
    dependencies.delivery.getContractRevision(packet.contractRevisionId),
  )
  if (
    packet.id !== packetId
    || contract.id !== packet.contractRevisionId
    || contract.repositoryId !== packet.repositoryId
  ) {
    throw handlerError(
      'handler-input-invalid',
      'Delivery Queue handler records do not describe one exact Packet',
    )
  }
  return { contract, packet }
}

function completedChangeFor(
  dependencies: DeliveryWorkHandlerDependencies,
  packetId: WorkPacketId,
  targetCommit: ResolvedCodeVerify['targetCommit'],
) {
  const bindings = dependencies.delivery.snapshot().dispatchBindings.filter(
    (binding): binding is Extract<DispatchBinding, {
      readonly kind: typeof CODE_CHANGE_KIND
      readonly phase: 'bound'
    }> => binding.packetId === packetId
      && binding.kind === CODE_CHANGE_KIND
      && binding.phase === 'bound',
  )
  const binding = bindings[0]
  if (binding === undefined || bindings.length !== 1) {
    throw handlerError(
      'handler-attempt-invalid',
      'Delivery verification preparation requires one exact successful change claim',
    )
  }
  try {
    return exactBoundChange(
      dependencies.operator,
      binding,
      exactRecords(dependencies, packetId).packet,
      targetCommit,
    )
  } catch (cause) {
    throw new DeliveryTaskQueueError(
      'handler-attempt-invalid',
      'Delivery verification preparation found a corrupt bound change',
      { cause },
    )
  }
}

function requireConfiguredChangeBinding(
  dependencies: DeliveryWorkHandlerDependencies,
  packetId: WorkPacketId,
  executorId: ExecutorId,
): void {
  const intent = { packetId }
  const bindings = dependencies.delivery.snapshot().dispatchBindings.filter(
    binding => binding.packetId === packetId
      && binding.kind === CODE_CHANGE_KIND,
  )
  const binding = bindings[0]
  if (
    binding === undefined
    || bindings.length !== 1
    || binding.executorId !== executorId
    || binding.inputDigest !== canonicalDigest(intent)
    || binding.idempotencyKey !== `delivery:${packetId}:${CODE_CHANGE_KIND}`
  ) {
    throw handlerError(
      'handler-input-invalid',
      'Delivery code-change admission requires one exact binding for the configured Codex runner',
    )
  }
}

/**
 * Build the sole `code.change@1` WorkHandler.
 * @param dependencies - Trusted Delivery, Queue, repository, evidence, and runner capabilities.
 * @param config - Loader-owned execution and retry settings.
 * @returns The typed code-change handler registered by this bridge.
 */
export function createCodeChangeHandler(
  dependencies: DeliveryWorkHandlerDependencies,
  config: Config,
): WorkHandler<typeof CODE_CHANGE_KIND> {
  const settings = resolvedConfig(config)
  const policyDigest = changePolicyDigest(settings)
  return {
    kind: CODE_CHANGE_KIND,
    resolveAdmission(input) {
      return Promise.resolve().then(() => {
        const intent = codeChangeIntentSchema.parse(input)
        const { packet } = exactRecords(dependencies, intent.packetId)
        if (
          packet.executorPreference.mode === 'required'
          && packet.executorPreference.executorId !== settings.executorId
        ) {
          throw handlerError(
            'handler-input-invalid',
            'Delivery code-change handler does not satisfy the Packet executor requirement',
          )
        }
        requireConfiguredChangeBinding(
          dependencies,
          packet.id,
          settings.executorId,
        )
        return resolvedCodeChangeSchema.parse({
          packetId: packet.id,
          contractRevisionId: packet.contractRevisionId,
          repositoryId: packet.repositoryId,
          baseCommit: packet.baseCommit,
          executorId: settings.executorId,
          policyDigest,
        })
      })
    },
    resources() {
      return [{ resource: settings.resource, units: 1 }]
    },
    policy() { return { maxAttempts: settings.maxAttempts } },
    async prepare(resolved, context) {
      const exactResolved = resolvedCodeChangeSchema.parse(resolved)
      if (exactResolved.policyDigest !== policyDigest) {
        throw handlerError(
          'handler-input-invalid',
          'Delivery code-change policy differs from the admitted policy digest',
        )
      }
      let view
      try {
        view = exactAttemptWork(
          dependencies.operator,
          context.attemptId,
          CODE_CHANGE_KIND,
          exactResolved,
        )
      } catch (cause) {
        throw new DeliveryTaskQueueError(
          'handler-attempt-invalid',
          'Delivery code-change Attempt does not own the prepared resolved facts',
          { cause },
        )
      }
      const { contract, packet } = exactRecords(
        dependencies, exactResolved.packetId,
      )
      const base = await dependencies.repoWorkspace.inspectRevision({
        repositoryId: packet.repositoryId,
        commit: packet.baseCommit,
        signal: context.signal,
      })
      const queueWorkId = QueueWorkIdRef(String(view.work.id))
      const queueAttemptId = QueueAttemptIdRef(String(context.attemptId))
      return Object.freeze({
        contract,
        packet,
        resolved: exactResolved,
        queueWorkId,
        queueAttemptId,
        openWorkspace: signal => dependencies.repoWorkspace.openChange({
          ownerAttemptId: queueAttemptId,
          base,
          signal,
        }),
        evidence: dependencies.evidence.bind({
          kind: 'change-attempt',
          packetId: packet.id,
          queueWorkId,
          queueAttemptId,
        }),
      } satisfies CodeChangeRunRequest)
    },
    start(prepared, context) {
      const run = dependencies.startChange(prepared, context.signal)
      return Object.freeze({
        done: settleChange(run.done, prepared),
        cancel: (reason: string) => run.cancel(reason),
      })
    },
  }
}

/**
 * Build the sole `code.verify@1` WorkHandler.
 * @param dependencies - Trusted Delivery, Queue, repository, evidence, and verifier capabilities.
 * @param config - Loader-owned verification and retry settings.
 * @returns The typed verification handler registered by this bridge.
 */
export function createCodeVerifyHandler(
  dependencies: DeliveryWorkHandlerDependencies,
  config: Config,
): WorkHandler<typeof CODE_VERIFY_KIND> {
  const settings = resolvedConfig(config)
  return {
    kind: CODE_VERIFY_KIND,
    async resolveAdmission(input, context) {
      const intent = codeVerifyIntentSchema.parse(input)
      const { packet } = exactRecords(dependencies, intent.packetId)
      if (
        intent.targetCommit === packet.baseCommit
        || intent.verificationPlanDigest !== packet.verificationPlan.digest
      ) {
        throw handlerError(
          'handler-input-invalid',
          'Delivery verification intent does not match the Packet target and plan',
        )
      }
      try {
        completedChangeFor(dependencies, packet.id, intent.targetCommit)
      } catch (cause) {
        throw new DeliveryTaskQueueError(
          'handler-input-invalid',
          'Delivery verification admission requires one exact successful bound change',
          { cause },
        )
      }
      const base = await dependencies.repoWorkspace.inspectRevision({
        repositoryId: packet.repositoryId,
        commit: packet.baseCommit,
        signal: context.signal,
      })
      const target = await dependencies.repoWorkspace.inspectRevision({
        repositoryId: packet.repositoryId,
        commit: intent.targetCommit,
        signal: context.signal,
      })
      const range = await dependencies.repoWorkspace.inspectRange({
        base,
        target,
        signal: context.signal,
      })
      if (
        range.repositoryId !== packet.repositoryId
        || range.baseCommit !== packet.baseCommit
        || range.targetCommit !== intent.targetCommit
        || !range.descendsFromBase
      ) {
        throw handlerError(
          'handler-input-invalid',
          'Delivery verification target is not an exact descendant of the Packet base',
        )
      }
      return resolvedCodeVerifySchema.parse({
        packetId: packet.id,
        contractRevisionId: packet.contractRevisionId,
        repositoryId: packet.repositoryId,
        baseCommit: packet.baseCommit,
        targetCommit: intent.targetCommit,
        trustedPlan: packet.verificationPlan,
      })
    },
    resources() {
      return [{ resource: settings.resource, units: 1 }]
    },
    policy() { return { maxAttempts: settings.maxAttempts } },
    async prepare(resolved, context) {
      const exactResolved = resolvedCodeVerifySchema.parse(resolved)
      let view
      try {
        view = exactAttemptWork(
          dependencies.operator,
          context.attemptId,
          CODE_VERIFY_KIND,
          exactResolved,
        )
      } catch (cause) {
        throw new DeliveryTaskQueueError(
          'handler-attempt-invalid',
          'Delivery verification Attempt does not own the prepared resolved facts',
          { cause },
        )
      }
      const { contract, packet } = exactRecords(
        dependencies, exactResolved.packetId,
      )
      const completionClaim = completedChangeFor(
        dependencies,
        packet.id,
        exactResolved.targetCommit,
      )
      const base = await dependencies.repoWorkspace.inspectRevision({
        repositoryId: packet.repositoryId,
        commit: packet.baseCommit,
        signal: context.signal,
      })
      const target = await dependencies.repoWorkspace.inspectRevision({
        repositoryId: packet.repositoryId,
        commit: exactResolved.targetCommit,
        signal: context.signal,
      })
      const verificationQueueWorkId = QueueWorkIdRef(String(view.work.id))
      const verificationQueueAttemptId = QueueAttemptIdRef(
        String(context.attemptId),
      )
      return Object.freeze({
        contract,
        packet,
        resolved: exactResolved,
        completionClaim,
        verificationQueueWorkId,
        verificationQueueAttemptId,
        inspectRange: signal => dependencies.repoWorkspace.inspectRange({
          base,
          target,
          signal,
        }),
        openWorkspace: signal => dependencies.repoWorkspace.openVerification({
          ownerAttemptId: verificationQueueAttemptId,
          base,
          target,
          signal,
        }),
        evidenceFor: checkId => dependencies.evidence.bind({
          kind: 'verification-check',
          packetId: packet.id,
          queueWorkId: verificationQueueWorkId,
          queueAttemptId: verificationQueueAttemptId,
          checkId,
        }),
        resolveEvidence: (evidenceId, signal) =>
          dependencies.evidence.resolve(evidenceId, signal),
        readEvidence: (reference, signal) =>
          dependencies.evidence.read(reference, signal),
      } satisfies DeliveryVerificationRunRequest)
    },
    start(prepared, context) {
      const run = dependencies.startVerification(prepared, context.signal)
      return Object.freeze({
        done: settleVerification(run.done, prepared, settings.verifierVersion),
        cancel: (reason: string) => run.cancel(reason),
      })
    },
  }
}

function disposeRegistrations(
  disposers: readonly (() => void)[],
  primary: unknown,
): never
function disposeRegistrations(disposers: readonly (() => void)[]): void
function disposeRegistrations(
  disposers: readonly (() => void)[],
  primary?: unknown,
): void {
  const hasPrimary = arguments.length === 2
  const cleanupFailures: Error[] = []
  for (const dispose of [...disposers].reverse()) {
    try {
      dispose()
    } catch (cause) {
      cleanupFailures.push(new Error(
        `Delivery Queue handler disposal failed: ${String(cause)}`,
        { cause },
      ))
    }
  }
  if (hasPrimary) {
    const primaryError = primary instanceof Error
      ? primary
      : new Error(
        `Delivery Queue activation failed: ${String(primary)}`,
        { cause: primary },
      )
    if (cleanupFailures.length === 0) throw primaryError
    throw new AggregateError(
      [primaryError, ...cleanupFailures],
      'Delivery Queue activation and registration rollback failed',
    )
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures,
      'Delivery Queue handler disposal failed',
    )
  }
}

/**
 * Register the two Delivery WorkHandlers for this plugin lifetime.
 *
 * Activation first validates every bound Queue view, then resumes only
 * persisted `submitting` handshakes through their exact idempotency keys.
 *
 * @param ctx - Cordis context carrying the declared dependencies.
 * @param config - Loader-owned runner, verifier, resource, and retry policy.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const settings = resolvedConfig(config)
  const operator = ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
  const dependencies: DeliveryWorkHandlerDependencies = {
    delivery: ctx.delivery,
    operator,
    repoWorkspace: ctx.repoWorkspace,
    evidence: ctx.deliveryEvidence,
    startChange: createCodexChangeRunner({
      spawn: ctx.subprocess.spawn.bind(ctx.subprocess),
      ...settings.model === undefined ? {} : { model: settings.model },
      permissionMode: settings.permissionMode,
      env: settings.env,
      disposeGraceMs: settings.disposeGraceMs,
      modelOutputBytes: settings.modelOutputBytes,
    }),
    startVerification: createDeliveryVerifier({
      subprocess: ctx.subprocess,
      verifierVersion: settings.verifierVersion,
      disposeGraceMs: settings.disposeGraceMs,
      verificationOutputBytes: settings.verificationOutputBytes,
    }),
  }
  await ctx.effect(async () => {
    const registrations: HandlerRegistration[] = []
    try {
      registrations.push(ctx.taskQueue.registerHandler(
        createCodeChangeHandler(dependencies, config),
        { activation: 'staged' },
      ))
      registrations.push(ctx.taskQueue.registerHandler(
        createCodeVerifyHandler(dependencies, config),
        { activation: 'staged' },
      ))
      const snapshot = ctx.delivery.snapshot()
      try {
        await reconcileDeliveryQueueBindings(
          snapshot.dispatchBindings,
          operator,
          ctx.delivery,
        )
      } catch (cause) {
        const message = cause instanceof Error
          ? cause.message
          : 'reconciliation rejected with a non-Error value'
        throw new DeliveryTaskQueueError(
          'reconciliation-invalid',
          `Delivery Queue activation reconciliation failed: ${message}`,
          { cause },
        )
      }
      for (const registration of registrations) registration.activate()
    } catch (cause) {
      disposeRegistrations(registrations, cause)
    }
    return () => {
      disposeRegistrations(registrations)
    }
  }, 'delivery-task-queue: handlers and activation reconciliation')
}
