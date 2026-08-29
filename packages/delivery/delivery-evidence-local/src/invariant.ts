/** Package-owned invariant companion for `@deepseek-ai/dsh-delivery-evidence-local`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-delivery-evidence-local'

/** Cordis companion plugin name. */
export const name = 'delivery-evidence-local-invariant'
/** Invariant registry required before package ownership can be reserved. */
export const inject = ['invariants']

/**
 * No runtime invariant: the unavailable provider publishes no evidence bytes.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
