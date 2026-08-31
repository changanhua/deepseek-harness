/** Package-owned invariant companion for the session-snapshot Eval adapter. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-eval-session-snapshot'

/** Cordis companion plugin name. */
export const name = 'eval-session-snapshot-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: each executor invocation owns one session-snapshot
 * subprocess, and the upstream harness owns its teardown and fixture checks.
 */
const install: InvariantInstaller = () => {}

/** Register the package's explicit no-runtime invariant reason. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
