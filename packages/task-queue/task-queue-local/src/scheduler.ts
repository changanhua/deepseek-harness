/**
 * The scheduler: one host-plane tick loop that ingests the inbox, reclaims
 * crashed starting/running/stopping tasks, claims eligible pending tasks
 * (priority-ascending FIFO within concurrency), runs the two-phase
 * starting→running then settlement, and enforces delay/backoff/timeout (§5).
 *
 * The scheduler performs NOTHING durable itself: every state transition is a
 * mutation through the service FIFO (which owns append/fsync and the faulted
 * protocol). The scheduler only decides *which* transitions to request and
 * performs the single side effect — `host.spawn(spec)` — once, between the
 * `starting` write and the atomic `running` re-check inside the FIFO.
 *
 * The `SchedulerHost` interface is implemented by `LocalTaskQueue` and test
 * doubles; it intentionally exposes only leaf operations so the scheduling
 * logic stays free of store/FIFO internals.
 * @module @deepseek-ai/dsh-task-queue-local/scheduler
 */

import { createHash } from 'node:crypto'
import type { SubprocessHandle, SubprocessSpawnSpec, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import type { Task, RunRecord } from '@deepseek-ai/dsh-task-queue'

/**
 * sha256 of the executor argv so a crash log can fingerprint a command.
 * @param argv - the spawn argv to fingerprint.
 * @returns the hex sha256 digest.
 */
export function commandFingerprint(argv: readonly string[]): string {
  return createHash('sha256').update(argv.join('\u0000')).digest('hex')
}

/**
 * Split collected output into a merged run log body.
 * @param stdout - the collected stdout text.
 * @param stderr - the collected stderr text.
 * @returns the merged, header-tagged run log body.
 */
export function renderRunLog(stdout: string, stderr: string): string {
  return `[stdout]\n${stdout}\n[stderr]\n${stderr}\n`
}

/** A queued task plus the run record for its current (about-to-start) attempt. */
export interface ClaimedAttempt {
  task: Task
  run: RunRecord
}

/** The capabilities the scheduler draws from its owning service. */
export interface SchedulerHost {
  /** Run `fn` inside the service mutation FIFO. */
  mutate<T>(fn: () => Promise<T>): Promise<T>

  /** Ingest + recovery pass (inbox scan, crash reclaim) — one FIFO mutation. */
  housekeeping(): Promise<void>

  /** Pending tasks eligible to claim now, in priority-ascending FIFO order. */
  eligibleTasks(): Task[]

  /** Number of currently occupied concurrency slots (global and per-executor). */
  occupiedSlots(): { global: number; byExecutor: Map<string, number> }

  /** Advance `task` to `starting` (attempt+1, run record without pid) inside the FIFO. */
  claim(task: Task): Promise<ClaimedAttempt | undefined>

  /** Prepare a `starting` task's spec via its adapter (outside the FIFO). */
  prepare(task: Task, run: RunRecord, signal: AbortSignal): Promise<SubprocessSpawnSpec>

  /**
   * Atomic "still starting?" re-check → spawn → markRunning, inside the FIFO.
   * Returns the live handle, or `undefined` when the task was stopped/canceled
   * while preparing (no spawn happened).
   */
  spawnAndMark(task: Task, run: RunRecord, spec: SubprocessSpawnSpec): Promise<SubprocessHandle | undefined>

  /** Settle a finished attempt (succeeded/failed/requeue-or-fail) in the FIFO. */
  settle(task: Task, outcome: SubprocessOutcome, handle: SubprocessHandle): Promise<void>

  /** Settle a prepare/claim failure: `noRetry` marks it terminal (config error). */
  settleFailure(task: Task, noRetry: boolean, reason: string): Promise<void>

  /** Best-effort run-log write; never throws into settlement. */
  writeRunLog(taskId: string, attempt: number, body: string): Promise<void>

  /** True when the service is faulted or paused (scheduler halts). */
  halted(): boolean

  /** Emit `task-queue/drained` exactly once per drained transition. */
  notifyDrain(): void

  maxConcurrent: number
  maxConcurrentPerExecutor: number
  intervalMs: number
}

/** The tick loop and the per-attempt execution state machine. */
export class TaskScheduler {
  private timer: ReturnType<typeof setInterval> | undefined
  private running = false
  private readonly ticking = new Set<Promise<void>>()

  constructor(private readonly host: SchedulerHost) {}

  /** Start the tick loop. */
  start(): void {
    if (this.running) return
    this.running = true
    const loop = (): void => { void this.tick() }
    this.timer = setInterval(loop, this.host.intervalMs)
    void this.tick()
  }

  /** Stop the loop; in-flight ticks continue independently (they hold FIFO order). */
  stop(): void {
    this.running = false
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }

  /** One scheduler pass: housekeeping FIFO, then claim/execute. */
  private async tick(): Promise<void> {
    if (!this.running || this.host.halted()) return
    const task = (async () => {
      await this.host.mutate(() => this.host.housekeeping()).catch(() => {})
      await this.runClaims()
      this.host.notifyDrain()
    })()
    this.ticking.add(task)
    void task.finally(() => this.ticking.delete(task))
  }

  /** Claim and run eligible pending tasks up to the concurrency limits. */
  private async runClaims(): Promise<void> {
    if (this.host.halted()) return
    const eligible = this.host.eligibleTasks()
    const used = this.host.occupiedSlots()
    let remainingGlobal = this.host.maxConcurrent - used.global
    for (const task of eligible) {
      if (!this.running) return
      if (remainingGlobal <= 0) break
      const perExecutor = used.byExecutor.get(task.executor) ?? 0
      if (perExecutor >= this.host.maxConcurrentPerExecutor) continue
      const claimed = await this.host.claim(task)
      if (claimed === undefined) continue
      used.byExecutor.set(task.executor, perExecutor + 1)
      remainingGlobal -= 1
      void this.execute(claimed)
    }
  }

  /** One attempt's full life: prepare → spawn → wait → settle. */
  private async execute(claimed: ClaimedAttempt): Promise<void> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), claimed.task.timeoutMs)
    let handle: SubprocessHandle | undefined
    try {
      const spec = await this.host.prepare(claimed.task, claimed.run, controller.signal)
      // The attempt-scoped abort must reach the subprocess service so a timeout
      // (or cancel) escalates into tree termination; prepare-only signal would
      // leave the spawned tree immortal after the deadline (§5.2/§6.1).
      spec.signal = controller.signal
      handle = await this.host.spawnAndMark(claimed.task, claimed.run, spec)
      if (handle === undefined) return // canceled while preparing: no spawn
      const outcome = await handle.done
      await this.host.settle(claimed.task, outcome, handle)
    } catch (error) {
      if (handle === undefined) {
        // prepare threw before any spawn: the attempt is a normal failure.
        const err = error as Error
        await this.host.mutate(async () => {
          await this.host.settleFailure(claimed.task, false, err?.message ?? String(error))
        }).catch(() => {})
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
