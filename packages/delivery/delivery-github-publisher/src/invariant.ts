/** Package invariant companion for the Host-only GitHub Issue publisher. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@changanhua/dsh-delivery-github-publisher'

/** Cordis companion plugin name. */
export const name = 'delivery-github-publisher-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: Delivery owns every durable publication transition. */
const install: InvariantInstaller = () => {}

/** Register the package's explicit no-runtime invariant reason. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
