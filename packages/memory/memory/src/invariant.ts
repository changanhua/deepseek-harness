/** Package-owned invariant companion. @module @changanhua/dsh-memory/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis companion identity. */
export const name = 'memory-invariant'
/** Registry required before reserving package ownership. */
export const inject = ['invariants']
/** No runtime invariant: this Definition has no mutable state; the provider checks durable records against its schemas. */
const install: InvariantInstaller = () => {}
/** Register this package's companion and return its lifecycle disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@changanhua/dsh-memory', install))
