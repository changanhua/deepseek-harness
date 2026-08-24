/** Runtime-facts projection invariant companion. @module @deepseek-ai/dsh-runtime-facts/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-runtime-facts'

/** Cordis companion plugin name. */
export const name = 'runtime-facts-invariant'
/** Service required before invariant installation. */
export const inject = ['invariants']

const HEADER = 'Host runtime facts:'
const LINE = /^- ([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*): (.+)$/

const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const result = await next()
    const contributions = result.contexts.filter(context => context.name === 'runtime-facts')
    if (contributions.length > 1) fail('assembled context contains duplicate runtime-facts contributions')
    const contribution = contributions[0]
    if (contribution === undefined || contribution.text.length === 0) return result
    const registry = ctx.get('runtimeFacts')
    if (registry === undefined) return fail('runtime-facts context exists without the runtimeFacts service')
    const lines = contribution.text.split('\n')
    if (lines[0] !== HEADER) fail(`runtime-facts context must start with ${JSON.stringify(HEADER)}`)
    const infos = new Map(registry.list().map(info => [String(info.key), info]))
    const keys: string[] = []
    for (const line of lines.slice(1)) {
      const match = LINE.exec(line)
      if (match === null) return fail(`runtime-facts line must match ${String(LINE)}: ${JSON.stringify(line)}`)
      const key = match[1] as string
      const info = infos.get(key)
      if (info === undefined) return fail(`runtime-facts context contains unregistered key ${JSON.stringify(key)}`)
      if (info.evaluation !== 'sync' || info.exposure !== 'baseline') {
        fail(`runtime-facts context projects non-baseline key ${JSON.stringify(key)}`)
      }
      if (keys.includes(key)) fail(`runtime-facts context repeats key ${JSON.stringify(key)}`)
      keys.push(key)
    }
    const sorted = [...keys].sort()
    if (keys.some((key, index) => key !== sorted[index])) {
      fail(`runtime-facts context keys must be sorted: ${JSON.stringify(keys)}`)
    }
    return result
  })
}

/** Register the package-owned invariant contribution. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
