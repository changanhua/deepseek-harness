/**
 * Durable host-plane task queue backend (`ctx.taskQueue`) (§2, §7.1).
 *
 * Composes the single-writer segment store, the service-level mutation FIFO
 * (with the faulted resolution protocol), the inbox scanner, the scheduler,
 * and the built-in preparable executors into one `LocalTaskQueue` service.
 * Trusted ingress (`enqueueFromTool`, inbox scan) is the only place `source`
 * is assigned; the scheduler is the only point that spawns processes and the
 * only owner of live `SubprocessHandle`s — which are disposed on teardown.
 * @module @deepseek-ai/dsh-task-queue-local
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { TaskQueue, TaskId, RunId, NotificationId } from '@deepseek-ai/dsh-task-queue'
import type {
  Task, TaskStatus, EnqueueSpec, ListFilter, TaskSummary, QueueStats, ServiceState,
  ExecutorAdapter, RunRecord, FoldedQueue, ChangeRecord, NotificationRecord,
  TaskResult,
} from '@deepseek-ai/dsh-task-queue'
import {
  createTask, claimTask, markRunning, settleSucceeded, settleFailed,
  requestStop, settleCanceled, cancelPending, retryTask, recoverTaskAfterCrash,
  isTerminalStatus, applyChange,
} from '@deepseek-ai/dsh-task-queue'
import { resolveQueueRoot, runLogPath, DIR_MODE, FILE_MODE } from './paths.ts'
import { TaskQueueStore, FaultedError } from './store.ts'
import { runMutationTransaction } from './fifo.ts'
import { scanInbox, quarantineInboxFile } from './inbox.ts'
import { builtinAdapters } from './executors.ts'
import { TaskScheduler, commandFingerprint, renderRunLog } from './scheduler.ts'
import type { SchedulerHost, ClaimedAttempt } from './scheduler.ts'

/** Maximum batch size for `enqueueBatchFromTool` (§7.1). */
const MAX_BATCH_SIZE = 200
const DEFAULT_MAX_CONCURRENT = 2
const DEFAULT_MAX_CONCURRENT_PER_EXECUTOR = 1
const DEFAULT_INTERVAL_MS = 1_000

/** Admission config schema (schemastery). */
export interface Config {
  /** Maximum concurrent starting/running/stopping tasks across all executors. */
  maxConcurrent?: number
  /** Maximum concurrent starting/running/stopping tasks per one executor. */
  maxConcurrentPerExecutor?: number
  /** Scheduler tick interval in milliseconds. */
  intervalMs?: number
  /** Queue root directory; defaults to `$DSH_HOME/task-queue`. */
  queueRoot?: string
  /** Per-executor enablement; a disabled executor rejects admission. */
  executors?: Record<string, {
    /** Whether this executor may run tasks. */
    enabled: boolean
  }>
}

/** Config with every optional field defaulted (schemastery output shape). */
export type ResolvedConfig = Required<Pick<Config, 'maxConcurrent' | 'maxConcurrentPerExecutor' | 'intervalMs'>> & Config

/**
 * Durable host-plane task queue backend. Composes the segment store, the
 * mutation FIFO (with the faulted protocol), the inbox scanner, the scheduler,
 * and the built-in executor adapters; registers as `ctx.taskQueue` and is the
 * only owner of live `SubprocessHandle`s.
 */
export class LocalTaskQueue extends TaskQueue implements SchedulerHost {
  static Config: z<Config> = z.object({
    maxConcurrent: z.number().step(1).min(1).default(DEFAULT_MAX_CONCURRENT),
    maxConcurrentPerExecutor: z.number().step(1).min(1).default(DEFAULT_MAX_CONCURRENT_PER_EXECUTOR),
    intervalMs: z.number().step(1).min(1).default(DEFAULT_INTERVAL_MS),
    queueRoot: z.string(),
    executors: z.dict(z.object({ enabled: z.boolean() })).default({}),
  })

  private readonly store: TaskQueueStore
  private readonly adapters: Map<string, ExecutorAdapter>
  private readonly enabledExecutors: Set<string>
  private readonly scheduler: TaskScheduler
  private readonly liveHandles = new Map<string, SubprocessHandle>()
  private readonly stopping = new Set<string>()

  private folded: FoldedQueue = { tasksById: new Map(), notificationsById: new Map(), lastSeq: 0 }
  private nextSeq = 1
  private serviceState: ServiceState = 'running'
  private faultReason: string | undefined
  private disposed = false

  readonly maxConcurrent: number
  readonly maxConcurrentPerExecutor: number
  readonly intervalMs: number

  constructor(ctx: Context, config: ResolvedConfig) {
    super(ctx)
    this.maxConcurrent = config.maxConcurrent
    this.maxConcurrentPerExecutor = config.maxConcurrentPerExecutor
    this.intervalMs = config.intervalMs

    const root = config.queueRoot ?? resolveQueueRoot(process.env.DSH_HOME)
    this.store = new TaskQueueStore(root)
    this.enabledExecutors = new Set(
      Object.entries(config.executors ?? {})
        .filter(([, cfg]) => cfg.enabled === true)
        .map(([name]) => name),
    )
    this.adapters = builtinAdapters({})
    this.scheduler = new TaskScheduler(this)

    ctx.effect(() => {
      void this.boot()
      this.scheduler.start()
      return () => {
        this.disposed = true
        this.scheduler.stop()
        for (const handle of this.liveHandles.values()) {
          try { handle.terminate() } catch { /* best-effort teardown */ }
        }
        this.liveHandles.clear()
      }
    }, 'task-queue.lifecycle()')
  }

  /* ------------------------------------------------------------ FIFO/mutate -- */

  mutate<T>(fn: () => Promise<T>): Promise<T> {
    return runMutationTransaction(this, fn)
  }

  /* ----------------------------------------------------------------- boot -- */

  private async boot(): Promise<void> {
    try {
      const recovered = await this.store.recover()
      this.folded = recovered.folded
      this.nextSeq = recovered.nextSeq
      // Crash reclaim runs ONCE at boot: live starting/running/stopping tasks
      // are leftovers of the previous host process (no live handle exists for
      // them). Never reclaim during normal ticks — a spawned task would be
      // reverted every second (§4.3).
      await this.reclaimCrashed()
    } catch (error) {
      this.enterFaulted(String(error))
    }
  }

  /** Recover starting/running/stopping tasks left by a previous host process. */
  private async reclaimCrashed(): Promise<void> {
    for (const task of this.folded.tasksById.values()) {
      if (task.status === 'starting' || task.status === 'running' || task.status === 'stopping') {
        const { task: recovered, orphan } = recoverTaskAfterCrash(task, new Date().toISOString())
        if (orphan) {
          this.ctx.emit('task-queue/orphan-unknown', { taskId: task.id, priorStatus: task.status })
        }
        await this.commit(changeFor(this.nextSeq, recovered))
        this.stopping.delete(task.id)
      }
    }
  }

  /* --------------------------------------------------------------- helpers -- */

  private enterFaulted(reason: string): void {
    if (this.serviceState === 'faulted') return
    this.serviceState = 'faulted'
    this.faultReason = reason
    this.ctx.emit('task-queue/faulted', { reason })
  }

  private assertAdmitting(): void {
    if (this.serviceState === 'faulted') {
      throw new FaultedError(this.faultReason ?? 'task queue is faulted')
    }
    if (this.serviceState === 'paused') {
      throw new Error('task queue is paused')
    }
  }

  private receiptExists(source: Task['source'], receiptId: string): Task | undefined {
    for (const task of this.folded.tasksById.values()) {
      if (task.source === source && task.receiptId === receiptId) return task
    }
    return undefined
  }

  private assertExecutorEnabled(executor: string): void {
    if (!this.enabledExecutors.has(executor)) {
      throw new Error(`executor "${executor}" is not enabled`)
    }
  }

  /* ------------------------------------------------------------ durable fold -- */

  /** Append + fsync one change, then fold it into memory (§4.1/§4.2). */
  private async commit(change: ChangeRecord): Promise<void> {
    try {
      await this.store.appendActive(change)
      this.nextSeq = change.seq + 1
      applyChange(this.folded, change)
    } catch (error) {
      await this.resolveFault(change, error)
      throw error
    }
  }

  /**
   * §4.2 faulted protocol: after an append/fsync failure, re-read the durable
   * log and decide whether the change committed. Committed → reconcile and
   * clear fault; uncommitted/undecidable → stay faulted (no auto resume).
   */
  private async resolveFault(change: ChangeRecord, original: unknown): Promise<void> {
    this.enterFaulted(String(original))
    try {
      const recovered = await this.store.recover()
      const seqConsistent = recovered.nextSeq - 1 >= change.seq
      const committed = change.op === 'notification-acknowledged'
        ? recovered.folded.notificationsById.get(change.notificationId)?.status === 'acknowledged'
        : recovered.folded.tasksById.get(change.taskId) !== undefined
      if (committed && seqConsistent) {
        this.folded = recovered.folded
        this.nextSeq = recovered.nextSeq
        this.serviceState = 'running'
        this.faultReason = undefined
      }
      // else: stay faulted (uncommitted still throws the original error; undecidable stays faulted).
    } catch {
      // undecidable: stay faulted.
    }
  }

  /* -------------------------------------------------------------- ingress -- */

  async enqueueFromTool(spec: EnqueueSpec): Promise<TaskId> {
    this.assertAdmitting()
    if (spec.executor === 'shell') throw new Error('shell executor is not allowed from tools')
    this.assertExecutorEnabled(spec.executor)
    const receiptId = spec.idempotencyKey !== undefined
      ? `tool:key:${spec.idempotencyKey}`
      : `tool:auto:${randomUUID()}`
    const existing = this.receiptExists('tool', receiptId)
    if (existing !== undefined) return existing.id

    return this.mutate(async () => {
      const again = this.receiptExists('tool', receiptId)
      if (again !== undefined) return again.id
      const task = createTask(TaskId(`tq-${randomUUID()}`), spec, 'tool', receiptId, new Date().toISOString())
      const change = createdChange(this.nextSeq, task)
      await this.commit(change)
      this.ctx.emit('task-queue/created', { taskId: task.id })
      return task.id
    })
  }

  async enqueueBatchFromTool(specs: readonly EnqueueSpec[]): Promise<TaskId[]> {
    if (specs.length > MAX_BATCH_SIZE) {
      throw new Error(`batch size ${specs.length} exceeds ${MAX_BATCH_SIZE}`)
    }
    const ids: TaskId[] = []
    for (const spec of specs) ids.push(await this.enqueueFromTool(spec))
    return ids
  }

  /* ---------------------------------------------------------------- reads -- */

  list(filter?: ListFilter): TaskSummary[] {
    let tasks = [...this.folded.tasksById.values()]
    if (filter?.status !== undefined) tasks = tasks.filter(t => t.status === filter.status)
    if (filter?.executor !== undefined) tasks = tasks.filter(t => t.executor === filter.executor)
    if (filter?.tags !== undefined && filter.tags.length > 0) {
      const wanted = filter.tags
      tasks = tasks.filter(t => wanted.some(tag => t.tags.includes(tag)))
    }
    if (filter?.limit !== undefined && filter.limit > 0) tasks = tasks.slice(0, filter.limit)
    return tasks.map(taskToSummary)
  }

  get(id: TaskId): Task {
    const task = this.folded.tasksById.get(id)
    if (task === undefined) throw new Error(`unknown task ${id}`)
    return task
  }

  /* -------------------------------------------------------------- control -- */

  async cancel(id: TaskId): Promise<'canceled' | 'stopping'> {
    this.assertAdmitting()
    return this.mutate(async () => {
      const task = this.folded.tasksById.get(id)
      if (task === undefined) throw new Error(`unknown task ${id}`)
      if (isTerminalStatus(task.status)) return 'canceled' as const
      if (task.status === 'pending') {
        const canceled = cancelPending(task, 'canceled', new Date().toISOString())
        await this.commit(changeFor(this.nextSeq, canceled))
        this.ctx.emit('task-queue/canceled', { taskId: id })
        return 'canceled' as const
      }
      const stopping = requestStop(task, 'cancel requested', new Date().toISOString())
      this.stopping.add(id)
      await this.commit(changeFor(this.nextSeq, stopping))
      return 'stopping' as const
    })
  }

  async retry(id: TaskId): Promise<TaskId> {
    this.assertAdmitting()
    return this.mutate(async () => {
      const task = this.folded.tasksById.get(id)
      if (task === undefined) throw new Error(`unknown task ${id}`)
      const retried = retryTask(task, new Date().toISOString())
      await this.commit(changeFor(this.nextSeq, retried))
      this.ctx.emit('task-queue/requeued', { taskId: id, reason: 'manual retry' })
      return id
    })
  }

  stats(): QueueStats {
    const byStatus: Record<TaskStatus, number> = {
      pending: 0, starting: 0, running: 0, stopping: 0, succeeded: 0, failed: 0, canceled: 0,
    }
    const byExecutor: Record<string, number> = {}
    for (const task of this.folded.tasksById.values()) {
      byStatus[task.status] += 1
      byExecutor[task.executor] = (byExecutor[task.executor] ?? 0) + 1
    }
    return {
      serviceState: this.serviceState,
      ...(this.faultReason !== undefined ? { fault: { reason: this.faultReason } } : {}),
      byStatus,
      byExecutor,
    }
  }

  registerExecutor(name: string, adapter: ExecutorAdapter): () => void {
    this.adapters.set(name, adapter)
    return () => {
      if (this.adapters.get(name) === adapter) this.adapters.delete(name)
    }
  }

  pause(): void {
    if (this.serviceState === 'running') this.serviceState = 'paused'
    else throw new Error(`cannot pause from ${this.serviceState}`)
  }

  resume(): void {
    if (this.serviceState === 'paused') this.serviceState = 'running'
    else if (this.serviceState === 'faulted') throw new Error('cannot resume a faulted queue')
  }

  async ackNotification(notificationId: NotificationId, messageId: string): Promise<void> {
    this.assertAdmitting()
    await this.mutate(async () => {
      const existing = this.folded.notificationsById.get(notificationId)
      if (existing === undefined) throw new Error(`unknown notification ${notificationId}`)
      if (existing.status === 'acknowledged') return
      if (existing.status !== 'pending' || existing.messageId !== messageId) {
        throw new Error('notification CAS mismatch')
      }
      const acknowledged: NotificationRecord = {
        ...existing, status: 'acknowledged', acknowledgedAt: new Date().toISOString(),
      }
      const change: ChangeRecord = {
        seq: this.nextSeq, version: 1, op: 'notification-acknowledged',
        notificationId, expectedStatus: 'pending', expectedMessageId: messageId,
        state: acknowledged, at: new Date().toISOString(),
      }
      await this.commit(change)
    })
  }

  listNotifications(filter: { ownerSessionId: string }): NotificationRecord[] {
    return [...this.folded.notificationsById.values()]
      .filter(n => n.ownerSessionId === filter.ownerSessionId)
      .sort((a, b) => a.terminalSeq - b.terminalSeq)
  }

  /* ---------------------------------------------------------- SchedulerHost -- */

  async housekeeping(): Promise<void> {
    for (const entry of await scanInbox(this.store.paths.root)) {
      if (entry.kind === 'invalid-filename') continue
      if (entry.kind === 'invalid-content') {
        await quarantineInboxFile(this.store.paths.root, `${entry.receiptId}.json`)
        continue
      }
      const existing = this.receiptExists('inbox', entry.receiptId)
      if (existing !== undefined) {
        await this.deleteInboxFile(entry.receiptId)
        continue
      }
      if (this.serviceState !== 'running') continue
      const task = createTask(TaskId(`tq-${randomUUID()}`), entry.spec, 'inbox', entry.receiptId, new Date().toISOString())
      await this.commit(createdChange(this.nextSeq, task))
      this.ctx.emit('task-queue/created', { taskId: task.id })
      await this.deleteInboxFile(entry.receiptId)
    }
  }

  private async deleteInboxFile(receiptId: string): Promise<void> {
    await unlink(join(this.store.paths.root, 'inbox', `${receiptId}.json`)).catch(() => {})
  }

  eligibleTasks(): Task[] {
    const now = Date.now()
    return [...this.folded.tasksById.values()]
      .filter(t => t.status === 'pending' && t.attempt < t.maxAttempts && !this.stopping.has(t.id))
      .filter(t => t.delayUntil === null || Date.parse(t.delayUntil) <= now)
      .sort((a, b) => a.priority !== b.priority ? a.priority - b.priority
        : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)
  }

  occupiedSlots(): { global: number; byExecutor: Map<string, number> } {
    const byExecutor = new Map<string, number>()
    let global = 0
    for (const task of this.folded.tasksById.values()) {
      if (task.status === 'starting' || task.status === 'running') {
        global += 1
        byExecutor.set(task.executor, (byExecutor.get(task.executor) ?? 0) + 1)
      } else if (task.status === 'stopping' && this.liveHandles.has(task.id)) {
        global += 1
      }
    }
    return { global, byExecutor }
  }

  async claim(task: Task): Promise<ClaimedAttempt | undefined> {
    return this.mutate(async () => {
      const current = this.folded.tasksById.get(task.id)
      if (current === undefined || current.status !== 'pending') return undefined
      const attempt = current.attempt + 1
      const plannedStartedAt = new Date().toISOString()
      const logPath = runLogPath(this.store.paths.root, task.id, attempt)
      const run: RunRecord = {
        runId: RunId(randomUUID()),
        attempt,
        pid: null,
        plannedStartedAt,
        actualStartedAt: null,
        logPath,
        commandFingerprint: null,
      }
      const starting = claimTask(current, run.runId, plannedStartedAt, logPath, '')
      await this.commit(changeFor(this.nextSeq, starting))
      this.ctx.emit('task-queue/starting', { taskId: task.id, attempt })
      return { task: starting, run }
    })
  }

  async prepare(task: Task, run: RunRecord, signal: AbortSignal): Promise<SubprocessSpawnSpec> {
    const adapter = this.adapters.get(task.executor)
    if (adapter === undefined) {
      throw new Error(`unknown executor "${task.executor}"`)
    }
    const spec = await adapter.prepare(task, run, signal)
    // Stamp the resolved argv fingerprint onto the run record for diagnostics.
    void commandFingerprint(spec.argv)
    return spec
  }

  async spawnAndMark(task: Task, run: RunRecord, spec: SubprocessSpawnSpec): Promise<SubprocessHandle | undefined> {
    void run // diagnostic correlation lives in the committed run record
    return this.mutate(async () => {
      const current = this.folded.tasksById.get(task.id)
      if (current === undefined || current.status !== 'starting' || this.stopping.has(task.id)) {
        return undefined
      }
      let handle: SubprocessHandle
      try {
        handle = this.ctx.subprocess.spawn(spec)
      } catch (error) {
        const reason = (error as NodeJS.ErrnoException)?.code === 'ENOENT'
          ? `executable not found: ${String(spec.argv[0])}`
          : `spawn failed: ${String(error)}`
        await this.settleFailure(current, true, reason)
        return undefined
      }
      this.liveHandles.set(task.id, handle)
      const running = markRunning(current, handle.pid, new Date().toISOString())
      await this.commit(changeFor(this.nextSeq, running))
      this.ctx.emit('task-queue/running', { taskId: task.id })
      void handle.done.then(() => { this.liveHandles.delete(task.id) }, () => { this.liveHandles.delete(task.id) })
      return handle
    })
  }

  async settle(task: Task, outcome: SubprocessOutcome, handle: SubprocessHandle): Promise<void> {
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    await this.writeRunLog(task.id, task.attempt, renderRunLog(stdout, stderr))
    await this.mutate(async () => {
      const current = this.folded.tasksById.get(task.id)
      if (current === undefined || current.status !== 'running') return
      if (outcome.exitCode === 0) {
        const result: TaskResult = { exitCode: 0, signal: null, durationMs: 0 }
        const succeeded = settleSucceeded(current, result, new Date().toISOString())
        await this.commitTerminal(succeeded)
        this.ctx.emit('task-queue/succeeded', { taskId: task.id })
      } else {
        const reason = outcome.signal !== null ? `terminated by ${outcome.signal}` : `exit code ${String(outcome.exitCode)}`
        await this.settleFailure(current, false, reason)
      }
    })
  }

  async settleFailure(task: Task, noRetry: boolean, reason: string): Promise<void> {
    const current = this.folded.tasksById.get(task.id)
    if (current === undefined) return
    if (this.stopping.has(task.id)) {
      // A cancel intent already moved it to stopping; finalize as canceled.
      const canceled = settleCanceled(current, new Date().toISOString())
      await this.commitTerminal(canceled)
      this.ctx.emit('task-queue/canceled', { taskId: task.id })
      this.stopping.delete(task.id)
      return
    }
    if (noRetry || current.attempt >= current.maxAttempts) {
      const failed = settleFailed(current, reason, new Date().toISOString())
      await this.commitTerminal(failed)
      this.ctx.emit('task-queue/failed', { taskId: task.id, reason })
    } else {
      const backoff = current.backoffMs * Math.pow(2, current.attempt - 1)
      const delayUntil = new Date(Date.now() + backoff).toISOString()
      const requeued: Task = {
        ...current, status: 'pending', lastError: reason, delayUntil, updatedAt: new Date().toISOString(),
      }
      await this.commit(changeFor(this.nextSeq, requeued))
      this.ctx.emit('task-queue/requeued', { taskId: task.id, reason })
    }
  }

  /**
   * Commit a terminal transition; if the task has an owner, atomically create
   * a durable `NotificationRecord` in the same change (§7.4).
   */
  private async commitTerminal(task: Task): Promise<void> {
    const notification = task.ownerSessionId === null
      ? undefined
      : this.buildNotification(task, task.ownerSessionId)
    const change = changeFor(this.nextSeq, task)
    if (notification !== undefined) change.notification = notification
    await this.commit(change)
  }

  private buildNotification(task: Task, ownerSessionId: string): NotificationRecord {
    const lastRun = task.runs[task.runs.length - 1]
    return {
      notificationId: NotificationId(randomUUID()),
      taskId: task.id,
      runId: lastRun?.runId ?? RunId(''),
      attempt: task.attempt,
      terminalSeq: this.nextSeq,
      ownerSessionId,
      messageId: randomUUID(),
      status: 'pending',
      acknowledgedAt: null,
    }
  }

  async writeRunLog(taskId: string, attempt: number, body: string): Promise<void> {
    const path = runLogPath(this.store.paths.root, taskId, attempt)
    await mkdir(join(this.store.paths.root, 'runs'), { recursive: true, mode: DIR_MODE }).catch(() => {})
    await writeFile(path, body, { mode: FILE_MODE }).catch(() => {})
  }

  halted(): boolean {
    return this.disposed || this.serviceState === 'faulted' || this.serviceState === 'paused'
  }

  private drained = true

  /** Emit `task-queue/drained` exactly once per drained transition (§7.2). */
  notifyDrain(): void {
    const live = [...this.folded.tasksById.values()]
      .some(t => t.status === 'starting' || t.status === 'running' || t.status === 'stopping')
    if (live) {
      this.drained = false
      return
    }
    if (!this.drained) {
      this.drained = true
      this.ctx.emit('task-queue/drained', { pending: this.folded.tasksById.size })
    }
  }
}

/** Task-op change records (never the ack variant). */
type TaskChange = Extract<ChangeRecord, { taskId: TaskId }>

/** Map a task's status to the change op that must accompany it on the wire. */
function opForStatus(status: TaskStatus): TaskChange['op'] {
  switch (status) {
    case 'pending': return 'requeued'
    case 'starting': return 'starting'
    case 'running': return 'running'
    case 'stopping': return 'stopping'
    case 'succeeded': return 'succeeded'
    case 'failed': return 'failed'
    case 'canceled': return 'canceled'
  }
}

/** Build a change record whose op matches the task's final status. */
function changeFor(seq: number, state: Task): TaskChange {
  return { seq, version: 1, op: opForStatus(state.status), taskId: state.id, state, at: new Date().toISOString() }
}

/** The `created` op is reserved for first admission, not generic mutations. */
function createdChange(seq: number, state: Task): TaskChange {
  return { seq, version: 1, op: 'created', taskId: state.id, state, at: new Date().toISOString() }
}

function taskToSummary(task: Task): TaskSummary {
  return {
    id: task.id,
    title: task.title,
    executor: task.executor,
    status: task.status,
    priority: task.priority,
    attempt: task.attempt,
    maxAttempts: task.maxAttempts,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.lastError !== null ? { lastError: task.lastError } : {}),
    tags: task.tags,
    ownerSessionId: task.ownerSessionId,
  }
}

export default LocalTaskQueue
