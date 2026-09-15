import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@changanhua/dsh-knowledge-base-task-queue'
export const name = 'knowledge-base-task-queue-invariant'
export const inject = ['invariants']
// No runtime invariant: this bridge owns no event schema; knowledge-base checks
// persisted stage provenance, while task-queue checks Work/Attempt lifecycle.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
