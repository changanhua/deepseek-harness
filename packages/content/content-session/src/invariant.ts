/** Package-owned companion for the session-backed Content capture resolver. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'content-session-invariant'
export const inject = ['invariants']

/** No runtime invariant: each resolve call owns no retained state and disposes its Session observation before returning. */
const install: InvariantInstaller = () => {}

/** Register reversible ownership of this resolver's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@changanhua/dsh-content-session', install))
