/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-task-queue-executor-dsh`.
 * @module @deepseek-ai/dsh-task-queue-executor-dsh/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-task-queue-executor-dsh'

/** Cordis companion plugin name. */
export const name = 'task-queue-executor-dsh-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

// No runtime invariant: registration is an effect on the taskQueue registry
// and has no independent event stream. Required service injection and config
// checks fail at load; the queue owns execution and settlement invariants.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
