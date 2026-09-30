/** Trusted Agent-to-Workspace derivation for planning model tools. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { realpathNormalize } from '@deepseek-ai/dsh-workspace'
import { PlanningError } from '@changanhua/dsh-planning'
import type { PlanningAccess } from '@changanhua/dsh-planning'

/** Derive one access capability and recheck the exact Agent at every provider commit. */
export async function planningAgentAccess(ctx: Context, agent: Agent, signal?: AbortSignal): Promise<PlanningAccess> {
  signal?.throwIfAborted()
  const session = agent.session
  if (
    ctx.agents.get(agent.id) !== agent ||
    ctx.sessions.get(session.id) !== session ||
    session.header.cwd === undefined
  ) {
    throw new PlanningError('unauthorized', 'planning requires a live Agent in a registered Workspace')
  }
  let cwd: string
  try {
    cwd = await realpathNormalize(session.header.cwd)
  } catch (error) {
    throw new PlanningError('unauthorized', 'planning Workspace cannot be resolved', { cause: error })
  }
  const workspace = ctx.workspaceRegistry.list().find(value => value.path === cwd)
  if (workspace === undefined) throw new PlanningError('unauthorized', 'planning requires a registered Workspace')
  const events = session as { events: readonly { type: string; seq: number; data: { source?: { kind?: unknown } } }[] }
  const turnStart = openTurnStart(events)
  if (turnStart === undefined) throw new PlanningError('unauthorized', 'planning requires an open turn')
  const userMessage = latestDirectUserMessage(events)
  const authorize = async () => {
    signal?.throwIfAborted()
    const live = ctx.agents.get(agent.id)
    if (live !== agent || ctx.sessions.get(session.id) !== session || session.header.cwd === undefined) {
      throw new PlanningError('unauthorized', 'planning Agent is no longer live')
    }
    let current: string
    try {
      current = await realpathNormalize(session.header.cwd)
    } catch (error) {
      throw new PlanningError('unauthorized', 'planning Workspace cannot be resolved', { cause: error })
    }
    if (current !== cwd || ctx.workspaceRegistry.get(workspace.id)?.path !== cwd) {
      throw new PlanningError('unauthorized', 'planning Agent changed Workspace')
    }
    if (openTurnStart(events) !== turnStart)
      throw new PlanningError('unauthorized', 'planning turn is no longer current')
    const latest = latestDirectUserMessage(events)
    if (latest?.seq !== userMessage?.seq)
      throw new PlanningError('unauthorized', 'planning user authorization is no longer current')
  }
  return {
    workspaceId: workspace.id,
    actorId: String(agent.id),
    kind: 'agent',
    sessionId: String(session.id),
    ...(userMessage === undefined ? {} : { userMessage: { sessionId: String(session.id), seq: userMessage.seq } }),
    authorize,
  }
}

function openTurnStart(session: { events: readonly { type: string; seq: number }[] }): number | undefined {
  for (let index = session.events.length - 1; index >= 0; index--) {
    const event = session.events[index]
    if (event === undefined) continue
    if (event.type === 'turn/end') return undefined
    if (event.type === 'turn/start') return event.seq
  }
  return undefined
}

/** Latest direct user message inside the current unfinished turn only. */
function latestDirectUserMessage(session: {
  events: readonly { type: string; seq: number; data: { source?: { kind?: unknown } } }[]
}) {
  let latest: { seq: number } | undefined
  for (let index = session.events.length - 1; index >= 0; index--) {
    const event = session.events[index]
    if (event === undefined) continue
    if (event.type === 'turn/end') return undefined
    if (event.type === 'turn/start') return latest
    if (event.type === 'user/message' && event.data.source?.kind === 'user' && latest === undefined)
      latest = { seq: event.seq }
  }
  return undefined
}
