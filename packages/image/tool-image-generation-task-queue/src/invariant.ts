/** Package invariant companion for the image Queue admission Consumer. */
/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-image-generation-task-queue'
/** Cordis companion plugin name. */
export const name = 'tool-image-generation-task-queue-invariant'
/** Registry required for package ownership. */
export const inject = ['invariants']
/** No runtime invariant: owner and WorkKind validation are enforced by the Queue admission facade. */
const install: InvariantInstaller = () => {}
/** Register the package invariant companion. @param ctx Invariant registry context. @returns registration disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
