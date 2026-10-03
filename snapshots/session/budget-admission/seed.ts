import type { Context } from '@deepseek-ai/cordis'
import type {} from '@changanhua/dsh-budget'
import type {} from '@deepseek-ai/dsh-agent'
import { withBudgetDispatchEvidence } from '@changanhua/dsh-budget-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

export const name = 'budget-admission-snapshot'
export const inject = ['budget', 'agents']

/** The recorded user request is denied before the replay provider is called. */
export function apply(ctx: Context): void {
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    await ctx.budget.createScope({ id: `session:${agent.id}`, kind: 'session', subjectId: agent.id, parentId: null,
      limits: { requests: 0, inputTokens: 1000000, outputTokens: 1000, totalTokens: 1001000, wallTimeMs: null }, onExhausted: 'deny' }, () => {})
    return next()
  })
  ctx.on('llm/stream', async function* (_options, next) {
    const observed = await withBudgetDispatchEvidence(ctx, 1, async () => {
      const chunks: StreamChunk[] = []
      for await (const chunk of next()) chunks.push(chunk)
      return chunks
    }, (facts) => {
      if (facts.provider !== 'deepseek-official' || facts.model !== 'deepseek-v4-flash' || facts.parameters.maxTokens !== 64) {
        throw new Error('snapshot final dispatch identity changed')
      }
    })
    if (observed.evidence.length !== 1 || observed.evidence[0]?.dispatched !== false
      || observed.evidence[0].decision?.kind !== 'deny') throw new Error('snapshot missing final Budget refusal evidence')
    yield* observed.result
  })
}
