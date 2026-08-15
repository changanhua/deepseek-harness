/** Human-facing `/queue` command: parsing, rendering, and service dispatch. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type TaskQueue from '@deepseek-ai/dsh-task-queue'
import { TaskId } from '@deepseek-ai/dsh-task-queue'
import type { QueueStats, Task, TaskSummary } from '@deepseek-ai/dsh-task-queue'
import * as commandTaskQueue from '../src/index.ts'

const ZERO_STATUS: QueueStats['byStatus'] = {
  pending: 0,
  starting: 0,
  running: 0,
  stopping: 0,
  succeeded: 0,
  failed: 0,
  canceled: 0,
}

function stats(overrides: Partial<QueueStats> = {}): QueueStats {
  return { serviceState: 'running', byStatus: ZERO_STATUS, byExecutor: {}, ...overrides }
}

function summary(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: TaskId('tq-1'),
    title: 'illustrate chapter one',
    executor: 'arkcli',
    status: 'pending',
    priority: 0,
    attempt: 0,
    maxAttempts: 3,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    tags: ['castle'],
    ownerSessionId: null,
    ...overrides,
  }
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: TaskId('tq-1'),
    title: 'illustrate chapter one',
    prompt: 'a castle in mist',
    executor: 'arkcli',
    status: 'failed',
    priority: 0,
    attempt: 3,
    maxAttempts: 3,
    backoffMs: 1000,
    delayUntil: null,
    timeoutMs: 60000,
    outputDir: '/tmp/tq-1',
    tags: ['castle'],
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:01:00.000Z',
    lastError: 'provider unavailable',
    result: null,
    ownerSessionId: 'session-1',
    source: 'tool',
    receiptId: 'tool:key:k1',
    terminalSeq: null,
    runs: [],
    ...overrides,
  }
}

interface Harness {
  ctx: Context
  agent: Agent
  session: Session
}

function stubAgent(ctx: Context, id: string): { agent: Agent; session: Session } {
  const session = ctx.sessions.create(SessionId(id))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session }
}

async function harness(queue?: TaskQueue): Promise<Harness> {
  const ctx = new Context()
  if (queue !== undefined) ctx.provide('taskQueue', queue)
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin({ inject: ['commands'], apply: commandTaskQueue.apply })
  const { agent, session } = stubAgent(ctx, `command-task-queue-${Math.random()}`)
  ctx.agents.register(agent)
  return { ctx, agent, session }
}

/** Execute `/queue` through the same registry boundary as a UI adapter. */
async function run(test: Harness, suffix = ''): Promise<NonNullable<Awaited<ReturnType<CommandRuntime['execute']>>>['result']> {
  const execution = await test.ctx.commands.execute(test.agent, `/queue${suffix}`, new AbortController().signal)
  if (execution === undefined) throw new Error('queue command was not registered')
  return execution.result
}

describe('command-task-queue', () => {
  it('registers the global /queue descriptor with its input hint', async () => {
    const test = await harness()
    expect(test.ctx.commands.list(test.agent)).toEqual([{
      name: 'queue',
      description: 'inspect and manage the durable task queue (list, stats, status, retry, cancel)',
      input: { hint: 'list | stats | status <id> | retry <id> | cancel <id>' },
    }])
    await test.ctx.fiber.dispose()
  })

  it('renders the backlog through list and forwards a parsed limit', async () => {
    const queue = {
      list: vi.fn(() => [summary(), summary({ id: TaskId('tq-2'), status: 'running', attempt: 1, executor: 'codex', tags: [] })]),
    } as unknown as TaskQueue
    const test = await harness(queue)
    const result = await run(test, ' list')
    expect(result).toEqual({
      kind: 'success',
      text: 'tq-1  pending  attempt 0/3  arkcli  illustrate chapter one  [castle]\n'
        + 'tq-2  running  attempt 1/3  codex  illustrate chapter one',
    })
    expect(queue.list).toHaveBeenCalledWith({})
    await run(test, ' list 5')
    expect(queue.list).toHaveBeenLastCalledWith({ limit: 5 })
    await test.ctx.fiber.dispose()
  })

  it('rejects an invalid limit and reports an empty queue', async () => {
    const queue = { list: vi.fn(() => []) } as unknown as TaskQueue
    const test = await harness(queue)
    expect(await run(test, ' list abc')).toMatchObject({ kind: 'error' })
    expect((await run(test, ' list abc')).text).toContain('Invalid limit')
    expect(await run(test, ' list 1 2')).toMatchObject({ kind: 'error' })
    expect(await run(test, ' list')).toEqual({ kind: 'success', text: 'The queue is empty.' })
    await test.ctx.fiber.dispose()
  })

  it('renders stats including a fault reason', async () => {
    const queue = {
      stats: vi.fn(() => stats({ serviceState: 'faulted', fault: { reason: 'append failed' }, byStatus: { ...ZERO_STATUS, failed: 2 }, byExecutor: { arkcli: 2 } })),
    } as unknown as TaskQueue
    const test = await harness(queue)
    const result = await run(test, ' stats')
    expect(result.kind).toBe('success')
    expect((result as { text: string }).text).toBe(
      'state: faulted (fault: append failed)\n'
      + 'by status: pending 0, starting 0, running 0, stopping 0, succeeded 0, failed 2, canceled 0\n'
      + 'by executor: arkcli 2',
    )
    await test.ctx.fiber.dispose()
  })

  it('renders one full record through status and rejects unknown ids', async () => {
    const queue = {
      get: vi.fn((id: string) => id === 'tq-1' ? task() : (() => { throw new Error(`unknown task ${id}`) })()),
    } as unknown as TaskQueue
    const test = await harness(queue)
    const result = await run(test, ' status tq-1')
    expect(result.kind).toBe('success')
    expect((result as { text: string }).text).toContain('status: failed  executor: arkcli  priority: 0')
    expect((result as { text: string }).text).toContain('lastError: provider unavailable')
    expect(await run(test, ' status nope')).toMatchObject({ kind: 'error' })
    expect(await run(test, ' status')).toMatchObject({ kind: 'error' })
    await test.ctx.fiber.dispose()
  })

  it('requeues through retry and reports both cancel outcomes', async () => {
    const queue = {
      retry: vi.fn(async (id: string) => TaskId(id)),
      cancel: vi.fn(async (id: string) => id === 'tq-stop' ? 'stopping' : 'canceled'),
    } as unknown as TaskQueue
    const test = await harness(queue)
    expect(await run(test, ' retry tq-1')).toEqual({ kind: 'success', text: 'Task tq-1 re-queued.' })
    expect(queue.retry).toHaveBeenCalledWith(TaskId('tq-1'))
    expect(await run(test, ' cancel tq-1')).toEqual({ kind: 'success', text: 'Task tq-1 canceled.' })
    expect(await run(test, ' cancel tq-stop')).toEqual({
      kind: 'success',
      text: 'Stop requested for task tq-stop; it will settle as canceled.',
    })
    expect(await run(test, ' cancel')).toMatchObject({ kind: 'error' })
    await test.ctx.fiber.dispose()
  })

  it('surfaces mutation failures as command errors', async () => {
    const queue = {
      retry: vi.fn(async () => { throw new Error('faulted queue') }),
      cancel: vi.fn(async () => { throw new Error('faulted queue') }),
    } as unknown as TaskQueue
    const test = await harness(queue)
    expect(await run(test, ' retry tq-1')).toMatchObject({ kind: 'error' })
    expect((await run(test, ' cancel tq-1'))).toMatchObject({ kind: 'error' })
    await test.ctx.fiber.dispose()
  })

  it('answers bare and unknown subcommands with the usage text', async () => {
    const test = await harness()
    expect(await run(test)).toEqual({ kind: 'error', text: 'Usage: /queue list [limit] | stats | status <id> | retry <id> | cancel <id>' })
    expect(await run(test, ' bogus')).toMatchObject({ kind: 'error' })
    await test.ctx.fiber.dispose()
  })

  it('reports a load-guidance error when no backend is mounted', async () => {
    const test = await harness()
    const result = await run(test, ' stats')
    expect(result.kind).toBe('error')
    expect((result as { text: string }).text).toContain('@deepseek-ai/dsh-task-queue-local')
    await test.ctx.fiber.dispose()
  })
})
