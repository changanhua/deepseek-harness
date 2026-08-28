/**
 * Human-facing `/queue` slash command over the durable task queue
 * (`ctx.taskQueue`): list, stats, status, retry, and cancel — direct service
 * control rendered by the dispatching UI, with no model involvement. The
 * backend is read optionally, so the command still registers without one and
 * reports a load-guidance error instead of resolving a half-composed service.
 * @module @deepseek-ai/dsh-command-task-queue
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type TaskQueue from '@deepseek-ai/dsh-task-queue'
import { TASK_QUEUE_HOST_ACCESS, TaskId } from '@deepseek-ai/dsh-task-queue'
import type { ListFilter, QueueStats, Task, TaskSummary } from '@deepseek-ai/dsh-task-queue'

export const name = 'command-task-queue'
export const inject = ['commands']

const USAGE = 'Usage: /queue list [limit] | stats | status <id> | retry <id> | cancel <id>'

/** Stable presentation order for the per-status counters. */
const STATUS_ORDER = ['pending', 'starting', 'running', 'stopping', 'succeeded', 'failed', 'canceled'] as const

function usage(): CommandResult {
  return { kind: 'error', text: USAGE }
}

/** Reported when the composition mounts no durable backend. */
function missingBackend(): CommandResult {
  return {
    kind: 'error',
    text: 'The task queue backend is not mounted in this composition (add @deepseek-ai/dsh-task-queue-local to a host-plane row).',
  }
}

/** One compact backlog line per task summary. */
function renderSummary(summary: TaskSummary): string {
  const tags = summary.tags.length > 0 ? `  [${summary.tags.join(', ')}]` : ''
  return `${summary.id}  ${summary.status}  attempt ${summary.attempt}/${summary.maxAttempts}  ${summary.executor}  ${summary.title}${tags}`
}

/** Service state plus status/executor counters. */
function renderStats(stats: QueueStats): string {
  const fault = stats.fault === undefined ? '' : ` (fault: ${stats.fault.reason})`
  const byStatus = STATUS_ORDER.map(status => `${status} ${stats.byStatus[status]}`).join(', ')
  const byExecutor = Object.keys(stats.byExecutor).length === 0
    ? 'none'
    : Object.entries(stats.byExecutor).map(([executor, count]) => `${executor} ${count}`).join(', ')
  return `state: ${stats.serviceState}${fault}\nby status: ${byStatus}\nby executor: ${byExecutor}`
}

/** The full durable record, condensed to one readable block. */
function renderTask(task: Task): string {
  const lines = [
    `${task.title}  (${task.id})`,
    `status: ${task.status}  executor: ${task.executor}  priority: ${task.priority}`,
    `attempt: ${task.attempt}/${task.maxAttempts}  backoff: ${task.backoffMs}ms  timeout: ${task.timeoutMs}ms`,
  ]
  if (task.delayUntil !== null) lines.push(`delayUntil: ${task.delayUntil}`)
  lines.push(`created: ${task.createdAt}  updated: ${task.updatedAt}`)
  if (task.tags.length > 0) lines.push(`tags: ${task.tags.join(', ')}`)
  if (task.ownerSessionId !== null) lines.push(`owner session: ${task.ownerSessionId}`)
  if (task.lastError !== null) lines.push(`lastError: ${task.lastError}`)
  if (task.result !== null) {
    const exit = task.result.exitCode === null ? 'signal' : `exit ${task.result.exitCode}`
    const signal = task.result.signal === null ? '' : ` signal ${task.result.signal}`
    lines.push(`result: ${exit}${signal} in ${task.result.durationMs}ms`)
    if (task.result.outputFiles !== undefined && task.result.outputFiles.length > 0) {
      lines.push(`output: ${task.result.outputFiles.join(', ')}`)
    }
  }
  if (task.runs.length > 0) {
    lines.push('runs:')
    for (const run of task.runs) {
      const unverified = run.terminationUnverified === true ? ' termination-unverified' : ''
      const started = run.actualStartedAt ?? run.plannedStartedAt ?? '-'
      lines.push(`  attempt ${run.attempt}: ${run.runId} pid ${run.pid ?? '-'} started ${started} log ${run.logPath ?? '-'}${unverified}`)
    }
  }
  return lines.join('\n')
}

function list(queue: TaskQueue, rest: readonly string[]): CommandResult {
  const filter: ListFilter = {}
  if (rest.length > 0) {
    if (rest.length > 1) return usage()
    const limit = Number.parseInt(rest[0] ?? '', 10)
    if (!Number.isInteger(limit) || limit <= 0) {
      return { kind: 'error', text: `Invalid limit: ${rest[0]}. ${USAGE}` }
    }
    filter.limit = limit
  }
  const summaries = queue.list(TASK_QUEUE_HOST_ACCESS, filter)
  if (summaries.length === 0) return { kind: 'success', text: 'The queue is empty.' }
  return { kind: 'success', text: summaries.map(renderSummary).join('\n') }
}

function status(queue: TaskQueue, rest: readonly string[]): CommandResult {
  if (rest.length !== 1) return usage()
  const id = rest[0] ?? ''
  try {
    return { kind: 'success', text: renderTask(queue.get(TASK_QUEUE_HOST_ACCESS, TaskId(id))) }
  } catch (error) {
    return { kind: 'error', text: `No task with id ${id}.` + (error instanceof Error ? ` (${error.message})` : '') }
  }
}

async function retry(queue: TaskQueue, rest: readonly string[]): Promise<CommandResult> {
  if (rest.length !== 1) return usage()
  const id = rest[0] ?? ''
  try {
    const requeued = await queue.retry(TASK_QUEUE_HOST_ACCESS, TaskId(id))
    return {
      kind: 'success',
      text: requeued === id ? `Task ${id} re-queued.` : `Task ${id} re-queued as ${requeued}.`,
    }
  } catch (error) {
    return { kind: 'error', text: `Cannot retry ${id}: ${error instanceof Error ? error.message : String(error)}` }
  }
}

async function cancel(queue: TaskQueue, rest: readonly string[]): Promise<CommandResult> {
  if (rest.length !== 1) return usage()
  const id = rest[0] ?? ''
  try {
    const outcome = await queue.cancel(TASK_QUEUE_HOST_ACCESS, TaskId(id))
    return {
      kind: 'success',
      text: outcome === 'canceled'
        ? `Task ${id} canceled.`
        : `Stop requested for task ${id}; it will settle as canceled.`,
    }
  } catch (error) {
    return { kind: 'error', text: `Cannot cancel ${id}: ${error instanceof Error ? error.message : String(error)}` }
  }
}

function execute(invocation: CommandInvocation, ctx: Context): CommandResult | Promise<CommandResult> {
  const [sub, ...rest] = invocation.rawInput.trim().split(/\s+/u)
  if (sub === undefined || sub === '') return usage()
  const queue = ctx.get('taskQueue')
  if (queue === undefined) return missingBackend()
  switch (sub) {
    case 'list': return list(queue, rest)
    case 'stats': return stats(queue)
    case 'status': return status(queue, rest)
    case 'retry': return retry(queue, rest)
    case 'cancel': return cancel(queue, rest)
    default: return usage()
  }
}

function stats(queue: TaskQueue): CommandResult {
  return { kind: 'success', text: renderStats(queue.stats(TASK_QUEUE_HOST_ACCESS)) }
}

/** Register the global `/queue` command for every composed command adapter. */
export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'queue',
    description: 'inspect and manage the durable task queue (list, stats, status, retry, cancel)',
    input: { hint: 'list | stats | status <id> | retry <id> | cancel <id>' },
    handler: invocation => execute(invocation, ctx),
  })
}
