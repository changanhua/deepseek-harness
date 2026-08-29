/** Package-owned invariant companion for `@deepseek-ai/dsh-delivery-evidence`. @module @deepseek-ai/dsh-delivery-evidence/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-delivery-evidence'
/** Cordis companion plugin name. */
export const name = 'delivery-evidence-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']
/** No runtime invariant: this abstract Service Definition owns no bytes; each provider verifies its own objects. */
const install: InvariantInstaller = () => {}
/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
