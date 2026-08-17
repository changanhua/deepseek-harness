import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { RunId, TaskId } from '@deepseek-ai/dsh-task-queue'
import type { Task, RunRecord } from '@deepseek-ai/dsh-task-queue'
import { TaskScheduler } from '../src/scheduler.ts'
import type { ClaimedAttempt, SchedulerHost } from '../src/scheduler.ts'

function task(id: string, status: Task['status'] = 'pending', extra: Partial<Task> = {}): Task {
  return {
    id: TaskId(id),
    title: 't',
    prompt: 'p',
    executor: 'shell',
    status,
    priority: 10,
    attempt: 0,
    maxAttempts: 3,
    backoffMs: 1000,
    delayUntil: null,
    timeoutMs: 60_000,
    outputDir: '/out',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastError: null,
    result: null,
    ownerSessionId: null,
    source: 'tool',
    receiptId: 'tool:auto:1',
    terminalSeq: null,
    runs: [],
    dismissed: false,
    ...extra,
  }
}

function run(attempt: number): RunRecord {
  return {
    runId: RunId(`run-${attempt}`),
    attempt,
    pid: null,
    plannedStartedAt: '2026-01-01T00:00:00.000Z',
    actualStartedAt: null,
    logPath: '/l',
    commandFingerprint: null,
  }
}

const spec: SubprocessSpawnSpec = { argv: ['echo', 'hi'], cwd: '/', stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }, graceMs: 1000 }

function outcome(exitCode: number | null, signal: string | null = null): SubprocessOutcome {
  return { exitCode, signal: signal as SubprocessOutcome['signal'] }
}

interface FakeHostOptions {
  eligible?: Task[]
  slots?: { global: number; byExecutor: Map<string, number> }
  halted?: boolean
  prepareError?: Error
  claimReturnsUndefined?: boolean
  spawnReturnsUndefined?: boolean
  exitCode?: number | null
}

/** A controllable SchedulerHost test double recording every call. */
function makeHost(overrides: FakeHostOptions = {}) {
  const calls = {
    housekeeping: 0,
    claim: 0,
    prepare: 0,
    spawnAndMark: 0,
    settled: [] as Array<{ task: Task; outcome: SubprocessOutcome }>,
    failure: [] as Array<{ task: Task; noRetry: boolean; reason: string }>,
  }
  const eligible = overrides.eligible ?? [task('tq-1')]
  const host: SchedulerHost = {
    maxConcurrent: 2,
    maxConcurrentPerExecutor: 1,
    intervalMs: 60_000,
    mutate: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
    housekeeping: async () => { calls.housekeeping += 1 },
    eligibleTasks: () => (overrides.halted ? [] : eligible),
    occupiedSlots: () => (overrides.slots ?? { global: 0, byExecutor: new Map() }),
    claim: async (t: Task): Promise<ClaimedAttempt | undefined> => {
      calls.claim += 1
      if (overrides.claimReturnsUndefined) return undefined
      return { task: { ...t, status: 'starting', attempt: 1 }, run: run(1) }
    },
    prepare: async (_t: Task, _r: RunRecord, _s: AbortSignal): Promise<SubprocessSpawnSpec> => {
      calls.prepare += 1
      if (overrides.prepareError) throw overrides.prepareError
      return spec
    },
    spawnAndMark: async (_t: Task, _r: RunRecord, _s: SubprocessSpawnSpec): Promise<SubprocessHandle | undefined> => {
      calls.spawnAndMark += 1
      if (overrides.spawnReturnsUndefined) return undefined
      return {
        pid: 42,
        done: Promise.resolve(outcome(overrides.exitCode ?? 0)),
        collected: { stdout: { readFrom: () => ({ text: '', truncated: false }) }, stderr: { readFrom: () => ({ text: '', truncated: false }) } },
        terminate: () => {},
      } as unknown as SubprocessHandle
    },
    settle: async (t: Task, o: SubprocessOutcome, _h: SubprocessHandle): Promise<void> => {
      calls.settled.push({ task: t, outcome: o })
    },
    settleFailure: async (t: Task, noRetry: boolean, reason: string): Promise<void> => {
      calls.failure.push({ task: t, noRetry, reason })
    },
    writeRunLog: async (_id: string, _a: number, _b: string): Promise<void> => {},
    halted: () => overrides.halted === true,
    notifyDrain: () => {},
  }
  return { host, calls }
}

/** Poll until `predicate` is true or a timeout elapses (flushes microtasks). */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

let schedulers: TaskScheduler[] = []

afterEach(() => {
  for (const s of schedulers) s.stop()
  schedulers = []
  vi.restoreAllMocks()
})

describe('TaskScheduler success chain', () => {
  it('claim → prepare → spawnAndMark → settle for a successful attempt', async () => {
    const { host, calls } = makeHost()
    const scheduler = new TaskScheduler(host)
    schedulers.push(scheduler)
    scheduler.start()

    await waitFor(() => calls.settled.length === 1)

    expect(calls.housekeeping).toBe(1)
    expect(calls.claim).toBe(1)
    expect(calls.prepare).toBe(1)
    expect(calls.spawnAndMark).toBe(1)
    expect(calls.settled).toHaveLength(1)
    expect(calls.settled[0]!.outcome.exitCode).toBe(0)
    expect(calls.settled[0]!.task.status).toBe('starting')

    scheduler.stop()
  })

  it('settles failure when prepare throws (prepare happens outside the FIFO)', async () => {
    const err = new Error('unknown executor')
    const { host, calls } = makeHost({ prepareError: err })
    const scheduler = new TaskScheduler(host)
    schedulers.push(scheduler)
    scheduler.start()

    await waitFor(() => calls.failure.length === 1)

    expect(calls.prepare).toBe(1)
    expect(calls.spawnAndMark).toBe(0)
    expect(calls.failure).toHaveLength(1)
    expect(calls.failure[0]!.noRetry).toBe(false)
    expect(calls.failure[0]!.reason).toBe('unknown executor')
    scheduler.stop()
  })

  it('does not settle when spawnAndMark returns undefined (canceled while preparing)', async () => {
    const { host, calls } = makeHost({ spawnReturnsUndefined: true })
    const scheduler = new TaskScheduler(host)
    schedulers.push(scheduler)
    scheduler.start()

    // Give the fire-and-forget execute a chance to run.
    await waitFor(() => calls.spawnAndMark === 1)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(calls.settled).toHaveLength(0)
    expect(calls.failure).toHaveLength(0)
    scheduler.stop()
  })
})

describe('TaskScheduler halted', () => {
  it('does not tick housekeeping or claim when halted', async () => {
    const { host, calls } = makeHost({ halted: true })
    const scheduler = new TaskScheduler(host)
    schedulers.push(scheduler)
    scheduler.start()

    await new Promise(resolve => setTimeout(resolve, 30))
    expect(calls.housekeeping).toBe(0)
    expect(calls.claim).toBe(0)
    scheduler.stop()
  })
})

describe('TaskScheduler concurrency slots', () => {
  it('stops claiming when global slots are exhausted', async () => {
    const { host, calls } = makeHost({
      eligible: [task('tq-1'), task('tq-2')],
      slots: { global: 2, byExecutor: new Map() }, // fully occupied
    })
    const scheduler = new TaskScheduler(host)
    schedulers.push(scheduler)
    scheduler.start()

    await new Promise(resolve => setTimeout(resolve, 30))
    expect(calls.claim).toBe(0)
    scheduler.stop()
  })

  it('skips a task whose executor is at its per-executor cap', async () => {
    const { host, calls } = makeHost({
      eligible: [task('tq-1'), task('tq-2')],
      slots: { global: 0, byExecutor: new Map([['shell', 1]]) }, // executor capped at 1
    })
    const scheduler = new TaskScheduler(host)
    schedulers.push(scheduler)
    scheduler.start()

    await new Promise(resolve => setTimeout(resolve, 30))
    // All eligible tasks use the capped "shell" executor, so none is claimed.
    expect(calls.claim).toBe(0)
    scheduler.stop()
  })

  it('claims one task when one global slot remains', async () => {
    const { host, calls } = makeHost({
      eligible: [task('tq-1')],
      slots: { global: 1, byExecutor: new Map() }, // one slot free
    })
    const scheduler = new TaskScheduler(host)
    schedulers.push(scheduler)
    scheduler.start()

    await waitFor(() => calls.claim === 1)
    expect(calls.claim).toBe(1)
    scheduler.stop()
  })
})
