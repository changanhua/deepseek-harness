import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import Schema from '@deepseek-ai/schemastery'
import { EvalPlanError } from '@changanhua/dsh-eval-plans'
import { realpathNormalize } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'

/** Human discovery and preflight over the shared Plan owner, without launching work. */
export const name = 'command-eval-plan'
/** Commands and Workspace authority are supplied by the active application. */
export const inject = ['commands', 'agents', 'workspaceRegistry', 'evalPlans']
const selection = { id: z.string().min(1).max(256), version: z.string().min(1).max(256) }
const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('discover') }).strict(),
  z.object({ action: z.literal('preflight'), ...selection }).strict(),
  z.object({ action: z.literal('admit'), ...selection, requestId: z.string().min(1).max(256) }).strict(),
])
const configSchema = z.object({ entrypoint: z.enum(['web', 'cli', 'ci']), maxOutputBytes: z.number().int().min(512) }).strict()
/** The deployment chooses the entrypoint; command JSON cannot impersonate another channel. */
export type Config = z.infer<typeof configSchema>
/** Deployment-owned channel and response bound. */
export const Config: Schema<Config> = Schema.object({ entrypoint: Schema.union(['web', 'cli', 'ci']).required(), maxOutputBytes: Schema.number().step(1).min(512).required() })

/** Register the path-free Human command on the deployment's shared command registry. */
export function apply(ctx: Context, options: Config): void {
  const config = configSchema.parse(options)
  ctx.commands.register({ name: 'eval-plan', description: '发现、预检或登记批准的 Eval Plan；不会启动评测', input: { hint: '{"action":"discover"}' },
    handler: async (invocation) => {
      try {
        const input = inputSchema.parse(JSON.parse(invocation.rawInput) as unknown)
        const agent = invocation.agent
        const cwd = agent.session.header.cwd
        if (!cwd) throw new EvalPlanError('unauthorized', 'Eval Plan discovery requires a registered Workspace')
        const path = await realpathNormalize(cwd)
        const workspace = ctx.workspaceRegistry.list().find(row => row.path === path)
        if (!workspace) throw new EvalPlanError('unauthorized', 'Eval Plan discovery requires a registered Workspace')
        const authorize = async () => {
          invocation.signal.throwIfAborted()
          const event = agent.session.events.find(row => row.type === 'command/run' && row.data.commandId === invocation.commandId)
          if (ctx.agents.get(agent.id) !== agent || ctx.workspaceRegistry.get(workspace.id) !== workspace
            || event?.type !== 'command/run' || event.data.name !== 'eval-plan' || event.data.args !== invocation.rawInput
            || agent.session.events.some(row => row.type === 'command/done' && row.data.commandId === invocation.commandId)
            || !agent.session.header.cwd || await realpathNormalize(agent.session.header.cwd) !== path) {
            throw new EvalPlanError('unauthorized', 'Eval Plan command authority changed')
          }
        }
        const access = { workspace, entrypoint: config.entrypoint, authorize }
        let output: unknown
        if (input.action === 'discover') output = await ctx.evalPlans.discover(access, invocation.signal)
        else {
          const resolved = await ctx.evalPlans.resolve(access, { id: input.id, version: input.version }, invocation.signal)
          output = input.action === 'admit' ? await ctx.evalPlans.admit(access, resolved, input.requestId, invocation.signal)
            : { summary: resolved.summary, ready: resolved.ready, checks: resolved.checks, resolvedDigest: resolved.resolvedDigest }
        }
        const text = JSON.stringify(output)
        if (Buffer.byteLength(text) > config.maxOutputBytes) return { kind: 'error', text: 'Plan 结果超过响应限制。' }
        return { kind: 'success', text }
      } catch (error) {
        if (error instanceof EvalPlanError) return { kind: 'error', text: `${error.code}: ${error.message}` }
        if (error instanceof z.ZodError || error instanceof SyntaxError) return { kind: 'error', text: '请输入有效的 Eval Plan 命令；只接受 Plan id/version 和请求标识。' }
        throw error
      }
    },
  })
}
