/** Queue v2 Service Definition and public domain API. */
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  AgentWorkQueue, OperatorWorkQueue, VerifiedAgentAuthority, VerifiedOperatorAuthority,
  WorkHandler, WorkKind,
} from './types.ts'

/** Declaration-merging registry populated at the package root by WorkHandler packages. */
export interface WorkKindMap {}

export type {
  AdmissionContext, AgentWorkQueue, Attention, AttemptOutcome, AttemptStatus,
  Batch, BatchItem, BatchRequest, ChangeSet, DomainEvent, EnqueueRequest, JsonValue, LiveAttempt, Notification,
  OperatorWorkQueue, PreparedWork, PrepareContext, QueueFoldSnapshot, Receipt, ResolvedWork, ResourceClaim,
  SideEffectState, StartContext, UnknownResolution, VerifiedAgentAuthority, VerifiedOperatorAuthority,
  WorkAttempt, WorkFailure, WorkHandler, WorkInput, WorkItem, WorkKind, WorkKindDefinition,
  WorkOutput, WorkPolicy, WorkResult, WorkState, WorkStatus, WorkView,
} from './types.ts'
export { AttentionId, AttemptId, BatchId, NotificationId, ResultId, WorkId } from './brand.ts'
export { createVerifiedAgentAuthority, createVerifiedOperatorAuthority, assertVerifiedAgentAuthority, assertVerifiedOperatorAuthority } from './authority.ts'
export { applyChange, foldChanges, hydrateFoldedQueue, lookupReceipt, snapshotFoldedQueue } from './fold.ts'
export type { FoldedQueue } from './fold.ts'
export { canAutoRetry, isTerminalState } from './transitions.ts'
export { canonicalJson, canonicalQueueState, digestIntent } from './canonical.ts'

/** Event names emitted only after a ChangeSet or fault is committed. */
export const TASK_QUEUE_EVENTS = {
  changed: 'task-queue/changed',
} as const

declare module '@deepseek-ai/cordis' {
  interface Context { taskQueue: TaskQueue }
  interface Events {
    /**
     * Emitted after one complete ChangeSet is durable and folded.
     * @param payload - Durable ChangeSet identity.
     * @mode emit
     */
    'task-queue/changed'(payload: { seq: number; changeId: string }): void
  }
}

/** Durable typed work queue whose provider verifies authority before facade creation. */
export abstract class TaskQueue extends Service {
  /** @param ctx - Cordis context receiving the service. */
  constructor(ctx: Context) {
    if (new.target === TaskQueue) throw new Error('@deepseek-ai/dsh-task-queue is abstract; load a durable provider')
    super(ctx, 'taskQueue')
  }

  /**
   * Bind queue operations to verified Agent authority.
   * @param authority - Opaque capability verified by the provider.
   * @returns Agent-scoped operations.
   */
  abstract forAgent(authority: VerifiedAgentAuthority): AgentWorkQueue

  /**
   * Bind queue operations to verified operator authority.
   * @param authority - Opaque operator capability verified by the provider.
   * @returns Operator-only operations.
   */
  abstract forOperator(authority: VerifiedOperatorAuthority): OperatorWorkQueue

  /**
   * Register one typed WorkHandler.
   * @param handler - Typed handler to register.
   * @returns A disposer for exactly this registration.
   */
  abstract registerHandler<K extends WorkKind>(handler: WorkHandler<K>): () => void

  /**
   * List registered WorkKinds.
   * @returns Registered WorkKinds in stable order.
   */
  abstract listKinds(): readonly WorkKind[]
}

export default TaskQueue
