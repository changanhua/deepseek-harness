/** Package-owned invariant companion for Delivery Protocol's pure value algebra. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@changanhua/dsh-delivery-protocol'

/** Cordis companion plugin name. */
export const name = 'delivery-protocol-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns immutable value schemas and canonical
 * digest functions, whose algebra is enforced by golden and unit tests.
 */
const install: InvariantInstaller = () => {}

/** Register the package's explicit no-runtime invariant reason. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
