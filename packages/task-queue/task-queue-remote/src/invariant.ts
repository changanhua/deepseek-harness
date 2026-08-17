/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-task-queue-remote`.
 * @module @deepseek-ai/dsh-task-queue-remote/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-task-queue-remote'

/** Cordis companion plugin name. */
export const name = 'task-queue-remote-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the Remote face only projects and mutates the
 * durable queue through the Service seam, and Typert enforces endpoint
 * identity at the wire boundary.
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
