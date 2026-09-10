import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'browser-extension-invariant'
export const inject = ['invariants']
/**
 * No runtime invariant: authorization permits and executor receipts are private
 * request state; no independent ambient event represents an authorized action.
 */
const install: InvariantInstaller = () => {}
/** Reserve package ownership for this companion fiber's lifetime. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@changanhua/dsh-browser-extension', install))
