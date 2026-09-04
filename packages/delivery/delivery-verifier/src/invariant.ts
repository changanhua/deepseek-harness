/** Package invariant companion for the independent Delivery verifier. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@changanhua/dsh-delivery-verifier'

/** Cordis companion plugin name. */
export const name = 'delivery-verifier-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the verifier owns no durable store or event stream.
 * Protocol schemas, Queue settlement, and Evidence storage retain those checks.
 */
const install: InvariantInstaller = () => {}

/** Register the package's explicit no-runtime invariant reason. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
