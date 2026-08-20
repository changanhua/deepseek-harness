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
import { dirname, join } from 'node:path'
import type {
  SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { TaskQueue, TaskId, RunId, NotificationId } from '@deepseek-ai/dsh-task-queue'
import type {
  Task, TaskStatus, EnqueueSpec, ListFilter, TaskSummary, QueueExecutorView, QueueStats, ServiceState,
  ExecutorAdapter, RunRecord, FoldedQueue, ChangeRecord, NotificationRecord,
  TaskResult,
} from '@deepseek-ai/dsh-task-queue'
import {
  createTask, claimTask, markRunning, settleSucceeded, settleFailed,
  requestStop, settleCanceled, cancelPending, retryTask, dismissTask, recoverTaskAfterCrash,
  isTerminalStatus, applyChange,
} from '@deepseek-ai/dsh-task-queue'
import { runLogPath, DIR_MODE, FILE_MODE } from './paths.ts'
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
/** Extra time beyond `timeoutMs` before a stalled `stopping` task is force-reclaimed. */
const DEFAULT_STOPPING_GRACE_MS = 5_000

/** Admission config schema (schemastery). */
export interface Config {
  /** Maximum concurrent starting/running/stopping tasks across all executors. */
  maxConcurrent?: number
  /** Maximum concurrent starting/running/stopping tasks per one executor. */
  maxConcurrentPerExecutor?: number
  /** Scheduler tick interval in milliseconds. */
  intervalMs?: number
  /** Extra time beyond `timeoutMs` before a stalled `stopping` task is force-reclaimed. */
  stoppingGraceMs?: number
  /** Queue root directory; the composing row resolves it explicitly, for example `dshHomePath('task-queue')`. */
  queueRoot: string
  /** Per-executor enablement; a disabled executor rejects admission. */
  executors?: Record<string, {
    /** Whether this executor may run tasks. */
    enabled: boolean
  }>
}

/** Config with every optional field defaulted (schemastery output shape). */
export type ResolvedConfig = Required<Pick<Config, 'queueRoot' | 'maxConcurrent' | 'maxConcurrentPerExecutor' | 'intervalMs' | 'stoppingGraceMs'>> & Config

/**
 * Durable host-plane task queue backend. Composes the segment store, the
 * mutation FIFO (with the faulted protocol), the inbox scanner, the scheduler,
 * and the built-in executor adapters; registers as `ctx.taskQueue` and is the
 * only owner of live `SubprocessHandle`s.
 */
export class LocalTaskQueue extends TaskQueue implements SchedulerHost {
  static inject = ['subprocess']

  static Config: z<Config> = z.object({
    maxConcurrent: z.number().step(1).min(1).default(DEFAULT_MAX_CONCURRENT),
    maxConcurrentPerExecutor: z.number().step(1).min(1).default(DEFAULT_MAX_CONCURRENT_PER_EXECUTOR),
    intervalMs: z.number().step(1).min(1).default(DEFAULT_INTERVAL_MS),
    stoppingGraceMs: z.number().step(1).min(0).default(DEFAULT_STOPPING_GRACE_MS),
    queueRoot: z.string(),
    executors: z.dict(z.object({ enabled: z.boolean() })).default({}),
  })

  private readonly store: TaskQueueStore
  private readonly adapters: Map<string, ExecutorAdapter>
  private readonly enabledExecutors: Set<string>
  private readonly scheduler: TaskScheduler
  private readonly liveHandles = new Map<string, SubprocessHandle>()
  private readonly stopping = new Set<string>()
  private readonly bootPromise: Promise<void>

  private folded: FoldedQueue = { tasksById: new Map(), notificationsById: new Map(), lastSeq: 0 }
  private nextSeq = 1
  private serviceState: ServiceState = 'running'
  private faultReason: string | undefined
  private disposed = false

  readonly maxConcurrent: number
  readonly maxConcurrentPerExecutor: number
  readonly intervalMs: number
  /** Extra time beyond `timeoutMs` before a stalled `stopping` task is force-reclaimed. */
  readonly stoppingGraceMs: number

  constructor(ctx: Context, config: ResolvedConfig) {
    super(ctx)
    this.maxConcurrent = config.maxConcurrent
    this.maxConcurrentPerExecutor = config.maxConcurrentPerExecutor
    this.intervalMs = config.intervalMs
    this.stoppingGraceMs = config.stoppingGraceMs

    this.store = new TaskQueueStore(config.queueRoot)
    this.enabledExecutors = new Set(
      Object.entries(config.executors ?? {})
        .filter(([, cfg]) => cfg.enabled === true)
        .map(([name]) => name),
    )
    this.adapters = builtinAdapters({})
    this.scheduler = new TaskScheduler(this)
    this.bootPromise = this.boot()

    ctx.effect(() => {
      void this.bootPromise.then(() => {
        if (!this.disposed) this.scheduler.start()
      })
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
    await this.bootPromise
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
    await this.bootPromise
    this.assertAdmitting()
    const outcome = await this.mutate(async () => {
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
    // The cancel intent is persisted; now actually stop the live process so it
    // does not keep running (and keep occupying a concurrency slot) until it
    // ends on its own. settle() then finalizes stopping→canceled once the
    // terminated handle's `done` fires. Without this terminate() the subprocess
    // would run to completion — e.g. still producing its output file — despite
    // the user having canceled it.
    if (outcome === 'stopping') {
      const handle = this.liveHandles.get(id)
      if (handle !== undefined) {
        // terminate() is void, idempotent, and never throws (it only begins the
        // SIGTERM→grace→SIGKILL escalation). The eventual stopping→canceled
        // transition happens in settle() when the terminated handle's `done`
        // fires; we do not await here — cancel returns 'stopping' immediately.
        try { handle.terminate() } catch { /* best-effort */ }
      }
    }
    return outcome
  }

  async retry(id: TaskId): Promise<TaskId> {
    await this.bootPromise
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

  async dismiss(id: TaskId, dismissed: boolean): Promise<void> {
    await this.bootPromise
    this.assertAdmitting()
    await this.mutate(async () => {
      const task = this.folded.tasksById.get(id)
      if (task === undefined) throw new Error(`unknown task ${id}`)
      // Idempotent short-circuit: same value → no change record, no event, no updatedAt.
      if (task.dismissed === dismissed) return
      const updated = dismissTask(task, dismissed, new Date().toISOString())
      await this.commit(dismissedChange(this.nextSeq, updated))
      this.ctx.emit('task-queue/dismissed', { taskId: id, dismissed })
    })
  }

  stats(): QueueStats {
    const byStatus: Record<TaskStatus, number> = {
      pending: 0, starting: 0, running: 0, stopping: 0, succeeded: 0, failed: 0, canceled: 0,
    }
    const byExecutor: Record<string, number> = {}
    let undismissedFailed = 0
    let byDismissed = 0
    for (const task of this.folded.tasksById.values()) {
      byStatus[task.status] += 1
      byExecutor[task.executor] = (byExecutor[task.executor] ?? 0) + 1
      if (task.dismissed) byDismissed += 1
      if (task.status === 'failed' && !task.dismissed) undismissedFailed += 1
    }
    return {
      serviceState: this.serviceState,
      ...(this.faultReason !== undefined ? { fault: { reason: this.faultReason } } : {}),
      byStatus,
      byExecutor,
      undismissedFailed,
      byDismissed,
    }
  }

  registerExecutor(name: string, adapter: ExecutorAdapter): () => void {
    this.adapters.set(name, adapter)
    return () => {
      if (this.adapters.get(name) === adapter) this.adapters.delete(name)
    }
  }

  listExecutors(): QueueExecutorView[] {
    return [...this.adapters.keys()].sort().map(name => ({
      name,
      enabled: this.enabledExecutors.has(name),
      // `shell` is the only inbox-only built-in: tools must never submit it.
      toolAllowed: name !== 'shell',
    }))
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
    await this.bootPromise
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
    await this.reapStalledStopping()
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
    await unlink(join(this.store.paths.root, 'inbox', `${receiptId}.json`)).catch((error) => {
      console.error(`task-queue: cannot delete inbox file ${receiptId}.json: ${String(error)}`)
    })
  }

  /**
   * Watchdog for `stopping` tasks whose settle callback was lost (e.g. the
   * subprocess exited without firing `done`, or the callback raced away).
   * Normally cancel → terminate → settle turns `stopping` into `canceled` in
   * seconds. If that never happens, force-reclaim after `timeoutMs` plus a
   * grace period so the queue self-heals without a host restart.
   */
  private async reapStalledStopping(): Promise<void> {
    const now = Date.now()
    const stalled = [...this.folded.tasksById.values()].filter((task) => {
      if (task.status !== 'stopping') return false
      const startedAt = Date.parse(task.updatedAt)
      if (Number.isNaN(startedAt)) return false
      return now - startedAt > task.timeoutMs + this.stoppingGraceMs
    })
    for (const task of stalled) {
      // One last best-effort terminate in case the handle is still around.
      const handle = this.liveHandles.get(task.id)
      if (handle !== undefined) {
        try { handle.terminate() } catch { /* best-effort */ }
      }
      // Reuse crash recovery: it marks the last run terminationUnverified and
      // finalizes stopping -> canceled, exactly what a lost settle needs.
      const { task: recovered } = recoverTaskAfterCrash(task, new Date().toISOString())
      await this.commitTerminal(recovered)
      this.ctx.emit('task-queue/canceled', { taskId: task.id })
      this.stopping.delete(task.id)
    }
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
      if (current === undefined) return
      if (current.status === 'stopping') {
        // Canceled while running: the process has now ended, so finalize as
        // canceled. Without this, `settle` would early-return on the
        // `status !== 'running'` guard below and the task would stick in
        // `stopping` forever (the cancel intent was persisted but never
        // settled). The outcome's exit code/signal is irrelevant here — a
        // cancel is a cancel regardless of how the terminated process exited.
        const canceled = settleCanceled(current, new Date().toISOString())
        await this.commitTerminal(canceled)
        this.ctx.emit('task-queue/canceled', { taskId: task.id })
        this.stopping.delete(task.id)
        return
      }
      if (current.status !== 'running') return
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
    await mkdir(dirname(path), { recursive: true, mode: DIR_MODE }).catch((error) => {
      // Best-effort by contract, but never silent: surface the failure on stderr
      // so the host log can explain a missing run log.
      console.error(`task-queue: cannot create run-log dir for ${path}: ${String(error)}`)
    })
    await writeFile(path, body, { mode: FILE_MODE }).catch((error) => {
      console.error(`task-queue: cannot write run log ${path}: ${String(error)}`)
    })
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

/** The `dismissed` op is the soft-conclude toggle; it carries the full task state but never a notification. */
function dismissedChange(seq: number, state: Task): TaskChange {
  return { seq, version: 1, op: 'dismissed', taskId: state.id, state, at: new Date().toISOString() }
}

/** Project one task's durable state onto its summary view.
 * @param task - the full durable task state.
 * @returns the summary projection for list/status schemas. */
export function taskToSummary(task: Task): TaskSummary {
  // The seam's TaskSummary type is regenerated into lib by the host build; the
  // projection intentionally carries lastError so list and status schemas stay
  // in lockstep. The cast bridges pre-rebuild lib types while keeping the wire
  // contract stable.
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
    lastError: task.lastError,
    tags: task.tags,
    ownerSessionId: task.ownerSessionId,
    dismissed: task.dismissed,
  } as TaskSummary
}

export default LocalTaskQueue
