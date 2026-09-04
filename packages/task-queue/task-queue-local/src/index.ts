/** Queue v2 local provider: isolated durable admission and handler registry. */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  assertVerifiedAgentAuthority, assertVerifiedOperatorAuthority, canAutoRetry, canonicalJson, digestIntent,
  AttentionId, NotificationId, lookupReceipt, TaskQueue, WorkId, AttemptId, BatchId, ResultId,
} from '@changanhua/dsh-task-queue'
import type {
  AgentWorkQueue, AttemptOutcome, BatchRequest, ChangeSet, EnqueueRequest, LiveAttempt, OperatorWorkQueue,
  PreparedWork, Receipt, ResourceClaim, UnknownResolution, VerifiedAgentAuthority, VerifiedOperatorAuthority,
  WorkFailure, WorkHandler, ResolvedWork, WorkItem, WorkKind, WorkPolicy, WorkView,
} from '@changanhua/dsh-task-queue'
import { WorkQueueStore } from './v2-store.ts'

type AdmissionAuthority = VerifiedAgentAuthority | VerifiedOperatorAuthority
type HandlerRegistration = (() => void) & { activate(): void }
type HandlerRegistrationOptions = {
  readonly activation?: 'immediate' | 'staged'
}

interface AdmissionScope {
  readonly owner: Receipt['owner']
  readonly source: 'agent' | 'operator'
  readonly ownerSessionId: string | null
}

interface Execution {
  readonly workId: WorkId
  readonly claims: readonly ResourceClaim[]
  readonly controller: AbortController
  readonly registration: HandlerEntry
  startInvoked: boolean
  live: LiveAttempt<WorkKind> | null
  settled: Promise<void> | null
}

interface HandlerEntry {
  readonly handler: WorkHandler<WorkKind>
  active: boolean
  disposed: boolean
}

function failure(category: string, error: unknown, sideEffect: WorkFailure['sideEffect'], retriable: boolean): WorkFailure {
  return { category, sideEffect, retriable, message: error instanceof Error ? error.message : 'Queue operation failed' }
}

function firstWorkId(ids: readonly WorkId[]): WorkId {
  const id = ids[0]
  if (id === undefined) throw new Error('task queue receipt contains no WorkItems')
  return id
}

function isAborted(signal: AbortSignal): boolean { return signal.aborted }
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000

function admissionScope(authority: AdmissionAuthority): AdmissionScope {
  if (authority.kind === 'agent') {
    return {
      owner: { type: 'agent', sessionId: authority.sessionId },
      source: 'agent',
      ownerSessionId: authority.sessionId,
    }
  }
  return {
    owner: { type: 'operator' },
    source: 'operator',
    ownerSessionId: null,
  }
}

/** Local Queue v2 configuration. */
export interface Config {
  /** Schema-v3 Queue root; the composing row must keep older formats in a separate directory. */
  queueRoot: string
  /** Maximum simultaneous prepared or live attempts. */
  maxConcurrent?: number
  /** Deployment capacity by handler-declared resource name. */
  resourceCapacity?: Record<string, number>
  /** Maximum time teardown or post-start durability cleanup waits for execution quiescence. */
  shutdownTimeoutMs?: number
}

/** Durable v2 provider. Handler registration remains effect-scoped at composition sites. */
export class LocalTaskQueue extends TaskQueue {
  static Config: z<Config> = z.object({
    queueRoot: z.string(),
    maxConcurrent: z.number().min(1).step(1).default(8),
    resourceCapacity: z.dict(z.number().min(1).step(1)).default({}),
    shutdownTimeoutMs: z.number().min(1).step(1).default(DEFAULT_SHUTDOWN_TIMEOUT_MS),
  })
  private readonly store: WorkQueueStore
  private readonly handlers = new Map<WorkKind, HandlerEntry>()
  private readonly ready: Promise<void>
  private readonly pendingAdmissions = new Map<string, {
    readonly intentDigest: string
    readonly result: Promise<WorkId | BatchId>
  }>()
  private readonly maxConcurrent: number
  private readonly resourceCapacity: Readonly<Record<string, number>>
  private readonly shutdownTimeoutMs: number
  private readonly executing = new Map<AttemptId, Execution>()
  private pumping = false
  private paused = false
  private closing = false
  private shutdownPromise: Promise<void> | undefined

  /** @param ctx - Cordis context. @param config - isolated v2 root. */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.store = new WorkQueueStore(config.queueRoot)
    this.maxConcurrent = config.maxConcurrent ?? 8
    this.resourceCapacity = Object.freeze({ ...config.resourceCapacity })
    this.shutdownTimeoutMs = config.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
    this.ready = this.initialize()
    const shutdown = () => this.shutdown()
    this.ctx.effect(function* () { yield shutdown }, 'task-queue-v2 ownership')
  }

  /** Finish durable recovery before Cordis reports the service plugin ready. */
  protected async [Service.init](): Promise<void> {
    await this.ready
  }

  /** Bind queue methods to an issued agent authority. */
  forAgent(authority: VerifiedAgentAuthority): AgentWorkQueue {
    assertVerifiedAgentAuthority(authority)
    return {
      enqueue: request => this.enqueue(authority, request),
      enqueueBatch: request => this.enqueueBatch(authority, request),
      list: () => this.listForAgent(authority),
      get: id => this.viewForAgent(authority, id),
      cancel: id => this.cancelForAgent(authority, id),
      retry: id => this.retryForAgent(authority, id),
      pendingNotifications: () => this.pendingNotifications(authority),
      acknowledgeNotification: (id, messageId) => this.acknowledgeNotification(authority, id, messageId),
    }
  }

  /** Bind queue methods to an issued operator authority. */
  forOperator(authority: VerifiedOperatorAuthority): OperatorWorkQueue {
    assertVerifiedOperatorAuthority(authority)
    return {
      enqueue: request => this.enqueue(authority, request),
      enqueueBatch: request => this.enqueueBatch(authority, request),
      list: () => this.listAll(),
      get: id => this.view(id),
      cancel: id => this.cancel(id),
      retry: id => this.retry(id),
      pause: () => { this.paused = true },
      resume: () => { this.paused = false; void this.pump() },
      resolveUnknown: (id, resolution) => this.resolveUnknown(id, resolution),
      pendingAttentions: () => this.pendingAttentions(),
    }
  }

  /** Register one exact admission owner with immediate or staged dispatch. */
  registerHandler<K extends WorkKind>(
    handler: WorkHandler<K>,
    options: HandlerRegistrationOptions = {},
  ): HandlerRegistration {
    if (this.handlers.has(handler.kind)) {
      throw new Error(`task queue handler already registered for ${String(handler.kind)}`)
    }
    const entry: HandlerEntry = {
      handler,
      active: options.activation !== 'staged',
      disposed: false,
    }
    this.handlers.set(handler.kind, entry)
    const registration = (() => {
      if (entry.disposed) return
      entry.disposed = true
      if (this.handlers.get(handler.kind) === entry) {
        this.handlers.delete(handler.kind)
      }
      for (const execution of this.executing.values()) {
        if (
          execution.registration === entry
          && !execution.startInvoked
        ) {
          execution.controller.abort('task queue handler registration disposed before start')
        }
      }
    }) as HandlerRegistration
    registration.activate = () => {
      if (entry.disposed || this.handlers.get(handler.kind) !== entry) {
        throw new Error(`task queue handler registration is disposed for ${String(handler.kind)}`)
      }
      if (entry.active) {
        throw new Error(`task queue handler registration is already active for ${String(handler.kind)}`)
      }
      entry.active = true
      void this.pump()
    }
    if (entry.active) void this.pump()
    return registration
  }

  /** Return stable registered kinds. */
  listKinds(): readonly WorkKind[] { return Object.freeze([...this.handlers.keys()].sort()) }

  private async enqueue<K extends WorkKind>(authority: AdmissionAuthority, request: EnqueueRequest<K>): Promise<WorkId> {
    this.assertAccepting()
    const intentDigest = digestIntent(request.input)
    return this.admitOnce(authority, request.idempotencyKey, intentDigest, () => this.admitSingle(authority, request, intentDigest))
  }

  private async admitSingle<K extends WorkKind>(
    authority: AdmissionAuthority,
    request: EnqueueRequest<K>,
    intentDigest: string,
  ): Promise<WorkId> {
    await this.ready
    const handler = this.requireHandler(request.kind)
    const scope = admissionScope(authority)
    const prior = lookupReceipt(this.store.current(), scope.owner, scope.source, request.idempotencyKey, intentDigest)
    if (prior !== null) return firstWorkId(prior)
    const resolved = await handler.resolveAdmission(request.input, { signal: new AbortController().signal })
    const resources = this.resolveClaims(handler, resolved)
    const policy = this.resolvePolicy(handler, resolved)
    return this.store.transaction(async () => {
      this.assertAccepting()
      const committed = lookupReceipt(this.store.current(), scope.owner, scope.source, request.idempotencyKey, intentDigest)
      if (committed !== null) return firstWorkId(committed)
      const now = new Date().toISOString()
      const id = WorkId(randomUUID())
      const work: WorkItem = {
        id, kind: request.kind, title: request.title, intent: request.input, intentDigest, resolved,
        policy, resources, tags: request.tags ?? [], batchId: null,
        ownerSessionId: scope.ownerSessionId, createdAt: now,
      }
      const change = this.change([
        { type: 'work/admitted', work },
        {
          type: 'receipt/recorded',
          receipt: {
            owner: scope.owner, source: scope.source, key: request.idempotencyKey, intentDigest,
            workIds: [id], batchId: null, createdAt: now,
          },
        },
      ])
      await this.store.append(change)
      this.ctx.emit('task-queue/changed', { seq: change.seq, changeId: change.changeId })
      void this.pump()
      return id
    })
  }

  private async enqueueBatch<K extends WorkKind>(authority: AdmissionAuthority, request: BatchRequest<K>): Promise<BatchId> {
    this.assertAccepting()
    const intentDigest = digestIntent({
      kind: request.kind,
      items: request.items,
      sharedPayload: request.sharedPayload,
      maxParallel: request.maxParallel,
    })
    return this.admitOnce(authority, request.idempotencyKey, intentDigest, () => this.admitBatch(authority, request, intentDigest))
  }

  private async admitBatch<K extends WorkKind>(
    authority: AdmissionAuthority,
    request: BatchRequest<K>,
    intentDigest: string,
  ): Promise<BatchId> {
    await this.ready
    if (request.items.length === 0
      || !Number.isSafeInteger(request.maxParallel)
      || request.maxParallel < 1) {
      throw new Error('task queue Batch requires items and positive maxParallel')
    }
    const handler = this.requireHandler(request.kind)
    const scope = admissionScope(authority)
    const prior = lookupReceipt(this.store.current(), scope.owner, scope.source, request.idempotencyKey, intentDigest)
    if (prior !== null) {
      const priorWork = this.store.current().worksById.get(firstWorkId(prior))
      if (priorWork?.batchId === null || priorWork?.batchId === undefined) {
        throw new Error('task queue Batch receipt does not reference a Batch WorkItem')
      }
      return priorWork.batchId
    }
    const admitted = await Promise.all(request.items.map(async (item) => {
      const resolved = await handler.resolveAdmission(item.input, { signal: new AbortController().signal })
      return { item, resolved, resources: this.resolveClaims(handler, resolved), policy: this.resolvePolicy(handler, resolved) }
    }))
    return this.store.transaction(async () => {
      this.assertAccepting()
      const committed = lookupReceipt(this.store.current(), scope.owner, scope.source, request.idempotencyKey, intentDigest)
      if (committed !== null) {
        const priorWork = this.store.current().worksById.get(firstWorkId(committed))
        if (priorWork?.batchId === null || priorWork?.batchId === undefined) throw new Error('task queue Batch receipt does not reference a Batch WorkItem')
        return priorWork.batchId
      }
      const now = new Date().toISOString()
      const batchId = BatchId(randomUUID())
      const works = admitted.map(({ item, resolved, resources, policy }): WorkItem => ({
        id: WorkId(randomUUID()), kind: request.kind, title: item.title, intent: item.input,
        intentDigest: digestIntent(item.input), resolved, policy, resources, tags: item.tags ?? [],
        batchId, ownerSessionId: scope.ownerSessionId, createdAt: now,
      }))
      const events: ChangeSet['events'] = [
        { type: 'batch/admitted', batch: { id: batchId, kind: request.kind, sharedPayload: request.sharedPayload, workIds: works.map(work => work.id), maxParallel: request.maxParallel, createdAt: now } },
        ...works.map(work => ({ type: 'work/admitted' as const, work })),
        { type: 'receipt/recorded', receipt: { owner: scope.owner, source: scope.source, key: request.idempotencyKey, intentDigest, workIds: works.map(work => work.id), batchId, createdAt: now } },
      ]
      const change = this.change(events)
      await this.store.append(change)
      this.ctx.emit('task-queue/changed', { seq: change.seq, changeId: change.changeId })
      void this.pump()
      return batchId
    })
  }

  private view(id: WorkId): WorkView {
    const folded = this.store.current()
    const work = folded.worksById.get(id)
    const state = folded.statesByWorkId.get(id)
    if (work === undefined || state === undefined) throw new Error(`unknown WorkItem ${id}`)
    const attempts = [...folded.attemptsById.values()].filter(attempt => attempt.workId === id)
    return Object.freeze({
      work,
      state,
      attempts: Object.freeze(attempts),
      result: state.resultId === null ? null : folded.resultsById.get(state.resultId) ?? null,
    })
  }

  /** Read one WorkItem only when its durable owner matches the issued Agent authority. */
  private viewForAgent(authority: VerifiedAgentAuthority, id: WorkId): WorkView {
    const view = this.view(id)
    if (view.work.ownerSessionId !== authority.sessionId) throw new Error(`WorkItem ${id} is not owned by this Agent session`)
    return view
  }

  /** List only WorkItems whose durable owner matches the issued Agent authority. */
  private listForAgent(authority: VerifiedAgentAuthority): readonly WorkView[] {
    return Object.freeze(
      [...this.store.current().worksById.values()]
        .filter(work => work.ownerSessionId === authority.sessionId)
        .map(work => this.view(work.id)),
    )
  }

  /** List the complete durable projection for trusted operator surfaces. */
  private listAll(): readonly WorkView[] {
    return Object.freeze([...this.store.current().worksById.values()].map(work => this.view(work.id)))
  }

  private pendingNotifications(authority: VerifiedAgentAuthority): readonly import('@changanhua/dsh-task-queue').Notification[] {
    return Object.freeze([...this.store.current().notificationsById.values()]
      .filter(value => value.ownerSessionId === authority.sessionId && value.status === 'pending')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)))
  }

  private async acknowledgeNotification(authority: VerifiedAgentAuthority, id: NotificationId, messageId: string): Promise<void> {
    const notification = this.store.current().notificationsById.get(id)
    if (notification === undefined || notification.ownerSessionId !== authority.sessionId) throw new Error(`Notification ${id} is not owned by this Agent session`)
    await this.commit([{ type: 'notification/acknowledged', notificationId: id, expectedMessageId: messageId, at: new Date().toISOString() }])
  }

  private pendingAttentions(): readonly import('@changanhua/dsh-task-queue').Attention[] {
    return Object.freeze([...this.store.current().attentionsById.values()]
      .filter(value => value.status === 'pending')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)))
  }

  /** Cancel a WorkItem after applying the Agent ownership fence. */
  private async cancelForAgent(authority: VerifiedAgentAuthority, id: WorkId): Promise<void> {
    this.viewForAgent(authority, id)
    await this.cancel(id)
  }

  /** Retry a WorkItem after applying the Agent ownership fence. */
  private async retryForAgent(authority: VerifiedAgentAuthority, id: WorkId): Promise<void> {
    this.viewForAgent(authority, id)
    await this.retry(id)
  }

  private async cancel(id: WorkId): Promise<void> {
    await this.ready
    const state = this.store.current().statesByWorkId.get(id)
    if (state === undefined) throw new Error(`unknown WorkItem ${id}`)
    if (state.status === 'succeeded' || state.status === 'failed' || state.status === 'canceled') throw new Error(`cannot cancel terminal WorkItem ${id}`)
    const now = new Date().toISOString()
    if (state.status === 'queued') {
      const work = this.store.current().worksById.get(id)
      const events: Array<ChangeSet['events'][number]> = [{ type: 'cancel/requested', workId: id, at: now }, { type: 'work/canceled', workId: id, at: now }]
      if (work?.ownerSessionId !== null && work !== undefined) events.push(this.notification(id, null, null, work.ownerSessionId, now))
      await this.commit(events)
      return
    }
    await this.commit([{ type: 'cancel/requested', workId: id, at: now }])
    const execution = state.activeAttemptId === null ? undefined : this.executing.get(state.activeAttemptId)
    execution?.controller.abort('canceled by owner')
    if (execution?.live !== null && execution?.live !== undefined) await execution.live.cancel('canceled by owner')
  }

  private async retry(id: WorkId): Promise<void> {
    await this.ready
    const state = this.store.current().statesByWorkId.get(id)
    if (state?.status !== 'failed') throw new Error(`manual retry requires failed WorkItem ${id}`)
    await this.commit([{ type: 'work/manual-retry-authorized', workId: id, at: new Date().toISOString() }])
    void this.pump()
  }

  private async resolveUnknown(id: WorkId, resolution: UnknownResolution): Promise<void> {
    await this.ready
    const state = this.store.current().statesByWorkId.get(id)
    if (state?.status !== 'unknown' || state.activeAttemptId === null) throw new Error(`unknown resolution requires active unknown WorkItem ${id}`)
    const at = new Date().toISOString()
    const attention = [...this.store.current().attentionsById.values()].find(value => value.workId === id && value.status === 'pending')
    const work = this.store.current().worksById.get(id)
    const events: Array<ChangeSet['events'][number]> = [{ type: 'unknown/resolved', attemptId: state.activeAttemptId, resolution, at }]
    if (attention !== undefined) events.push({ type: 'attention/resolved', attentionId: attention.id, at })
    if (resolution.kind === 'confirm-failed' && work?.ownerSessionId !== null && work !== undefined) {
      events.push(this.notification(id, state.activeAttemptId, null, work.ownerSessionId, at))
    }
    await this.commit(events)
    void this.pump()
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.dispatchIsPaused()) return
    this.pumping = true
    try {
      await this.ready
      while (this.executing.size < this.maxConcurrent) {
        if (this.dispatchIsPaused()) break
        const claimed = await this.claimNext()
        if (claimed === null) break
        const settled = this.execute(claimed).finally(() => {
          this.executing.delete(claimed.attemptId)
          void this.pump()
        })
        claimed.execution.settled = settled
        void settled.catch(() => undefined)
      }
    } finally {
      this.pumping = false
    }
  }

  private dispatchIsPaused(): boolean { return this.paused || this.closing }

  private async claimNext(): Promise<{
    readonly attemptId: AttemptId
    readonly handler: WorkHandler<WorkKind>
    readonly work: WorkItem
    readonly execution: Execution
  } | null> {
    return this.store.transaction(async () => {
      const candidate = [...this.store.current().worksById.values()].find((work) => {
        const state = this.store.current().statesByWorkId.get(work.id)
        const registration = this.handlers.get(work.kind)
        return state?.status === 'queued'
          && registration?.active === true
          && this.canClaim(work)
      })
      if (candidate === undefined) return null
      const registration = this.requireActiveRegistration(candidate.kind)
      const claims = candidate.resources
      const attemptId = AttemptId(randomUUID())
      const now = new Date().toISOString()
      const state = this.store.current().statesByWorkId.get(candidate.id)
      if (state?.status !== 'queued') throw new Error('task queue claim candidate is no longer queued')
      const execution: Execution = {
        workId: candidate.id,
        claims,
        controller: new AbortController(),
        registration,
        startInvoked: false,
        live: null,
        settled: null,
      }
      this.executing.set(attemptId, execution)
      try {
        await this.commitInTransaction([{
          type: 'attempt/started',
          attempt: {
            id: attemptId,
            workId: candidate.id,
            ordinal: state.attemptCount + 1,
            startedAt: now,
          },
        }])
      } catch (error) {
        this.executing.delete(attemptId)
        throw error
      }
      return {
        attemptId,
        handler: registration.handler,
        work: candidate,
        execution,
      }
    })
  }

  private async execute(claimed: {
    readonly attemptId: AttemptId
    readonly handler: WorkHandler<WorkKind>
    readonly work: WorkItem
    readonly execution: Execution
  }): Promise<void> {
    const { attemptId, handler, work, execution } = claimed
    let prepared: PreparedWork<WorkKind>
    try {
      prepared = await handler.prepare(work.resolved, { attemptId, signal: execution.controller.signal })
    } catch (error) {
      if (isAborted(execution.controller.signal)) await this.settleCanceled(work.id)
      else await this.settleFailure(attemptId, failure('prepare-threw', error, 'not-started', true))
      return
    }
    if (isAborted(execution.controller.signal)) {
      await this.settleCanceled(work.id)
      return
    }
    let live: LiveAttempt<WorkKind>
    try {
      execution.startInvoked = true
      live = handler.start(prepared, { attemptId, signal: execution.controller.signal })
    } catch (error) {
      await this.settleFailure(attemptId, failure('start-threw', error, 'unknown', false))
      return
    }
    execution.live = live
    await this.executeStartedAttempt(attemptId, work, execution, live)
  }

  /** Never let a post-start error fall back into the safe pre-start retry path. */
  private async executeStartedAttempt(
    attemptId: AttemptId,
    work: WorkItem,
    execution: Execution,
    live: LiveAttempt<WorkKind>,
  ): Promise<void> {
    try {
      await this.commit([{ type: 'attempt/running', attemptId, at: new Date().toISOString() }])
    } catch (error) {
      const durabilityFailure = failure('post-start-durability', error, 'unknown', false)
      const reason = 'task queue could not persist the running attempt'
      execution.controller.abort(reason)
      const cleanup = await this.quiesceAfterRunningCommitFailure(live, reason)
      await this.settlePostStartUnknown(attemptId, cleanup === null
        ? durabilityFailure
        : { ...durabilityFailure, message: `${durabilityFailure.message}; ${cleanup}` })
      return
    }

    let outcome: AttemptOutcome<WorkKind>
    try {
      outcome = await live.done
    } catch (error) {
      await this.settlePostStartUnknown(
        attemptId,
        failure('live-attempt-rejected', error, 'unknown', false),
      )
      return
    }
    if (outcome.status === 'unknown') {
      await this.settlePostStartUnknown(attemptId, outcome.failure)
      return
    }
    try {
      if (outcome.status === 'succeeded') {
        await this.settleSuccess(attemptId, outcome.output)
      } else if (outcome.status === 'failed') {
        if (isAborted(execution.controller.signal)) await this.settleCanceled(work.id)
        else await this.settleFailure(attemptId, outcome.failure)
      } else {
        await this.settleCanceled(work.id)
      }
    } catch (error) {
      await this.settlePostStartUnknown(
        attemptId,
        failure('post-start-settlement', error, 'unknown', false),
      )
    }
  }

  private async settleFailure(attemptId: AttemptId, value: WorkFailure): Promise<void> {
    await this.store.transaction(async () => {
      const attempt = this.store.current().attemptsById.get(attemptId)
      const state = this.store.current().statesByWorkId.get(attempt?.workId ?? WorkId(''))
      const work = attempt === undefined ? undefined : this.store.current().worksById.get(attempt.workId)
      if ((state?.status === 'starting' || state?.status === 'running') && work !== undefined) {
        const now = new Date().toISOString()
        const events: Array<ChangeSet['events'][number]> = [{ type: 'attempt/failed', attemptId, failure: value, at: now }]
        if (canAutoRetry(value) && state.attemptCount < work.policy.maxAttempts) {
          events.push({ type: 'work/auto-retry-authorized', workId: work.id, at: now })
        } else if (work.ownerSessionId !== null) {
          events.push(this.notification(work.id, attemptId, null, work.ownerSessionId, now))
        }
        await this.commitInTransaction(events)
      }
    })
  }

  private async settleSuccess(attemptId: AttemptId, output: unknown): Promise<void> {
    await this.store.transaction(async () => {
      const attempt = this.store.current().attemptsById.get(attemptId)
      const state = this.store.current().statesByWorkId.get(attempt?.workId ?? WorkId(''))
      const work = attempt === undefined ? undefined : this.store.current().worksById.get(attempt.workId)
      if (attempt === undefined || work === undefined || state?.status !== 'running') return
      const now = new Date().toISOString()
      if (state.cancelRequestedAt !== null) {
        const events: Array<ChangeSet['events'][number]> = [{ type: 'work/canceled', workId: work.id, at: now }]
        if (work.ownerSessionId !== null) events.push(this.notification(work.id, attemptId, null, work.ownerSessionId, now))
        await this.commitInTransaction(events)
        return
      }
      const resultId = ResultId(randomUUID())
      const events: Array<ChangeSet['events'][number]> = [{
        type: 'attempt/succeeded', attemptId,
        result: { id: resultId, workId: work.id, attemptId, kind: work.kind, output: output, createdAt: now }, at: now,
      }]
      if (work.ownerSessionId !== null) events.push(this.notification(work.id, attemptId, resultId, work.ownerSessionId, now))
      await this.commitInTransaction(events)
    })
  }

  private notification(workId: WorkId, attemptId: AttemptId | null, resultId: ResultId | null, ownerSessionId: string, at: string): ChangeSet['events'][number] {
    const id = NotificationId(randomUUID())
    return {
      type: 'notification/created',
      notification: {
        id, workId, terminalSeq: this.store.current().lastSeq + 1,
        attemptId, resultId, ownerSessionId, messageId: `task-queue-notification:${id}`,
        status: 'pending', createdAt: at, acknowledgedAt: null,
      },
    }
  }

  private async settleUnknown(attemptId: AttemptId, value: WorkFailure): Promise<void> {
    await this.store.transaction(async () => {
      const events = this.unknownEvents(attemptId, value, new Date().toISOString())
      if (events.length > 0) await this.commitInTransaction(events)
    })
  }

  /** Retry unknown persistence once without changing a post-start failure into safe retry. */
  private async settlePostStartUnknown(attemptId: AttemptId, value: WorkFailure): Promise<void> {
    try {
      await this.settleUnknown(attemptId, value)
    } catch (error) {
      const detail = failure('unknown-persistence', error, 'unknown', false).message
      await this.settleUnknown(attemptId, {
        ...value,
        message: `${value.message}; initial unknown persistence failed: ${detail}`,
      })
    }
  }

  /**
   * Stop a LiveAttempt whose side effect began before its running fact became durable.
   * The Queue keeps execution ownership until both the cancellation request and the
   * live settlement finish, or until the same bounded quiescence deadline used by
   * provider teardown expires.
   */
  private async quiesceAfterRunningCommitFailure(
    live: LiveAttempt<WorkKind>,
    reason: string,
  ): Promise<string | null> {
    const diagnostics: string[] = []
    const cancellation = Promise.resolve()
      .then(() => live.cancel(reason))
      .catch((error: unknown) => {
        diagnostics.push(`LiveAttempt cancellation rejected: ${failure('post-start-cancel', error, 'unknown', false).message}`)
      })
    const settlement = Promise.resolve(live.done)
      .catch((error: unknown) => {
        diagnostics.push(`LiveAttempt settlement rejected: ${failure('post-start-settlement', error, 'unknown', false).message}`)
      })
    const completed = Promise.all([cancellation, settlement])
    const timeout = Promise.withResolvers<{ readonly kind: 'timeout' }>()
    const timer = setTimeout(() => { timeout.resolve({ kind: 'timeout' }) }, this.shutdownTimeoutMs)
    try {
      const result = await Promise.race([
        completed.then(() => ({ kind: 'settled' as const })),
        timeout.promise,
      ])
      if (result.kind === 'timeout') {
        diagnostics.push(`LiveAttempt did not reach quiescence within ${this.shutdownTimeoutMs}ms`)
      }
      return diagnostics.length === 0 ? null : diagnostics.join('; ')
    } finally {
      clearTimeout(timer)
    }
  }

  private async initialize(): Promise<void> {
    await this.store.open()
    await this.recoverOrphanedAttempts()
  }

  private async recoverOrphanedAttempts(): Promise<void> {
    await this.store.transaction(async () => {
      const at = new Date().toISOString()
      const events: Array<ChangeSet['events'][number]> = []
      for (const attempt of this.store.current().attemptsById.values()) {
        if (attempt.status === 'starting' || attempt.status === 'running') {
          events.push(...this.unknownEvents(attempt.id, {
            category: 'host-restart', sideEffect: 'unknown', retriable: false,
            message: 'Queue host restarted before this attempt reached a durable terminal state',
          }, at))
        }
      }
      if (events.length > 0) await this.commitInTransaction(events)
    })
  }

  private unknownEvents(attemptId: AttemptId, value: WorkFailure, at: string): readonly ChangeSet['events'][number][] {
    const attempt = this.store.current().attemptsById.get(attemptId)
    const state = attempt === undefined ? undefined : this.store.current().statesByWorkId.get(attempt.workId)
    if (attempt === undefined || state === undefined || (state.status !== 'starting' && state.status !== 'running')) return []
    return [
      { type: 'attempt/unknown', attemptId, failure: value, at },
      {
        type: 'attention/created',
        attention: {
          id: AttentionId(randomUUID()), workId: attempt.workId, kind: 'unknown',
          status: 'pending', createdAt: at, resolvedAt: null,
        },
      },
    ]
  }

  private shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise
    this.closing = true
    this.shutdownPromise = this.shutdownActiveExecutions()
    return this.shutdownPromise
  }

  private async shutdownActiveExecutions(): Promise<void> {
    try {
      await this.ready
    } catch {
      await this.store.close()
      return
    }
    await this.store.drain()
    const executions = [...this.executing.entries()]
    await this.store.transaction(async () => {
      const at = new Date().toISOString()
      const events: Array<ChangeSet['events'][number]> = []
      for (const [, execution] of executions) {
        const state = this.store.current().statesByWorkId.get(execution.workId)
        if ((state?.status === 'starting' || state?.status === 'running') && state.cancelRequestedAt === null) {
          events.push({ type: 'cancel/requested', workId: execution.workId, at })
        }
      }
      if (events.length > 0) await this.commitInTransaction(events)
    })
    const cancelErrors = new Map<AttemptId, string>()
    const cancelRequests = executions.map(([attemptId, execution]) => {
      execution.controller.abort('task queue provider is shutting down')
      if (execution.live === null) return Promise.resolve()
      return Promise.resolve()
        .then(() => execution.live?.cancel('task queue provider is shutting down'))
        .catch((error: unknown) => {
          cancelErrors.set(attemptId, error instanceof Error ? error.message : 'cancel threw a non-Error value')
        })
    })
    await this.waitForShutdown(executions.map(([, execution]) => execution), cancelRequests)
    await this.store.transaction(async () => {
      const at = new Date().toISOString()
      const events: Array<ChangeSet['events'][number]> = []
      for (const [attemptId] of executions) {
        const detail = cancelErrors.get(attemptId)
        events.push(...this.unknownEvents(attemptId, {
          category: 'shutdown', sideEffect: 'unknown', retriable: false,
          message: detail === undefined
            ? 'Queue host shutdown exceeded the execution settlement deadline'
            : `Queue host shutdown could not cancel this execution: ${detail}`,
        }, at))
      }
      if (events.length > 0) await this.commitInTransaction(events)
    })
    await this.store.drain()
    await this.store.close()
  }

  private async waitForShutdown(executions: readonly Execution[], cancelRequests: readonly Promise<void>[]): Promise<void> {
    if (executions.length === 0 && cancelRequests.length === 0) return
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        Promise.allSettled([
          ...executions.map(execution => execution.settled ?? Promise.resolve()),
          ...cancelRequests,
        ]).then(() => undefined),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, this.shutdownTimeoutMs) }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  private assertAccepting(): void {
    if (this.closing) throw new Error('task queue provider is shutting down and no longer accepts admission')
  }

  private async settleCanceled(workId: WorkId): Promise<void> {
    await this.store.transaction(async () => {
      const state = this.store.current().statesByWorkId.get(workId)
      const work = this.store.current().worksById.get(workId)
      if (state !== undefined
        && work !== undefined
        && state.activeAttemptId !== null
        && (state.status === 'starting' || state.status === 'running')) {
        const at = new Date().toISOString()
        const events: Array<ChangeSet['events'][number]> = []
        if (state.cancelRequestedAt === null) {
          events.push({ type: 'cancel/requested', workId, at })
        }
        events.push({ type: 'work/canceled', workId, at })
        if (work.ownerSessionId !== null) events.push(this.notification(workId, state.activeAttemptId, null, work.ownerSessionId, at))
        await this.commitInTransaction(events)
      }
    })
  }

  private canClaim(work: WorkItem): boolean {
    if (work.batchId !== null) {
      const batch = this.store.current().batchesById.get(work.batchId)
      if (batch === undefined) throw new Error(`task queue WorkItem ${work.id} references an unknown Batch`)
      const activeInBatch = [...this.executing.values()].filter(
        execution => this.store.current().worksById.get(execution.workId)?.batchId === batch.id,
      ).length
      if (activeInBatch >= batch.maxParallel) return false
    }
    return work.resources.every((claim) => {
      const used = [...this.executing.values()].reduce((sum, execution) => {
        const matching = execution.claims.find(existing => existing.resource === claim.resource)
        return sum + (matching?.units ?? 0)
      }, 0)
      return (this.resourceCapacity[claim.resource] ?? 0) >= claim.units + used
    })
  }

  private assertClaims(claims: readonly ResourceClaim[]): void {
    for (const claim of claims) {
      const capacity = this.resourceCapacity[claim.resource]
      if (!Number.isSafeInteger(claim.units)
        || claim.units < 1
        || capacity === undefined) {
        throw new Error(`task queue resource ${claim.resource} has no declared positive capacity`)
      }
      if (claim.units > capacity) {
        throw new Error(`task queue resource ${claim.resource} claim ${claim.units} exceeds declared capacity ${capacity}`)
      }
    }
  }

  private resolveClaims<K extends WorkKind>(handler: WorkHandler<K>, resolved: ResolvedWork<K>): readonly ResourceClaim[] {
    const claims = Object.freeze(handler.resources(resolved).map(claim => Object.freeze({ ...claim })))
    this.assertClaims(claims)
    return claims
  }

  private resolvePolicy<K extends WorkKind>(handler: WorkHandler<K>, resolved: ResolvedWork<K>): WorkPolicy {
    const policy = Object.freeze({ ...handler.policy(resolved) })
    if (!Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
      throw new Error('task queue WorkHandler returned invalid maxAttempts')
    }
    return policy
  }

  private admitOnce<T extends WorkId | BatchId>(
    authority: AdmissionAuthority,
    key: string,
    intentDigest: string,
    admit: () => Promise<T>,
  ): Promise<T> {
    const scope = admissionScope(authority)
    const pendingKey = canonicalJson({ owner: scope.owner, source: scope.source, key })
    const existing = this.pendingAdmissions.get(pendingKey)
    if (existing !== undefined) {
      if (existing.intentDigest !== intentDigest) return Promise.reject(new Error(`idempotency conflict for key ${key}`))
      return existing.result as Promise<T>
    }
    const result = Promise.resolve().then(admit)
    this.pendingAdmissions.set(pendingKey, { intentDigest, result })
    const clear = () => {
      if (this.pendingAdmissions.get(pendingKey)?.result === result) this.pendingAdmissions.delete(pendingKey)
    }
    void result.then(clear, clear)
    return result
  }

  private async commit(events: ChangeSet['events']): Promise<void> {
    await this.store.transaction(() => this.commitInTransaction(events))
  }

  private async commitInTransaction(events: ChangeSet['events']): Promise<void> {
    const change = this.change(events)
    await this.store.append(change)
    this.ctx.emit('task-queue/changed', { seq: change.seq, changeId: change.changeId })
  }

  private change(events: ChangeSet['events']): ChangeSet {
    return { seq: this.store.current().lastSeq + 1, changeId: randomUUID(), at: new Date().toISOString(), events }
  }

  private requireHandler(kind: WorkKind): WorkHandler<WorkKind> {
    const registration = this.handlers.get(kind)
    if (registration === undefined) throw new Error(`task queue handler is not registered for ${String(kind)}`)
    return registration.handler
  }

  private requireActiveRegistration(kind: WorkKind): HandlerEntry {
    const registration = this.handlers.get(kind)
    if (registration?.active !== true) {
      throw new Error(`task queue handler is not active for ${String(kind)}`)
    }
    return registration
  }
}

export { WorkQueueStore } from './v2-store.ts'
export default LocalTaskQueue
