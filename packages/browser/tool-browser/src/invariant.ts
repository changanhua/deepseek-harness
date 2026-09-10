import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'tool-browser-invariant'
export const inject = ['invariants']
/** Task-loop state is Agent-lifecycle-owned, bounded, and removed by the Agent disposal listener. */
const install: InvariantInstaller = () => {}
/** Register this tool consumer's invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@changanhua/dsh-tool-browser', install))
