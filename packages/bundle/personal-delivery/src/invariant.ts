/** Package-owned invariant companion for `@deepseek-ai/dsh-personal-delivery`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-personal-delivery'

/** Cordis companion plugin name. */
export const name = 'personal-delivery-invariant'
/** Invariant registry required before package ownership can be reserved. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package is a static patch carrier and owns no
 * runtime relation beyond the rows composed by its manifest-owned patch.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
