import type { Context } from '@deepseek-ai/cordis'
import type {} from '@changanhua/dsh-budget'
import type {} from '@deepseek-ai/dsh-agent'

export const name = 'budget-admission-snapshot'
export const inject = ['budget', 'agents']

/** The recorded user request is denied before the replay provider is called. */
export function apply(ctx: Context): void {
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    await ctx.budget.createScope({ id: `session:${agent.id}`, kind: 'session', subjectId: agent.id, parentId: null,
      limits: { requests: 0, inputTokens: 1000000, outputTokens: 1000, totalTokens: 1001000, wallTimeMs: null }, onExhausted: 'deny' }, () => {})
    return next()
  })
}
