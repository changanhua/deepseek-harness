/** Package-owned invariant companion for `@deepseek-ai/dsh-repo-workspace-git-local`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-repo-workspace-git-local'

/** Cordis companion plugin name. */
export const name = 'repo-workspace-git-local-invariant'
/** Invariant registry required before package ownership can be reserved. */
export const inject = ['invariants']

/**
 * No runtime invariant: the unavailable provider creates no checkout or lease.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
