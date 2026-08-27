/** Human `/queue` controls for the trusted Queue v2 operator surface. */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createVerifiedOperatorAuthority } from '@deepseek-ai/dsh-task-queue'
import type { OperatorWorkQueue, WorkStatus, WorkView } from '@deepseek-ai/dsh-task-queue'

export const name = 'command-task-queue'
export const inject = ['commands']
const USAGE = 'Usage: /queue list [limit] | stats | status <id> | retry <id> | cancel <id> | pause | resume'
const STATUS: readonly WorkStatus[] = ['queued', 'starting', 'running', 'unknown', 'succeeded', 'failed', 'canceled']

function render(view: WorkView): string {
  return `${view.work.id}  ${view.state.status}  attempt ${view.state.attemptCount}/${view.work.policy.maxAttempts}`
    + `  ${String(view.work.kind)}  ${view.work.title}`
}
function error(text: string): CommandResult { return { kind: 'error', text } }
function operator(ctx: Context): OperatorWorkQueue | undefined { const queue = ctx.get('taskQueue'); return queue?.forOperator(createVerifiedOperatorAuthority()) }
function list(queue: OperatorWorkQueue, rest: readonly string[]): CommandResult {
  if (rest.length > 1) return error(USAGE)
  const limit = rest.length === 0 ? undefined : Number(rest[0])
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) return error(`Invalid limit. ${USAGE}`)
  const rows = queue.list().slice(0, limit)
  return { kind: 'success', text: rows.length === 0 ? 'The queue is empty.' : rows.map(render).join('\n') }
}
function stats(queue: OperatorWorkQueue): CommandResult {
  const counts: Record<WorkStatus, number> = { queued: 0, starting: 0, running: 0, unknown: 0, succeeded: 0, failed: 0, canceled: 0 }
  for (const view of queue.list()) counts[view.state.status] += 1
  return { kind: 'success', text: STATUS.map(status => `${status} ${counts[status]}`).join(', ') }
}
function status(queue: OperatorWorkQueue, id: string | undefined): CommandResult {
  if (id === undefined) return error(USAGE)
  try { const view = queue.get(id as never); return { kind: 'success', text: `${render(view)}\ncreated: ${view.work.createdAt}\nupdated: ${view.state.updatedAt}${view.state.failure === null ? '' : `\nfailure: ${view.state.failure.message}`}` } } catch (cause) { return error(`No WorkItem ${id}: ${cause instanceof Error ? cause.message : String(cause)}`) }
}
async function mutate(queue: OperatorWorkQueue, action: 'retry' | 'cancel', id: string | undefined): Promise<CommandResult> {
  if (id === undefined) return error(USAGE)
  try { await queue[action](id as never); return { kind: 'success', text: `${action === 'retry' ? 'Retried' : 'Cancellation requested for'} ${id}.` } } catch (cause) { return error(`Cannot ${action} ${id}: ${cause instanceof Error ? cause.message : String(cause)}`) }
}
function execute(invocation: CommandInvocation, ctx: Context): CommandResult | Promise<CommandResult> {
  const [sub, ...rest] = invocation.rawInput.trim().split(/\s+/u)
  const queue = operator(ctx)
  if (queue === undefined) return error('The Queue v2 backend is not mounted in this composition.')
  switch (sub) {
    case 'list': return list(queue, rest)
    case 'stats': return stats(queue)
    case 'status': return status(queue, rest[0])
    case 'retry': return mutate(queue, 'retry', rest[0])
    case 'cancel': return mutate(queue, 'cancel', rest[0])
    case 'pause': queue.pause(); return { kind: 'success', text: 'Dispatch paused; admissions and operator actions remain available.' }
    case 'resume': queue.resume(); return { kind: 'success', text: 'Dispatch resumed.' }
    default: return error(USAGE)
  }
}
/** Register the global Queue v2 operator command. */
export function apply(ctx: Context): void {
  ctx.commands.register({ name: 'queue', description: 'inspect and manage typed durable WorkItems', input: { hint: 'list | stats | status <id> | retry <id> | cancel <id> | pause | resume' }, handler: invocation => execute(invocation, ctx) })
}
