/** Derive project scope and human-command evidence from live runtime objects. @module @changanhua/dsh-memory-local/scope */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-commands'
import { realpathNormalize } from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { MemoryError, memoryTimestampSchema } from '@changanhua/dsh-memory'
import assert from 'node:assert/strict'

/**
 * Resolve the registered canonical Workspace of the exact live caller Session.
 * @param ctx - Host services holding live Sessions and the Workspace registry.
 * @param agent - Caller whose exact Session object must remain registered.
 * @param signal - Optional cancellation checked around path resolution.
 * @returns The registered Workspace matching the caller's canonical working directory.
 */
export async function resolveMemoryScope(ctx: Context, agent: Agent, signal?: AbortSignal): Promise<Workspace> {
  signal?.throwIfAborted()
  const session = (agent as Partial<Agent>).session
  if (session === undefined || agent.id !== session.id
    || ctx.sessions.get(session.id) !== session || session.header.cwd === undefined) {
    throw new MemoryError('workspace-unavailable', 'memory requires a live Agent in a registered Workspace')
  }
  let cwd: string
  try { cwd = await realpathNormalize(session.header.cwd) }
  catch (error) { throw new MemoryError('workspace-unavailable', 'memory Workspace cannot be resolved', { cause: error }) }
  signal?.throwIfAborted()
  const workspace = ctx.workspaceRegistry.list().find(value => value.path === cwd)
  if (workspace === undefined) throw new MemoryError('workspace-unavailable', 'register this Workspace before using project memory')
  return workspace
}

/**
 * Require the exact still-running human command; text in a model message is never evidence.
 * @param agent - Live caller whose event history supplies command evidence.
 * @param commandId - Identity of the active /memory command.
 * @param expectedArgs - Exact authorized operation arguments, allowing whitespace normalization.
 * @returns The matching unfinished command/run event, or throws unauthorized.
 */
export function memoryCommand(agent: Agent, commandId: string, expectedArgs: string): SessionEvent<'command/run'> {
  const run = activeMemoryCommand(agent, commandId)
  if (normalizeArgs(run.data.args ?? '') !== normalizeArgs(expectedArgs)) {
    throw new MemoryError('unauthorized', 'this memory operation requires its exact active human command')
  }
  return run
}

/**
 * Authorize only list, show, or inspection of a human decision's exact target.
 * @param agent - Live caller whose event history supplies command evidence.
 * @param commandId - Identity of the active /memory command.
 * @param id - Requested record identity; omission authorizes list inspection only.
 * @param revision - Exact revision when the command targets one.
 * @returns The matching unfinished command/run event, or throws unauthorized.
 */
export function memoryInspectionCommand(
  agent: Agent, commandId: string, id?: string, revision?: number,
): SessionEvent<'command/run'> {
  const run = activeMemoryCommand(agent, commandId)
  const args = normalizeArgs(run.data.args ?? '')
  if (id === undefined) {
    if (revision === undefined && (args === '' || /^list(?: [1-9][0-9]*)?$/u.test(args))) return run
  } else {
    const target = `${id}${revision === undefined ? '' : `@${revision}`}`
    if (args === `show ${target}`) return run
    const parts = args.split(' ')
    const [action, subject, flag, date] = parts
    assert(action !== undefined, 'splitting command text always yields an action token')
    const match = /^([a-zA-Z0-9_-]{1,256})@([1-9][0-9]*)$/u.exec(subject ?? '')
    const subjectId = match?.[1]
    const subjectRevision = Number(match?.[2])
    if (subjectId === id && Number.isSafeInteger(subjectRevision)
      && (revision === undefined || revision === subjectRevision)
      && (parts.length === 2 && ['accept', 'reject', 'retire'].includes(action)
        || parts.length === 4 && action === 'accept' && flag === '--review-after'
          && memoryTimestampSchema.safeParse(date).success)) return run
  }
  throw new MemoryError('unauthorized', 'this memory inspection requires its exact active human command')
}

function normalizeArgs(value: string): string { return value.trim().replace(/\s+/gu, ' ') }

function activeMemoryCommand(agent: Agent, commandId: string): SessionEvent<'command/run'> {
  const events = agent.session.events
  const run = events.find((event): event is SessionEvent<'command/run'> => event.type === 'command/run' && event.data.commandId === commandId)
  if (run === undefined || run.data.name !== 'memory'
    || events.some(event => event.type === 'command/done' && event.data.commandId === commandId)) {
    throw new MemoryError('unauthorized', 'this memory operation requires its exact active human command')
  }
  return run
}
