/** Package-owned companion for the memory Tool Consumer. @module @changanhua/dsh-tool-memory/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Companion identity. */
export const name = 'tool-memory-invariant'
/** Invariant registry dependency. */
export const inject = ['invariants']
/** No runtime invariant: this stateless Consumer delegates records to projectMemory and reversible tool registration to Tools. */
const install: InvariantInstaller = () => {}
/** Register this package's explicit invariant classification. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@changanhua/dsh-tool-memory', install))
