/** Package-owned companion for the local Content provider. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'content-domain-invariant'
export const inject = ['invariants']

/** No runtime invariant: the provider privately owns the handle and validates aggregates before writes and on open. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@changanhua/dsh-content-domain', install))
