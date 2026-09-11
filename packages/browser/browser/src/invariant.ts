import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'browser-invariant'
export const inject = ['invariants']
/** No runtime invariant: this abstract definition owns no connections, grants, or execution state. */
const install: InvariantInstaller = () => {}
/** Reserve this Service Definition's invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@changanhua/dsh-browser', install))
