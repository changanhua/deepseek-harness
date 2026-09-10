/** Package-owned invariant companion for the DSH control MCP gateway. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@changanhua/dsh-control-mcp'

export const name = 'dsh-control-mcp-invariant'
export const inject = ['invariants']

/** No runtime invariant: wire validation and run binding are checked at each request boundary. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
