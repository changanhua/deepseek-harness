import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { reviewTools } from './scope.ts'

/** Session-preset capability mask for the Review consumer. */
export const name = 'initiative-review-restrict'
/** Masks are enforced by the existing Tool executor. */
export const inject = ['tools']
/** Restrict each explicitly started Agent to Review read and decide.
 * @param ctx - Standing preset context whose child Agents receive the mask.
 */
export function apply(ctx: Context): void {
  ctx.on('agent/created', ({ agent }) => { agent.ctx.tools.restrict({ allow: reviewTools }) })
}
