/** Preset-local capability mask for a Thinking Desk Agent. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'

export const name = 'tool-thinking-case-restrict'
export const inject = ['tools']

/**
 * Install the mask in each real Agent scope after it joins this standing
 * preset. The Thinking tools live in the standing ancestor, so filtering the
 * standing scope itself would remove them from every child view.
 */
export function apply(ctx: Context): void {
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.tools.restrict({ allow: ['thinking_context', 'thinking_submit_result'] })
  })
}
