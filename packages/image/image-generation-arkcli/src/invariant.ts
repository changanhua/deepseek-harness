/**
 * Package-owned invariant companion for `@changanhua/dsh-image-generation-arkcli`.
 * @module @changanhua/dsh-image-generation-arkcli/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@changanhua/dsh-image-generation-arkcli'

/** Cordis companion plugin name. */
export const name = 'image-generation-arkcli-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: registration and generation lifecycle relations belong to the shared seams. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
