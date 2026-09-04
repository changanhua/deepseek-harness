/**
 * Package-owned invariant companion for `@changanhua/dsh-client-ui-task-queue`.
 * @module @changanhua/dsh-client-ui-task-queue/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@changanhua/dsh-client-ui-task-queue'

/** Cordis companion plugin name. */
export const name = 'ui-task-queue-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the Queue workspace only projects the durable queue
 * through the panel Remote, and the slot registry already enforces entry
 * identity for `shell.view` / `sidebar.modules`.
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
