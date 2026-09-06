/** Package-owned companion for the content Service Definition. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'content-invariant'
export const inject = ['invariants']

/** No runtime invariant: this abstract definition has no records; providers validate stored aggregates. */
const install: InvariantInstaller = () => {}

/** Register reversible ownership of this definition's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@changanhua/dsh-content', install))
