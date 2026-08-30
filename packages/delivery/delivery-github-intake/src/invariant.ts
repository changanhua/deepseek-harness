/** Package invariant companion for the GitHub Issue intake Consumer. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-delivery-github-intake'

/** Cordis companion plugin name. */
export const name = 'delivery-github-intake-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: intake adopts immutable snapshots through Delivery and
 * owns no independent persistence, event stream, or mutable registry.
 */
const install: InvariantInstaller = () => {}

/** Register the package's explicit no-runtime invariant reason. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
