/** Package-owned invariant companion for the extension bridge. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'content-browser-invariant'
export const inject = ['invariants']
/**
 * No runtime invariant: request-bound grant checks and Content commit admission own
 * authorization; no ambient event represents a permitted import.
 */
const install: InvariantInstaller = () => {}
/** Register the bridge's invariant ownership for the lifetime of its companion fiber. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@changanhua/dsh-content-browser', install))
