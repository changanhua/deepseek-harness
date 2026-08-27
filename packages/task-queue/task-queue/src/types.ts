/** Queue v2 type-only domain declarations. */
import type { WorkKindMap } from './index.ts'
import type { AttentionId, AttemptId, BatchId, NotificationId, ResultId, WorkId } from './brand.ts'

export type { WorkKindMap } from './index.ts'
export type { AttentionId, AttemptId, BatchId, NotificationId, ResultId, WorkId } from './brand.ts'

/** A value accepted by canonical intent serialization. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** Declares one WorkKind's caller input, resolved spec, prepared value, and result output. */
export interface WorkKindDefinition<Input, Resolved, Prepared, Output> {
  readonly input: Input
  readonly resolved: Resolved
  readonly prepared: Prepared
  readonly output: Output
}

/** Registered WorkKind names supplied by declaration merging at the package root. */
export type WorkKind = Extract<keyof WorkKindMap, string>
/** Caller intent for a registered WorkKind. */
export type WorkInput<K extends WorkKind> = WorkKindMap[K] extends WorkKindDefinition<infer T, unknown, unknown, unknown> ? T : never
/** Admission-resolved execution specification for a WorkKind. */
export type ResolvedWork<K extends WorkKind> = WorkKindMap[K] extends WorkKindDefinition<unknown, infer T, unknown, unknown> ? T : never
/** Dispatch-prepared value for a WorkKind. */
export type PreparedWork<K extends WorkKind> = WorkKindMap[K] extends WorkKindDefinition<unknown, unknown, infer T, unknown> ? T : never
/** Successful output for a WorkKind. */
export type WorkOutput<K extends WorkKind> = WorkKindMap[K] extends WorkKindDefinition<unknown, unknown, unknown, infer T> ? T : never

/** Durable WorkItem lifecycle states. */
export type WorkStatus = 'queued' | 'starting' | 'running' | 'unknown' | 'succeeded' | 'failed' | 'canceled'
/** Durable WorkAttempt lifecycle states. */
export type AttemptStatus = 'starting' | 'running' | 'unknown' | 'succeeded' | 'failed' | 'canceled'
/** Whether an attempt may have crossed its side-effect boundary. */
export type SideEffectState = 'not-started' | 'started' | 'unknown'

/** Structured failure used by retry and operator-resolution decisions. */
export interface WorkFailure {
  readonly category: string
  readonly sideEffect: SideEffectState
  readonly retriable: boolean
  readonly message: string
}

/** Attempt policy persisted at admission. */
export interface WorkPolicy {
  readonly maxAttempts: number
}

/** Immutable admitted caller intent and resolved execution specification. */
export interface WorkItem<K extends WorkKind = WorkKind> {
  readonly id: WorkId
  readonly kind: K
  readonly title: string
  readonly intent: WorkInput<K>
  readonly intentDigest: string
  readonly resolved: ResolvedWork<K>
  readonly policy: WorkPolicy
  /** Resource units resolved and validated at admission. */
  readonly resources: readonly ResourceClaim[]
  readonly tags: readonly string[]
  readonly batchId: BatchId | null
  readonly ownerSessionId: string | null
  readonly createdAt: string
}

/** Event-derived lifecycle projection; callers never persist this record directly. */
export interface WorkState {
  readonly workId: WorkId
  readonly status: WorkStatus
  readonly attemptCount: number
  readonly activeAttemptId: AttemptId | null
  readonly resultId: ResultId | null
  readonly failure: WorkFailure | null
  readonly cancelRequestedAt: string | null
  readonly updatedAt: string
}

/** One durable execution attempt. */
export interface WorkAttempt {
  readonly id: AttemptId
  readonly workId: WorkId
  readonly ordinal: number
  readonly status: AttemptStatus
  readonly startedAt: string
  readonly runningAt: string | null
  readonly finishedAt: string | null
  readonly failure: WorkFailure | null
}

/** Typed successful result owned by one WorkItem and WorkAttempt. */
export interface WorkResult<K extends WorkKind = WorkKind> {
  readonly id: ResultId
  readonly workId: WorkId
  readonly attemptId: AttemptId
  readonly kind: K
  readonly output: WorkOutput<K>
  readonly createdAt: string
}

/** Homogeneous atomic admission group. */
export interface Batch<K extends WorkKind = WorkKind> {
  readonly id: BatchId
  readonly kind: K
  readonly sharedPayload: JsonValue
  readonly workIds: readonly WorkId[]
  readonly maxParallel: number
  readonly createdAt: string
}

/** Operator- or owner-facing durable attention record. */
export interface Attention {
  readonly id: AttentionId
  readonly workId: WorkId
  readonly kind: 'completion' | 'failure' | 'unknown'
  readonly status: 'pending' | 'resolved'
  readonly createdAt: string
  readonly resolvedAt: string | null
}

/** Durable owner notification outbox record. */
export interface Notification {
  readonly id: NotificationId
  readonly workId: WorkId
  /** Terminal ChangeSet sequence that created this notification. */
  readonly terminalSeq: number
  /** Attempt whose terminal outcome this notification reports. */
  readonly attemptId: AttemptId | null
  /** Successful result when the terminal outcome succeeded. */
  readonly resultId: ResultId | null
  readonly ownerSessionId: string
  readonly messageId: string
  readonly status: 'pending' | 'acknowledged'
  readonly createdAt: string
  readonly acknowledgedAt: string | null
}

/** Admission idempotency receipt committed with its WorkItems and optional Batch. */
export interface Receipt {
  readonly owner: { readonly type: 'agent'; readonly sessionId: string } | { readonly type: 'operator' }
  readonly source: string
  readonly key: string
  readonly intentDigest: string
  readonly workIds: readonly WorkId[]
  readonly batchId: BatchId | null
  readonly createdAt: string
}

/** Scheduler resource units declared by a WorkHandler. */
export interface ResourceClaim {
  readonly resource: string
  readonly units: number
}

/** Context available while resolving first admission. */
export interface AdmissionContext { readonly signal: AbortSignal }
/** Context available while preparing dispatch. */
export interface PrepareContext { readonly attemptId: AttemptId; readonly signal: AbortSignal }
/** Context available at the side-effect boundary. */
export interface StartContext {
  readonly attemptId: AttemptId
  readonly signal: AbortSignal
}

/** Live attempt settlement returned by WorkHandler.start. */
export type AttemptOutcome<K extends WorkKind> =
  | { readonly status: 'succeeded'; readonly output: WorkOutput<K> }
  | { readonly status: 'failed'; readonly failure: WorkFailure }
  | { readonly status: 'unknown'; readonly failure: WorkFailure }
  | { readonly status: 'canceled' }

/** Live ownership returned synchronously when a side effect may begin. */
export interface LiveAttempt<K extends WorkKind> {
  readonly done: Promise<AttemptOutcome<K>>
  /** Request cancellation and resolve after the implementation has processed it. */
  cancel(reason: string): Promise<void>
}

/** Four-phase typed work implementation. */
export interface WorkHandler<K extends WorkKind> {
  readonly kind: K
  /** Resolve caller intent exactly once after idempotency lookup misses. */
  resolveAdmission(input: WorkInput<K>, context: AdmissionContext): Promise<ResolvedWork<K>>
  /** Return synchronous resource claims for the persisted resolved specification. */
  resources(resolved: ResolvedWork<K>): readonly ResourceClaim[]
  /** Return the retry policy that becomes immutable with this admitted WorkItem. */
  policy(resolved: ResolvedWork<K>): WorkPolicy
  /** Prepare dispatch without beginning an external side effect. */
  prepare(resolved: ResolvedWork<K>, context: PrepareContext): Promise<PreparedWork<K>>
  /** Begin possible side effects and synchronously return live ownership. */
  start(prepared: PreparedWork<K>, context: StartContext): LiveAttempt<K>
}

/** Opaque provider-verified Agent capability. */
export interface VerifiedAgentAuthority { readonly kind: 'agent'; readonly sessionId: string }
/** Opaque provider-verified operator capability. */
export interface VerifiedOperatorAuthority { readonly kind: 'operator' }

/** Operator resolution of an unknown attempt. */
export type UnknownResolution =
  | { readonly kind: 'confirm-failed'; readonly failure: WorkFailure }
  | { readonly kind: 'authorize-retry' }

/** Logical facts contained by one atomic ChangeSet. */
export type DomainEvent =
  | { readonly type: 'work/admitted'; readonly work: WorkItem }
  | { readonly type: 'batch/admitted'; readonly batch: Batch }
  | { readonly type: 'receipt/recorded'; readonly receipt: Receipt }
  | { readonly type: 'attempt/started'; readonly attempt: Pick<WorkAttempt, 'id' | 'workId' | 'ordinal' | 'startedAt'> }
  | { readonly type: 'attempt/running'; readonly attemptId: AttemptId; readonly at: string }
  | { readonly type: 'attempt/unknown'; readonly attemptId: AttemptId; readonly failure: WorkFailure; readonly at: string }
  | { readonly type: 'attempt/succeeded'; readonly attemptId: AttemptId; readonly result: WorkResult; readonly at: string }
  | { readonly type: 'attempt/failed'; readonly attemptId: AttemptId; readonly failure: WorkFailure; readonly at: string }
  | { readonly type: 'cancel/requested'; readonly workId: WorkId; readonly at: string }
  | { readonly type: 'work/canceled'; readonly workId: WorkId; readonly at: string }
  | { readonly type: 'work/manual-retry-authorized'; readonly workId: WorkId; readonly at: string }
  | { readonly type: 'work/auto-retry-authorized'; readonly workId: WorkId; readonly at: string }
  | { readonly type: 'unknown/resolved'; readonly attemptId: AttemptId; readonly resolution: UnknownResolution; readonly at: string }
  | { readonly type: 'attention/created'; readonly attention: Attention }
  | { readonly type: 'attention/resolved'; readonly attentionId: AttentionId; readonly at: string }
  | { readonly type: 'notification/created'; readonly notification: Notification }
  | { readonly type: 'notification/acknowledged'; readonly notificationId: NotificationId; readonly expectedMessageId: string; readonly at: string }

/** Sole durable append unit. */
export interface ChangeSet {
  readonly seq: number
  readonly changeId: string
  readonly at: string
  readonly events: readonly DomainEvent[]
}

/** Serialized projection used by the local store to resume incremental folding. */
export interface QueueFoldSnapshot {
  readonly lastSeq: number
  readonly changeIds: readonly string[]
  readonly works: readonly WorkItem[]
  readonly states: readonly WorkState[]
  readonly attempts: readonly WorkAttempt[]
  readonly results: readonly WorkResult[]
  readonly batches: readonly Batch[]
  readonly attentions: readonly Attention[]
  readonly notifications: readonly Notification[]
  readonly receipts: readonly Receipt[]
}

/** Read model for one WorkItem and its derived records. */
export interface WorkView {
  readonly work: WorkItem
  readonly state: WorkState
  readonly attempts: readonly WorkAttempt[]
  readonly result: WorkResult | null
}

/** Single WorkItem admission request. */
export interface EnqueueRequest<K extends WorkKind> {
  readonly kind: K
  readonly title: string
  readonly input: WorkInput<K>
  readonly idempotencyKey: string
  readonly tags?: readonly string[]
}
/** One ordered WorkItem admitted as part of a homogeneous Batch. */
export interface BatchItem<K extends WorkKind> {
  readonly title: string
  readonly input: WorkInput<K>
  readonly tags?: readonly string[]
}
/** Homogeneous Batch admission request. */
export interface BatchRequest<K extends WorkKind> {
  readonly kind: K
  readonly items: readonly BatchItem<K>[]
  readonly sharedPayload: JsonValue
  readonly idempotencyKey: string
  readonly maxParallel: number
}

/** Agent-authorized queue operations. */
export interface AgentWorkQueue {
  enqueue<K extends WorkKind>(request: EnqueueRequest<K>): Promise<WorkId>
  enqueueBatch<K extends WorkKind>(request: BatchRequest<K>): Promise<BatchId>
  /** List the WorkItems durably owned by the issuing Agent session. */
  list(): readonly WorkView[]
  get(id: WorkId): WorkView
  cancel(id: WorkId): Promise<void>
  retry(id: WorkId): Promise<void>
  pendingNotifications(): readonly Notification[]
  acknowledgeNotification(id: NotificationId, messageId: string): Promise<void>
}

/** Operator-authorized queue operations. */
export interface OperatorWorkQueue {
  /** List every WorkItem visible to the trusted host operator. */
  list(): readonly WorkView[]
  get(id: WorkId): WorkView
  cancel(id: WorkId): Promise<void>
  retry(id: WorkId): Promise<void>
  pause(): void
  resume(): void
  resolveUnknown(workId: WorkId, resolution: UnknownResolution): Promise<void>
  pendingAttentions(): readonly Attention[]
}
