/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-runtime-inspect`.
 * @module @deepseek-ai/dsh-tool-runtime-inspect/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-runtime-inspect'

/** Cordis companion plugin name. */
export const name = 'tool-runtime-inspect-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No independent runtime invariant: tool registration lifecycle is owned by
 * `ctx.tools`; authoritative fact and executable relations are enforced by the
 * runtime-facts and subprocess seams and covered by this package's tests.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
