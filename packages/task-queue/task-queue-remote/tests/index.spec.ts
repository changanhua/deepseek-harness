/**
 * The panel Remote's delegation contract: every exposed verb projects the
 * queue seam onto JSON wire views, branded ids flatten to plain strings, and
 * the Typert binding carries the `taskQueue` wire namespace under the
 * collision-free `taskQueueRemote` service key.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  TASK_QUEUE_HOST_ACCESS,
  RunId,
  TaskId,
} from '@deepseek-ai/dsh-task-queue'
import type {
  QueueStats,
  Task,
  TaskQueue,
  TaskSummary,
} from '@deepseek-ai/dsh-task-queue'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { TaskQueueRemoteService } from '../src/index.ts'
import * as invariant from '../src/invariant.ts'

vi.mock('node:fs/promises', async () => ({
  readFile: vi.fn(async () => 'log body'),
}))

/** A controllable in-memory queue seam for driving the Remote face. */
function makeQueue(overrides: Partial<TaskQueue> = {}): {
  queue: TaskQueue
  listCalls: unknown[]
  cancelCalls: string[]
  retryCalls: string[]
  dismissCalls: { id: string; dismissed: boolean }[]
} {
  const listCalls: unknown[] = []
  const cancelCalls: string[] = []
  const retryCalls: string[] = []
  const dismissCalls: { id: string; dismissed: boolean }[] = []
  const summary = (id: string, status: Task['status']): TaskSummary => ({
    id: TaskId(id),
    title: `task ${id}`,
    executor: 'codex',
    status,
    priority: 10,
    attempt: 1,
    maxAttempts: 3,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T01:00:00.000Z',
    lastError: null,
    tags: ['demo'],
    ownerSessionId: 'ses-1',
    dismissed: false,
  })
  const task = (id: string): Task => ({
    ...summary(id, 'running'),
    prompt: 'run the tests',
    backoffMs: 30_000,
    delayUntil: null,
    timeoutMs: 1_800_000,
    outputDir: 'queue/tq-1',
    lastError: null,
    result: null,
    source: 'tool',
    receiptId: 'rcpt-1',
    terminalSeq: null,
    runs: [{
      runId: RunId('run-1'),
      attempt: 1,
      pid: 28431,
      plannedStartedAt: '2026-08-15T00:00:00.000Z',
      actualStartedAt: '2026-08-15T00:00:01.000Z',
      logPath: 'runs/tq-1/run-1.log',
      commandFingerprint: 'codex:1',
      terminationUnverified: true,
    }],
  })
  const queue = {
    enqueueFromTool: async () => TaskId('tq-x'),
    enqueueBatchFromTool: async () => [],
    list(access: unknown, filter?: never) {
      expect(access).toBe(TASK_QUEUE_HOST_ACCESS)
      listCalls.push(filter)
      return [summary('tq-1', 'running'), summary('tq-2', 'failed')]
    },
    get(access: unknown, id: TaskId): Task {
      expect(access).toBe(TASK_QUEUE_HOST_ACCESS)
      if (String(id) !== 'tq-1') throw new Error(`unknown task ${id}`)
      return task('tq-1')
    },
    cancel(access: unknown, id: TaskId) {
      expect(access).toBe(TASK_QUEUE_HOST_ACCESS)
      cancelCalls.push(String(id))
      return Promise.resolve('stopping' as const)
    },
    retry(access: unknown, id: TaskId) {
      expect(access).toBe(TASK_QUEUE_HOST_ACCESS)
      retryCalls.push(String(id))
      return Promise.resolve(id)
    },
    async dismiss(access: unknown, id: TaskId, dismissed: boolean) {
      expect(access).toBe(TASK_QUEUE_HOST_ACCESS)
      dismissCalls.push({ id: String(id), dismissed })
    },
    stats(access: unknown): QueueStats {
      expect(access).toBe(TASK_QUEUE_HOST_ACCESS)
      return {
        serviceState: 'faulted',
        fault: { reason: 'append error' },
        byStatus: { pending: 1, starting: 0, running: 1, stopping: 0, succeeded: 0, failed: 1, canceled: 0 },
        byExecutor: { codex: 2 },
        undismissedFailed: 1,
        byDismissed: 0,
      }
    },
    registerExecutor: () => () => {},
    listExecutors: () => [{ name: 'codex', enabled: true, toolAllowed: true }],
    pause: (access: unknown) => { expect(access).toBe(TASK_QUEUE_HOST_ACCESS) },
    resume: (access: unknown) => { expect(access).toBe(TASK_QUEUE_HOST_ACCESS) },
    ackNotification: async () => {},
    listNotifications: () => [],
    ...overrides,
  } as unknown as TaskQueue
  return { queue, listCalls, cancelCalls, retryCalls, dismissCalls }
}

function mount(overrides: Partial<TaskQueue> = {}): {
  ctx: Context
  service: TaskQueueRemoteService
  queue: TaskQueue
  listCalls: unknown[]
  cancelCalls: string[]
  retryCalls: string[]
  dismissCalls: { id: string; dismissed: boolean }[]
} {
  const bench = makeQueue(overrides)
  const ctx = new Context()
  ctx.provide('taskQueue', bench.queue)
  const service = new TaskQueueRemoteService(ctx)
  return { ctx, service, ...bench }
}

describe('task-queue-remote service', () => {
  it('declares the queue backend as its only dependency', () => {
    expect(TaskQueueRemoteService.inject).toEqual(['taskQueue'])
  })

  it('binds the taskQueue wire namespace under the collision-free service key', () => {
    const { service } = mount()
    expect(service.typertRemote.serviceKey).toBe('taskQueueRemote')
    expect(service.typertRemote.namespace).toBe('taskQueue')
  })

  it('marks exactly the ten panel verbs as Remote methods', () => {
    const { service } = mount()
    expect(remoteMethods(service).map(marker => marker.method))
      .toEqual(['list', 'get', 'executors', 'readRunLog', 'stats', 'cancel', 'retry', 'dismiss', 'pause', 'resume'])
  })

  it('list passes the filter through and projects summaries to wire views', () => {
    const { service, listCalls } = mount()
    const rows = service.list({ status: 'running', executor: 'codex', tags: ['demo'], limit: 5 })
    expect(listCalls).toEqual([{ status: 'running', executor: 'codex', tags: ['demo'], limit: 5 }])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      id: 'tq-1',
      title: 'task tq-1',
      executor: 'codex',
      status: 'running',
      priority: 10,
      attempt: 1,
      maxAttempts: 3,
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T01:00:00.000Z',
      tags: ['demo'],
      ownerSessionId: 'ses-1',
      dismissed: false,
    })
  })

  it('get projects the full durable state including runs and result fields', () => {
    const { service } = mount()
    const task = service.get('tq-1')
    expect(task.id).toBe('tq-1')
    expect(task.prompt).toBe('run the tests')
    expect(task.source).toBe('tool')
    expect(task.runs).toEqual([{
      runId: 'run-1',
      attempt: 1,
      pid: 28431,
      plannedStartedAt: '2026-08-15T00:00:00.000Z',
      actualStartedAt: '2026-08-15T00:00:01.000Z',
      logPath: 'runs/tq-1/run-1.log',
      commandFingerprint: 'codex:1',
      terminationUnverified: true,
    }])
  })

  it('executors lists registered executors with live task counts', () => {
    const { service } = mount()
    expect(service.executors()).toEqual([{ name: 'codex', enabled: true, toolAllowed: true, running: 1 }])
  })

  it('readRunLog returns the on-disk log for a known run', async () => {
    const { service } = mount()
    await expect(service.readRunLog('tq-1', 'run-1')).resolves.toBe('log body')
  })

  it('readRunLog rejects a run without a log path', async () => {
    const { service } = mount({
      get(_access, id: TaskId) {
        const base = {
          id,
          title: 'tq-1',
          executor: 'codex',
          status: 'running' as const,
          priority: 10,
          attempt: 1,
          maxAttempts: 3,
          createdAt: '2026-08-15T00:00:00.000Z',
          updatedAt: '2026-08-15T01:00:00.000Z',
          tags: [] as string[],
          ownerSessionId: null,
          prompt: '',
          backoffMs: 30_000,
          delayUntil: null,
          timeoutMs: 1_800_000,
          outputDir: 'queue/tq-1',
          lastError: null,
          result: null,
          source: 'tool' as const,
          receiptId: 'rcpt-1',
          terminalSeq: null,
          runs: [],
          dismissed: false,
        }
        return base
      },
    })
    await expect(service.readRunLog('tq-1', 'run-1')).rejects.toThrow(/no log path/)
  })

  it('get rethrows the seam error for an unknown id', () => {
    const { service } = mount()
    expect(() => service.get('tq-unknown')).toThrow(/unknown task/)
  })

  it('stats projects the fault, both counter maps, and dismissed counts', () => {
    const { service } = mount()
    expect(service.stats()).toEqual({
      serviceState: 'faulted',
      fault: { reason: 'append error' },
      byStatus: { pending: 1, starting: 0, running: 1, stopping: 0, succeeded: 0, failed: 1, canceled: 0 },
      byExecutor: { codex: 2 },
      undismissedFailed: 1,
      byDismissed: 0,
    })
  })

  it('cancel and retry delegate with the plain id', async () => {
    const { service, cancelCalls, retryCalls } = mount()
    await expect(service.cancel('tq-9')).resolves.toBe('stopping')
    await expect(service.retry('tq-9')).resolves.toBe('tq-9')
    expect(cancelCalls).toEqual(['tq-9'])
    expect(retryCalls).toEqual(['tq-9'])
  })

  it('dismiss delegates with the plain id and the dismissed flag', async () => {
    const { service, dismissCalls } = mount()
    await service.dismiss('tq-9', true)
    await service.dismiss('tq-9', false)
    expect(dismissCalls).toEqual([{ id: 'tq-9', dismissed: true }, { id: 'tq-9', dismissed: false }])
  })

  it('pause and resume delegate to the service-level switch', () => {
    const pauses: string[] = []
    const resumes: string[] = []
    const { service } = mount({ pause: () => { pauses.push('pause') }, resume: () => { resumes.push('resume') } })
    service.pause()
    service.resume()
    expect(pauses).toEqual(['pause'])
    expect(resumes).toEqual(['resume'])
  })
})

describe('invariant companion', () => {
  it('registers under the package name as a no-op installer', async () => {
    const register = vi.fn().mockReturnValue(() => {})
    const ctx = { invariants: { register } } as never
    const dispose = await (invariant as { apply: (ctx: never) => Promise<() => void> }).apply(ctx)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-task-queue-remote', expect.any(Function))
    expect(() => { (register.mock.calls[0]![1] as (c: never) => void)(undefined as never) }).not.toThrow()
    expect(dispose).toBeTypeOf('function')
  })
})
