/** Package invariant companion for the image Queue WorkHandler provider. */
/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-image-generation-task-queue'
/** Cordis companion plugin name. */
export const name = 'image-generation-task-queue-invariant'
/** Registry required for package ownership. */
export const inject = ['invariants']
/** No runtime invariant: handler registration and resource claims are enforced by the Queue provider. */
const install: InvariantInstaller = () => {}
/** Register the package invariant companion. @param ctx Invariant registry context. @returns registration disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
