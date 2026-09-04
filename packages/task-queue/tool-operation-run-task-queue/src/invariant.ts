/**
 * Package-owned invariant companion for `@changanhua/dsh-tool-operation-run-task-queue`.
 * @module @changanhua/dsh-tool-operation-run-task-queue/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@changanhua/dsh-tool-operation-run-task-queue'

/** Cordis companion plugin name. */
export const name = 'tool-operation-run-task-queue-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: Queue admission and ToolRuntime own the observable authority,
 * schema-validation, and registration-disposal relations; this package holds no durable state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx Cordis context carrying the invariant registry.
 * @returns disposer for the package registration.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
