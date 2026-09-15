/** Package-owned companion for the static memory Bundle. @module @changanhua/dsh-personal-memory/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Companion identity. */
export const name = 'personal-memory-invariant'
/** Invariant registry dependency. */
export const inject = ['invariants']
/** No runtime invariant: this static Bundle owns patch composition; its provider and consumers own runtime facts. */
const install: InvariantInstaller = () => {}
/** Register this Bundle's explicit invariant classification. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@changanhua/dsh-personal-memory', install))
