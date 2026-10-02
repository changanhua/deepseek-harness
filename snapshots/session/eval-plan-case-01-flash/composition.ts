import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'

export const name = 'eval-plan-recorded-composition'
export const inject = ['agents', 'systemPrompt', 'tools']

/** Keep authored marker cases portable: one fixed prompt and one deterministic marker tool. */
export function apply(ctx: Context): void {
  const attached = new WeakSet<Agent>()
  const attach = (agent: Agent) => {
    if (attached.has(agent)) return
    attached.add(agent)
    agent.ctx.tools.restrict({ allow: [] })
    agent.ctx.tools.register({ name: 'eval_marker', description: 'Return the deterministic replay marker.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async () => 'marker',
    })
    agent.ctx.systemPrompt.section({ name: PERSONA_PREFIX_SECTION, order: 0, text: 'Follow the user instruction exactly. This is an authored replay fixture.', complete: true })
    agent.ctx.systemPrompt.suppressRuntimeContext()
  }
  ctx.on('agent/created', ({ agent }) => { attach(agent) })
  for (const agent of ctx.agents.list()) attach(agent)
}
