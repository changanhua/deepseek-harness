/**
 * `@deepseek-ai/dsh-web-search-exa`: registers an Exa-backed `WebSearchProvider`
 * with `ctx.web`. A function/namespace plugin (NOT a default-export service):
 * a search provider does not own the `ctx.web` key — it registers INTO the
 * seam's provider registry, exactly as `@deepseek-ai/dsh-llm-deepseek`
 * registers an adapter into `ctx.llm`. The key is owned by `@deepseek-ai/dsh-web`.
 *
 * @module @deepseek-ai/dsh-web-search-exa
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { RuntimeFactKey } from '@deepseek-ai/dsh-runtime-facts'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  ExaSearchProvider,
  EXA_DEFAULT_BASE_URL,
  EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
  EXA_DEFAULT_SEARCH_TYPE,
} from './provider.ts'
import type { ExaSearchProviderOptions } from './provider.ts'

export {
  EXA_DEFAULT_BASE_URL,
  EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
  EXA_DEFAULT_SEARCH_TYPE,
  EXA_PROVIDER_ID,
  ExaSearchProvider,
} from './provider.ts'
export type { ExaSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-exa'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'EXA_API_KEY'
const EXA_LOCAL_AVAILABLE_FACT = 'web-search.exa.local-available' as RuntimeFactKey
const EXA_CREDENTIAL_CONFIGURED_FACT = 'web-search.exa.credential-configured' as RuntimeFactKey

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal Exa API key. Deprecated composition-only compatibility; never persisted through user settings. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `EXA_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; `/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Retrieval mode sent as Exa's `type`. Defaults to `auto`. */
  searchType?: 'auto' | 'keyword' | 'neural'
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults?: number
  /** Highlight sentences requested per result. Defaults to 1. */
  highlightsPerResult?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  searchType: z.union(['auto', 'keyword', 'neural'] as const),
  numResults: z.number().step(1).min(1),
  highlightsPerResult: z.number().step(1).min(1),
})

/** User-persistable provider preferences. Secret values are deliberately absent. */
interface ExaSettingsSection {
  apiKeyEnv?: string
  baseURL?: string
  searchType?: 'auto' | 'keyword' | 'neural'
  numResults?: number
  highlightsPerResult?: number
}

const EXA_SETTINGS_SCHEMA: z<ExaSettingsSection> = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  searchType: z.union(['auto', 'keyword', 'neural'] as const),
  numResults: z.number().step(1).min(1),
  highlightsPerResult: z.number().step(1).min(1),
})

/** Settings namespace carrying this provider's endpoint, retrieval, and key reference. */
export const WEB_SEARCH_EXA_SETTINGS_NAMESPACE = settingsNamespace('web-search-exa')

function settingsEntry(config: Config): ExaSettingsSection {
  return {
    ...config.apiKeyEnv === undefined ? {} : { apiKeyEnv: config.apiKeyEnv },
    ...config.baseURL === undefined ? {} : { baseURL: config.baseURL },
    ...config.searchType === undefined ? {} : { searchType: config.searchType },
    ...config.numResults === undefined ? {} : { numResults: config.numResults },
    ...config.highlightsPerResult === undefined ? {} : { highlightsPerResult: config.highlightsPerResult },
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
  settings: ExaSettingsSection,
  literalApiKey: string | undefined,
): ExaSearchProviderOptions {
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
    baseURL: settings.baseURL ?? EXA_DEFAULT_BASE_URL,
    searchType: settings.searchType ?? EXA_DEFAULT_SEARCH_TYPE,
    highlightsPerResult: settings.highlightsPerResult ?? EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
    ...settings.numResults !== undefined ? { numResults: settings.numResults } : {},
  }
}

/** Register the Exa search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  const entry = settingsEntry(config)
  let current: () => ExaSettingsSection = () => entry
  installSettingsSection(ctx, WEB_SEARCH_EXA_SETTINGS_NAMESPACE, EXA_SETTINGS_SCHEMA, entry, {
    setSource: (source) => {
      current = source
    },
    // The registration carries no resolved value: the provider projects the
    // section per search, so a committed change needs no re-registration.
    onChange: () => {},
  })
  const provider = new ExaSearchProvider(() => resolveOptions(ctx, current(), config.apiKey))
  ctx.web.registerSearchProvider(provider)
  // Runtime awareness is optional: the type-only dependency below is erased
  // from emitted JS, so the provider module still loads when the optional
  // runtime-facts package/service is absent.
  ctx.inject(['runtimeFacts'], (rctx) => {
    rctx.effect(() => {
      const disposers = [
        rctx.runtimeFacts.registerFact({
          key: EXA_LOCAL_AVAILABLE_FACT,
          owner: 'web-search-exa',
          description: 'Whether the Exa search provider is locally available.',
          evaluation: 'sync',
          freshness: 'dynamic',
          exposure: 'inspect',
          resolveSync: () => provider.available(),
        }),
        rctx.runtimeFacts.registerFact({
          key: EXA_CREDENTIAL_CONFIGURED_FACT,
          owner: 'web-search-exa',
          description: 'Whether the Exa API key reference is configured.',
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
