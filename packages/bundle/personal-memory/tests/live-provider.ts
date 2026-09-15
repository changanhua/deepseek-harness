import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { load, JSON_SCHEMA } from 'js-yaml'
import { vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { Config } from '@deepseek-ai/dsh-llm-pi-ai'
import type { LaunchOptions } from '../../../../apps/web/tests/scaffold.ts'

export const MEMORY_PROVIDER = 'deepseek-official'
export const MEMORY_MODEL = 'deepseek-v4-flash'
export const GO_PROVIDER = 'opencode-go'
const ref = credentialRef('OPENCODE_GO_API_KEY')

async function configuration() {
  const home = process.env.DSH_MEMORY_CREDENTIAL_HOME ?? join(homedir(), '.dsh')
  let providers: unknown = {}
  try {
    const settings = load(await readFile(join(home, 'settings.yaml'), 'utf8'), { schema: JSON_SCHEMA }) as Record<string, unknown>
    providers = (settings['llm-pi-ai'] as { providers?: unknown } | undefined)?.providers ?? {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const parsed = Config({ providers } as Config)
  const profile = parsed.providers?.[GO_PROVIDER] ?? { apiKeyEnv: ref }
  if (profile.apiKeyEnv !== ref) throw new Error('OpenCode Go credential reference differs from the configured test route')
  return { home, profile }
}

export async function memoryCredentialAvailable(provider: string = MEMORY_PROVIDER): Promise<boolean> {
  const home = process.env.DSH_MEMORY_CREDENTIAL_HOME ?? join(homedir(), '.dsh')
  const selectedRef = provider === GO_PROVIDER ? ref : credentialRef('DEEPSEEK_API_KEY')
  const ctx = new Context()
  try {
    await ctx.plugin(CredentialsLocal, { dshHome: home, watch: false })
    return (await ctx.credentials.resolve(selectedRef)) !== undefined
  } finally {
    await ctx.fiber.dispose()
  }
}

export async function memoryLiveOptions(provider: string = MEMORY_PROVIDER): Promise<Pick<LaunchOptions, 'liveModel'>> {
  if (provider === MEMORY_PROVIDER) return {}
  if (provider !== GO_PROVIDER) throw new Error('unsupported memory-test provider')
  const { home, profile } = await configuration()
  const ctx = new Context()
  try {
    await ctx.plugin(CredentialsLocal, { dshHome: home, watch: false })
    const credential = await ctx.credentials.resolve(ref)
    if (credential === undefined) throw new Error('OpenCode Go credential is unavailable in the configured DSH credential store')
    vi.stubEnv(ref, credential.value)
  } finally {
    await ctx.fiber.dispose()
  }
  return { liveModel: {
    provider: GO_PROVIDER, model: MEMORY_MODEL, apiKeyEnv: ref,
    profile: { ...profile, apiKeyEnv: ref, models: [{ id: MEMORY_MODEL }], retryPolicy: { mode: 'normal', maxRetries: 0 } },
  } }
}
