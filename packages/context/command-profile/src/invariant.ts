/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-command-profile`.
 * @module @deepseek-ai/dsh-command-profile/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { COMMAND_PROFILES_SETTINGS_NAMESPACE } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-command-profile'

/** Cordis companion plugin name. */
export const name = 'command-profile-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Reject a committed `commandProfiles` settings section that would violate the
 * one-user-contribution-per-profile rule. The registry enforces the same rule
 * when it reloads contributions; this catches a settings update that bypassed
 * or raced the reload path.
 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('settings/updated', (ns, next) => {
    if (ns !== COMMAND_PROFILES_SETTINGS_NAMESPACE) return
    const section = next as { profiles?: readonly { id?: unknown }[] } | undefined
    const profiles = section?.profiles ?? []
    const seen = new Set<string>()
    for (const profile of profiles) {
      const id = profile.id
      if (typeof id !== 'string') {
        fail('commandProfiles settings profile is missing a string id')
        continue
      }
      if (seen.has(id)) {
        fail(`commandProfiles settings contain duplicate profile id ${JSON.stringify(id)}`)
      }
      seen.add(id)
    }
  })
}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
