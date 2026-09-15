/** Package-owned companion for human memory commands. @module @changanhua/dsh-command-memory/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Companion identity. */
export const name = 'command-memory-invariant'
/** Invariant registry dependency. */
export const inject = ['invariants']
/** No runtime invariant: Commands owns invocation logging and projectMemory owns authorization and durable decisions. */
const install: InvariantInstaller = () => {}
/** Register this stateless Consumer's ownership classification. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@changanhua/dsh-command-memory', install))
