/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-task-queue`.
 * @module @deepseek-ai/dsh-task-queue/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-task-queue'

/** Cordis companion plugin name. */
export const name = 'task-queue-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the seam package owns no composition rows of its own;
 * the backend implementation (`dsh-task-queue-local`) owns its durable-log
 * invariants at registration time.
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
