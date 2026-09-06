/**
 * Package-owned invariant companion for `@changanhua/dsh-client-ui-content`.
 * @module @changanhua/dsh-client-ui-content/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@changanhua/dsh-client-ui-content'

/** Cordis companion plugin name. */
export const name = 'client-ui-content-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin owns one library controller, three slot
 * registrations, and one locale dictionary, all released by the same effect
 * disposers, so no second authority exists to check at runtime.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
