/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-settings-skills`.
 * @module @deepseek-ai/dsh-client-ui-settings-skills/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings-skills'

/** Cordis companion plugin name. */
export const name = 'client-ui-settings-skills-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the feature owns no read/write load-bearing mutation —
 * it observes the read-only management remote and renders from it, and every
 * failing load is kept as page-local error state rather than an invariant.
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
