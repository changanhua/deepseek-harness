/** Package-owned host-fact inventory invariant. @module @changanhua/dsh-runtime-facts-host/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@changanhua/dsh-runtime-facts'
import type {} from '@deepseek-ai/dsh-system-prompt'

const PACKAGE_NAME = '@changanhua/dsh-runtime-facts-host'
const OWNER = 'runtime-facts-host'
const EXPECTED_KEYS = [
  'host.arch',
  'host.os',
  'host.pid',
  'host.proxy.configured',
  'host.proxy.host',
  'host.proxy.port',
  'host.proxy.scheme',
  'host.proxy.source',
  'runtime.execution-world',
  'web.server-url',
] as const

/** Cordis companion plugin name. */
export const name = 'runtime-facts-host-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const result = await next()
    const facts = ctx.get('runtimeFacts')
    if (facts === undefined) return result
    const owned = facts.list().filter(fact => fact.owner === OWNER).map(fact => String(fact.key))
    if (owned.length !== 0 && (
      owned.length !== EXPECTED_KEYS.length
      || owned.some((key, index) => key !== EXPECTED_KEYS[index])
    )) {
      fail(`host fact inventory is ${JSON.stringify(owned)}, expected ${JSON.stringify(EXPECTED_KEYS)}`)
    }
    return result
  })
}, { inject: ['systemPrompt'] })

/**
 * Register the host-fact inventory invariant.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
