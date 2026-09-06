/** Package-owned companion for authenticated Content Remote operations. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'content-remote-invariant'
export const inject = ['invariants']

/** No runtime invariant: the Remote owns no durable state; Connection and Content check each invocation. */
const install: InvariantInstaller = () => {}

/** Register reversible ownership of this Remote companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@changanhua/dsh-content-remote', install))
