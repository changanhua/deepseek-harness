/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-llm-vision-relay`.
 * @module @deepseek-ai/dsh-llm-vision-relay/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-vision-relay'

/** Cordis companion plugin name. */
export const name = 'llm-vision-relay-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package rewrites request messages and registers
 * adapter routes, and every relation it relies on — one route set per provider,
 * one evidence envelope per image — is enforced synchronously in the operation
 * that establishes it.
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
