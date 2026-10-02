import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PlanningAccess } from '@changanhua/dsh-planning'
import { InitiativeError } from '@changanhua/dsh-initiative'
import { realpathNormalize } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-tools'

/** Tools permitted for an explicitly started Review Session. */
export const reviewTools = ['initiative_review_read', 'initiative_review_decide'] as const

/** Resolve and revalidate the current open Agent turn and restricted Workspace scope.
 * @param ctx - Injected Host owners.
 * @param agent - Exact live caller, never model-provided identity.
 * @param signal - Caller lifetime.
 * @returns Read-only Planning access plus a reusable live authorization check.
 */
export async function reviewAccess(ctx: Context, agent: Agent, signal: AbortSignal): Promise<PlanningAccess> {
  const session = agent.session
  const turn = () => {
    for (let i = session.events.length - 1; i >= 0; i--) {
      const event = session.events[i]
      if (!event) continue
      if (event.type === 'turn/end') return undefined
      if (event.type === 'turn/start') return event.seq
    }
    return undefined
  }
  const initialTurn = turn()
  const alive = () => {
    signal.throwIfAborted()
    if (ctx.agents.get(agent.id) !== agent || ctx.sessions.get(session.id) !== session ||
      initialTurn === undefined || turn() !== initialTurn || !session.header.cwd)
      throw new InitiativeError('unauthorized', 'Review requires the same live Agent, Workspace and open turn')
    const names = ctx.tools.schemas(agent).map(tool => tool.name)
    if (reviewTools.some(name => !ctx.tools.get(name, agent)) || names.some(name => ![...reviewTools, 'run_code'].includes(name)))
      throw new InitiativeError('unauthorized', 'Review requires a restricted Session with only Review read and decide tools')
  }
  alive()
  const initialCwd = session.header.cwd
  if (!initialCwd) throw new InitiativeError('unauthorized', 'Review Workspace is missing')
  const cwd = await realpathNormalize(initialCwd)
  const workspace = ctx.workspaceRegistry.list().find(value => value.path === cwd)
  if (!workspace) throw new InitiativeError('unauthorized', 'Review Workspace is not registered')
  const authorize = async () => {
    alive()
    const currentCwd = session.header.cwd
    if (!currentCwd || await realpathNormalize(currentCwd) !== cwd || ctx.workspaceRegistry.get(workspace.id)?.path !== cwd)
      throw new InitiativeError('unauthorized', 'Review Workspace changed')
    alive()
  }
  await authorize()
  return { workspaceId: workspace.id, actorId: String(agent.id), kind: 'agent', sessionId: String(session.id), authorize }
}
