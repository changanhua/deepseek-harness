/** 知识工具的生命周期由 Tools/Commands 注册器拥有。 */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
/** Companion 名称。 */
export const name = 'tool-knowledge-base-invariant'
/** 不变量注册器依赖。 */
export const inject = ['invariants']
/** No runtime invariant: this consumer owns no durable facts.
 * Request denial and registration disposal are verified by operation and Loader tests.
 */
const install: InvariantInstaller = () => {}
/** @param ctx - 注册器上下文。 @returns 可释放注册。 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@changanhua/dsh-tool-knowledge-base', install))
