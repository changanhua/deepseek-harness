/**
 * Package-owned invariant companion for
 * `@deepseek-ai/dsh-client-ui-work-observatory`.
 * @module @deepseek-ai/dsh-client-ui-work-observatory/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-work-observatory'

/** Cordis companion plugin name. */
export const name = 'client-ui-work-observatory-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the tracker is browser-local and its effect disposer
 * owns every listener, timer, and pending send in the client fiber.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
