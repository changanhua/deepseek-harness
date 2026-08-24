/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-command-profile`.
 * @module @deepseek-ai/dsh-tool-command-profile/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-command-profile'

/** Cordis companion plugin name. */
export const name = 'tool-command-profile-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: tool registration lifecycle is owned by `ctx.tools`;
 * the candidate ≠ existence rule is enforced by the command-profile registry
 * DTO and this package's tests.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
