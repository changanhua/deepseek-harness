/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-capability`.
 * @module @deepseek-ai/dsh-client-ui-capability/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-capability'

/** Cordis companion plugin name. */
export const name = 'ui-capability-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the Capability workspace only projects the
 * capabilityRegistry Remote through declared slots, and the slot registry
 * already enforces entry identity for `shell.view` / `sidebar.modules`.
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
