/** Invariant companion for the operation-run Queue bridge. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-operation-run-task-queue'
export const name = 'operation-run-task-queue-invariant'
export const inject = ['invariants']
// No runtime invariant: the queue registry owns duplicate-handler rejection and
// lifecycle settlement; this plugin contributes only one effect-scoped handler.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
