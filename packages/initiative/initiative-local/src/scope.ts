import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { realpathNormalize } from '@deepseek-ai/dsh-workspace'
import { InitiativeError, initiativeCommandSchema, initiativeQuerySchema } from '@changanhua/dsh-initiative'
import type { CandidateActor, InitiativeCommand, InitiativeInvocation, InitiativeQuery } from '@changanhua/dsh-initiative'
import type {} from '@deepseek-ai/dsh-commands'

/**
 * Derive authority from live runtime and exact active command evidence; recheck across awaits.
 * @param ctx - Live Host registries.
 * @param agent - Exact Agent supplied by the trusted entry.
 * @param input - Normalized command or query matched against Human evidence.
 * @param invocation - Commands-owned identity, absent for Agent tools.
 * @param operatorId - Host-configured stable human operator label.
 * @param signal - Caller cancellation.
 * @returns Workspace identity, actor facts and a live reauthorization closure.
 */
export async function initiativeScope(
  ctx: Context, agent: Agent, input: InitiativeCommand | InitiativeQuery,
  invocation: InitiativeInvocation, operatorId: string, signal?: AbortSignal,
): Promise<{ actor: CandidateActor; workspaceId: import('@deepseek-ai/dsh-workspace').WorkspaceId; authorize: () => Promise<void> }> {
  const session = agent.session
  const alive = () => {
    signal?.throwIfAborted()
    if (ctx.agents.get(agent.id) !== agent || ctx.sessions.get(session.id) !== session || session.header.cwd === undefined)
      throw new InitiativeError('unauthorized', 'Initiative requires the exact live Agent and Session')
  }
  alive()
  const initialCwd = session.header.cwd
  if (initialCwd === undefined) throw new InitiativeError('unauthorized', 'Session Workspace is missing')
  const cwd = await realpathNormalize(initialCwd)
  const workspace = ctx.workspaceRegistry.list().find(value => value.path === cwd)
  if (workspace === undefined) throw new InitiativeError('unauthorized', 'Initiative requires a registered Workspace')
  const evidence = (): CandidateActor => {
    const events = session.events
    if (invocation.commandId !== undefined) {
      const run = events.find(event => event.type === 'command/run' && event.data.commandId === invocation.commandId)
      if (run?.type !== 'command/run' || run.data.name !== 'initiative'
        || events.some(event => event.type === 'command/done' && event.data.commandId === invocation.commandId))
        throw new InitiativeError('unauthorized', 'Initiative requires its exact active Human command')
      let raw: unknown
      try { raw = JSON.parse(run.data.args ?? '') } catch { throw new InitiativeError('unauthorized', 'Human command arguments are invalid') }
      const parsed = input.action === 'read' ? initiativeQuerySchema.safeParse(raw) : initiativeCommandSchema.safeParse(raw)
      if (!parsed.success || JSON.stringify(parsed.data) !== JSON.stringify(input))
        throw new InitiativeError('unauthorized', 'Human command does not authorize this exact operation')
      return { kind: 'human', id: operatorId, sessionId: session.id, eventSeq: run.seq, commandId: invocation.commandId }
    }
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index]
      if (event === undefined) continue
      if (event.type === 'turn/end') break
      if (event.type === 'turn/start') return { kind: 'agent', id: String(agent.id), sessionId: session.id, eventSeq: event.seq }
    }
    throw new InitiativeError('unauthorized', 'Agent initiative requires an open turn')
  }
  const actor = evidence()
  const authorize = async () => {
    alive()
    const currentCwd = session.header.cwd
    if (currentCwd === undefined) throw new InitiativeError('unauthorized', 'Session Workspace is missing')
    if (await realpathNormalize(currentCwd) !== cwd || ctx.workspaceRegistry.get(workspace.id)?.path !== cwd)
      throw new InitiativeError('unauthorized', 'Initiative Workspace changed')
    alive()
    if (JSON.stringify(evidence()) !== JSON.stringify(actor)) throw new InitiativeError('unauthorized', 'Initiative caller evidence changed')
  }
  await authorize()
  return { actor, workspaceId: workspace.id, authorize }
}
