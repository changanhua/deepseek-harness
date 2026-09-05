/**
 * Package-owned invariant companion for `@changanhua/dsh-task-queue-local`.
 * @module @changanhua/dsh-task-queue-local/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@changanhua/dsh-task-queue-local'

/** Cordis companion plugin name. */
export const name = 'task-queue-local-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the local backend already fails closed on append
 * errors and redetermines the durable log on boot; those guarantees live in
 * the backend itself, not in a separate invariant installer.
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
