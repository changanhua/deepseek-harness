/**
 * Host-process runtime fact provider. Process constants and launch snapshots
 * stay static; hot-loadable service facts resolve through their owning seams.
 *
 * @module @deepseek-ai/dsh-runtime-facts-host
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { factKey } from '@deepseek-ai/dsh-runtime-facts'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-subprocess'
import { sanitizeProxy } from './proxy.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'runtime-facts-host'
/** Registry required before host facts can be owned. */
export const inject = ['runtimeFacts']

/**
 * Register process, execution-world, proxy, and Web-server facts.
 * @param ctx - plugin context that owns every fact registration.
 */
export function apply(ctx: Context): void {
  const owner = name
  const proxy = sanitizeProxy(launchEnvironmentOf(ctx))
  ctx.runtimeFacts.registerFact({
    key: factKey('host.os'),
    owner,
    description: 'Operating system of the host process.',
    evaluation: 'sync',
    freshness: 'static',
    exposure: 'inspect',
    resolveSync: () => process.platform,
  })
  ctx.runtimeFacts.registerFact({
    key: factKey('host.arch'),
    owner,
    description: 'CPU architecture of the host process.',
    evaluation: 'sync',
    freshness: 'static',
    exposure: 'inspect',
    resolveSync: () => process.arch,
  })
  ctx.runtimeFacts.registerFact({
    key: factKey('runtime.execution-world'),
    owner,
    description: 'Execution world of the active subprocess provider.',
    evaluation: 'sync',
    freshness: 'dynamic',
    exposure: 'baseline',
    resolveSync: () => ctx.get('subprocess')?.executionWorld,
  })
  ctx.runtimeFacts.registerFact({
    key: factKey('host.pid'),
    owner,
    description: 'Process identifier of the DSH host process.',
    evaluation: 'sync',
    freshness: 'static',
    exposure: 'inspect',
    resolveSync: () => process.pid,
  })
  ctx.runtimeFacts.registerFact({
    key: factKey('host.proxy.configured'),
    owner,
    description: 'Whether a valid system proxy was present at launch.',
    evaluation: 'sync',
    freshness: 'static',
    exposure: 'inspect',
    resolveSync: () => proxy.configured,
  })
  ctx.runtimeFacts.registerFact({
    key: factKey('host.proxy.scheme'),
    owner,
    description: 'Sanitized scheme of the launch-time system proxy.',
    evaluation: 'sync',
    freshness: 'static',
    exposure: 'inspect',
    resolveSync: () => proxy.scheme,
  })
  ctx.runtimeFacts.registerFact({
    key: factKey('host.proxy.host'),
    owner,
    description: 'Sanitized host of the launch-time system proxy.',
    evaluation: 'sync',
    freshness: 'static',
    exposure: 'inspect',
    resolveSync: () => proxy.host,
  })
  ctx.runtimeFacts.registerFact({
    key: factKey('host.proxy.port'),
    owner,
    description: 'Explicit port of the launch-time system proxy.',
    evaluation: 'sync',
    freshness: 'static',
    exposure: 'inspect',
    resolveSync: () => proxy.port,
  })
  ctx.runtimeFacts.registerFact({
    key: factKey('host.proxy.source'),
    owner,
    description: 'Source category of the launch-time system proxy.',
    evaluation: 'sync',
    freshness: 'static',
    exposure: 'inspect',
    resolveSync: () => proxy.source,
  })
  ctx.runtimeFacts.registerFact({
    key: factKey('web.server-url'),
    owner,
    description: 'Current DSH Web server bind URL.',
    evaluation: 'sync',
    freshness: 'dynamic',
    exposure: 'inspect',
    resolveSync: () => {
      const server = ctx.get('webServer')
      if (server === undefined || !Number.isSafeInteger(server.port)) return undefined
      return `http://${server.host}:${String(server.port)}`
    },
  })
}

export { sanitizeProxy } from './proxy.ts'
export type { SanitizedProxy } from './proxy.ts'
