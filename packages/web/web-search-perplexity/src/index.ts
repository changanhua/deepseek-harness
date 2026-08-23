/**
 * `@deepseek-ai/dsh-web-search-perplexity`: registers a Perplexity-backed
 * `WebSearchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): it registers INTO the seam's provider registry, like
 * `@deepseek-ai/dsh-llm-deepseek` registers an adapter into `ctx.llm`.
 *
 * @module @deepseek-ai/dsh-web-search-perplexity
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { RuntimeFactKey } from '@deepseek-ai/dsh-runtime-facts'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { PerplexitySearchProvider, PERPLEXITY_DEFAULT_BASE_URL, PERPLEXITY_DEFAULT_MAX_TOKENS, PERPLEXITY_DEFAULT_MODEL } from './provider.ts'
import type { PerplexitySearchProviderOptions } from './provider.ts'

export {
  PERPLEXITY_DEFAULT_BASE_URL,
  PERPLEXITY_DEFAULT_MAX_TOKENS,
  PERPLEXITY_DEFAULT_MODEL,
  PERPLEXITY_PROVIDER_ID,
  PerplexitySearchProvider,
} from './provider.ts'
export type { PerplexityRecency, PerplexitySearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-perplexity'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'PERPLEXITY_API_KEY'
const PERPLEXITY_LOCAL_AVAILABLE_FACT = 'web-search.perplexity.local-available' as RuntimeFactKey
const PERPLEXITY_CREDENTIAL_CONFIGURED_FACT = 'web-search.perplexity.credential-configured' as RuntimeFactKey

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal Perplexity API key. Deprecated composition-only compatibility; never persisted through user settings. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `PERPLEXITY_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; `/chat/completions` is appended. Defaults to the public API. */
  baseURL?: string
  /** Search model name. Defaults to `sonar`. */
  model?: string
  /** Upper bound on generated answer tokens. Defaults to 1024. */
  maxTokens?: number
  /** Recency window sent as `search_recency_filter`. Omitted = no filter. */
  searchRecency?: 'day' | 'week' | 'month' | 'year'
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  model: z.string(),
  maxTokens: z.number().step(1).min(1),
  searchRecency: z.union(['day', 'week', 'month', 'year'] as const),
})

/** User-persistable provider preferences. Secret values are deliberately absent. */
interface PerplexitySettingsSection {
  apiKeyEnv?: string
  baseURL?: string
  model?: string
  maxTokens?: number
  searchRecency?: 'day' | 'week' | 'month' | 'year'
}

const PERPLEXITY_SETTINGS_SCHEMA: z<PerplexitySettingsSection> = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  model: z.string(),
  maxTokens: z.number().step(1).min(1),
  searchRecency: z.union(['day', 'week', 'month', 'year'] as const),
})

/** Settings namespace carrying this provider's endpoint, model, and key reference. */
export const WEB_SEARCH_PERPLEXITY_SETTINGS_NAMESPACE = settingsNamespace('web-search-perplexity')

function settingsEntry(config: Config): PerplexitySettingsSection {
  return {
    ...config.apiKeyEnv === undefined ? {} : { apiKeyEnv: config.apiKeyEnv },
    ...config.baseURL === undefined ? {} : { baseURL: config.baseURL },
    ...config.model === undefined ? {} : { model: config.model },
    ...config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens },
    ...config.searchRecency === undefined ? {} : { searchRecency: config.searchRecency },
  }
}

/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param settings - the currently authoritative user/composition preference section.
 * @param literalApiKey - deprecated composition-only literal, which retains legacy precedence.
 * @returns options for one search.
 */
function resolveOptions(
  ctx: Context,
  settings: PerplexitySettingsSection,
  literalApiKey: string | undefined,
): PerplexitySearchProviderOptions {
  const apiKeyEnv = credentialRef(settings.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literal = literalApiKey !== undefined && literalApiKey.length > 0
    ? literalApiKey
    : undefined
  return {
    ...literal === undefined ? {} : { apiKey: literal },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: settings.baseURL ?? PERPLEXITY_DEFAULT_BASE_URL,
    model: settings.model ?? PERPLEXITY_DEFAULT_MODEL,
    maxTokens: settings.maxTokens ?? PERPLEXITY_DEFAULT_MAX_TOKENS,
    ...settings.searchRecency !== undefined ? { searchRecency: settings.searchRecency } : {},
  }
}

/** Register the Perplexity search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  const entry = settingsEntry(config)
  let current: () => PerplexitySettingsSection = () => entry
  installSettingsSection(ctx, WEB_SEARCH_PERPLEXITY_SETTINGS_NAMESPACE, PERPLEXITY_SETTINGS_SCHEMA, entry, {
    setSource: (source) => {
      current = source
    },
    // The registration carries no resolved value: the provider projects the
    // section per search, so a committed change needs no re-registration.
    onChange: () => {},
  })
  const provider = new PerplexitySearchProvider(() => resolveOptions(ctx, current(), config.apiKey))
  ctx.web.registerSearchProvider(provider)
  // Runtime awareness is optional: the type-only dependency below is erased
  // from emitted JS, so the provider module still loads when the optional
  // runtime-facts package/service is absent.
  ctx.inject(['runtimeFacts'], (rctx) => {
    rctx.effect(() => {
      const disposers = [
        rctx.runtimeFacts.registerFact({
          key: PERPLEXITY_LOCAL_AVAILABLE_FACT,
          owner: 'web-search-perplexity',
          description: 'Whether the Perplexity search provider is locally available.',
          evaluation: 'sync',
          freshness: 'dynamic',
          exposure: 'inspect',
          resolveSync: () => provider.available(),
        }),
        rctx.runtimeFacts.registerFact({
          key: PERPLEXITY_CREDENTIAL_CONFIGURED_FACT,
          owner: 'web-search-perplexity',
          description: 'Whether the Perplexity API key reference is configured.',
          evaluation: 'async',
          freshness: 'dynamic',
          exposure: 'inspect',
          resolveAsync: async () => {
            const credentials = ctx.get('credentials')
            const ref = credentialRef(current().apiKeyEnv ?? DEFAULT_API_KEY_ENV)
            if (credentials !== undefined) return (await credentials.describe(ref)).configured
            const ambient = launchEnvironmentOf(ctx).get(ref)
            return ambient !== undefined && ambient.value.length > 0
          },
        }),
      ]
      return async () => {
        await Promise.all(disposers.map(dispose => dispose()))
      }
    })
  })
}
