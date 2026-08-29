/** Package-owned invariant companion for `@deepseek-ai/dsh-repo-workspace`. @module @deepseek-ai/dsh-repo-workspace/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-repo-workspace'
/** Cordis companion plugin name. */
export const name = 'repo-workspace-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']
/** No runtime invariant: this abstract Service Definition owns no checkout; each provider checks its own Git facts. */
const install: InvariantInstaller = () => {}
/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
