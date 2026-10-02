import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { realpathNormalize } from '@deepseek-ai/dsh-workspace'
import { PlanningError } from '@changanhua/dsh-planning'
import type { PlanningAccess } from '@changanhua/dsh-planning'
import type { SbcDesignCaseStore } from './sbc-design-case.ts'
import type { ThinkingAgentOwner, ThinkingRunRecord } from './thinking-types.ts'

/** Host-private capability: callers carry the actual live Agent, never an authority id from model input. */
export function createThinkingAgentOwner(
  ctx: Context, store: () => Promise<SbcDesignCaseStore>,
  humanAccess: (workspaceId: string, signal: AbortSignal) => PlanningAccess,
): ThinkingAgentOwner {
  const resolve = async (agent: Agent, signal: AbortSignal) => {
    signal.throwIfAborted()
    const agents = ctx.get('agents'); const sessions = ctx.get('sessions')
    const preset = ctx.get('agentPresets') as { composedPreset(context: Context): string | undefined } | undefined
    const tools = ctx.get('tools') as { schemas(scope: Agent): { name: string }[]; get(name: string, scope: Agent): unknown } | undefined
    // Keep the runtime rejection for malformed callers of this private capability.
    // eslint-disable-next-line typescript/no-unnecessary-condition
    if (!agent?.session || agents?.get(agent.id) !== agent || sessions?.get(agent.session.id) !== agent.session ||
      preset?.composedPreset(agent.ctx) !== 'thinking-desk' || !tools)
      throw new PlanningError('unauthorized', 'Thinking requires the live restricted Thinking Session')
    const names = tools.schemas(agent).map(tool => tool.name)
    if (!tools.get('thinking_context', agent) || !tools.get('thinking_submit_result', agent) || tools.get('planning_update', agent) ||
      names.some(name => !['thinking_context', 'thinking_submit_result', 'run_code'].includes(name)))
      throw new PlanningError('unauthorized', 'Thinking tool restrictions are not active')
    if (!agent.session.header.cwd) throw new PlanningError('unauthorized', 'Thinking Workspace is missing')
    const cwd = await realpathNormalize(agent.session.header.cwd)
    const workspace = ctx.workspaceRegistry.list().find(value => value.path === cwd)
    if (!workspace) throw new PlanningError('unauthorized', 'Thinking Workspace is unavailable')
    const access = humanAccess(String(workspace.id), signal)
    const readBoard = async () => {
      signal.throwIfAborted()
      if (agents.get(agent.id) !== agent || sessions.get(agent.session.id) !== agent.session ||
        preset.composedPreset(agent.ctx) !== 'thinking-desk')
        throw new PlanningError('unauthorized', 'Thinking Session changed during operation')
      await access.authorize()
      return ctx.planning.snapshot(access, signal)
    }
    const board = await readBoard()
    const binding = board.sessionBindings?.find(value => value.sessionId === String(agent.session.id))
    if (!binding) throw new PlanningError('unauthorized', 'Thinking Session is not bound')
    const input = { workspaceId: String(workspace.id), subject: binding.subject }
    const view = await (await store()).readThinking(input, readBoard, signal)
    const run = view.runs.find(value => value.sessionId === String(agent.session.id))
    if (!run || !['planning-bound', 'prompt-accepted'].includes(run.startup.phase) ||
      binding.baseRevision !== run.planningRevisionAtStart ||
      run.context.planning.context.plan.revision !== run.planningRevisionAtStart)
      throw new PlanningError('unauthorized', 'Thinking Run is not admitted for this Session')
    return { input, run, readBoard }
  }
  return {
    context: async (agent, signal) => structuredClone((await resolve(agent, signal)).run.context),
    submit: async (agent, input, signal) => {
      const resolved = await resolve(agent, signal)
      return (await store()).submitThinking({ ...resolved.input, ...input, runId: resolved.run.id }, resolved.readBoard, signal)
    },
    isThinkingSession: (sessionId) => {
      const agent = ctx.get('agents')?.get(sessionId as Agent['id'])
      const preset = ctx.get('agentPresets') as { composedPreset(context: Context): string | undefined } | undefined
      return Promise.resolve(agent !== undefined && preset?.composedPreset(agent.ctx) === 'thinking-desk')
    },
  }
}

/** Progress cannot grant model access until the native Session and exact Planning binding exist. */
export async function authorizeThinkingStartup(ctx: Context, run: ThinkingRunRecord, access: PlanningAccess, signal: AbortSignal) {
  const agent = ctx.get('agents')?.get(run.sessionId as Agent['id'])
  const owner = ctx.get('thinkingCase')
  if (!agent || !await owner?.isThinkingSession(run.sessionId))
    throw new PlanningError('unauthorized', 'Native Thinking Session is unavailable')
  const tools = ctx.get('tools') as { get(name: string, scope: Agent): unknown; schemas(scope: Agent): { name: string }[] } | undefined
  if (!tools?.get('thinking_context', agent) || !tools.get('thinking_submit_result', agent) ||
    tools.get('planning_update', agent) ||
    tools.schemas(agent).some(tool => !['thinking_context', 'thinking_submit_result', 'run_code'].includes(tool.name)))
    throw new PlanningError('unauthorized', 'Thinking tool restrictions are not active')
  const cwd = await realpathNormalize(agent.session.header.cwd ?? '')
  if (ctx.workspaceRegistry.list().find(value => value.path === cwd)?.id !== access.workspaceId)
    throw new PlanningError('unauthorized', 'Thinking Session belongs to another Workspace')
  const board = await ctx.planning.snapshot(access, signal)
  return board.sessionBindings?.find(value => value.sessionId === run.sessionId)
}
