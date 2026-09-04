/** Package-owned invariant companion for the Work Observatory Client. */
/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@changanhua/dsh-client-ui-work-observatory'
export const name = 'ui-work-observatory-invariant'
export const inject = ['invariants']
/** No runtime invariant: lifecycle teardown and slot identity have focused browser tests. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
