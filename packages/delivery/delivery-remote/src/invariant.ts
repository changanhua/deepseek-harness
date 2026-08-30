/** Package-owned invariant companion for `@deepseek-ai/dsh-delivery-remote`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-delivery-remote'

/** Cordis companion plugin name. */
export const name = 'delivery-remote-invariant'
/** Invariant registry required before package ownership can be reserved. */
export const inject = ['invariants']

/** No runtime invariant: Typert validation and injected service contracts own these checks. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
