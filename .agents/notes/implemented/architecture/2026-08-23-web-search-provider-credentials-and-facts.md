# Agent Note: Search provider credentials via the settings seam and inspect-only provider facts

Status: implemented

English | [中文](2026-08-23-web-search-provider-credentials-and-facts.zh.md)

## Problem

The Exa and Perplexity search providers captured their API key once in `apply` (`config.apiKey ?? launchEnvironmentOf(ctx).get('EXA_API_KEY')?.value`), so a user had no persistent `settings.yaml` surface for the key reference, endpoint, or retrieval defaults, and a stored or rotated key did not reach a running process until restart. Neither provider exposed any state to runtime awareness, so the model could not inspect whether a provider is locally available or whether its credential is configured without sending a real search.

## Decision

Both providers adopt the pattern `@deepseek-ai/dsh-web-search-deepseek` already establishes. `Config` gains `apiKeyEnv` (`role('credential-ref')`, defaulting to `EXA_API_KEY` / `PERPLEXITY_API_KEY`) and marks `apiKey` `role('secret')` and deprecated: a non-empty literal `apiKey` still wins for backward compatibility, otherwise the reference is resolved for each search through the optional `ctx.credentials` seam, falling back to the launching environment when that seam is absent (R3-7 secret literal precedence). A missing key fails the search as `WEB_PROVIDER_CREDENTIAL_MISSING` with an actionable message, matching the DeepSeek provider.

Each provider registers a `web-search-exa` / `web-search-perplexity` settings namespace (`installSettingsSection`, the same canonical optional-settings wiring the web package uses), and its provider projects the resolved section per search (`() => resolveOptions(ctx, current())`), so a user-layer edit reaches the next call without re-registration and the seam's selection never flickers.

Runtime awareness is wired as the optional seam R3.1-B3 defines: `ctx.inject(['runtimeFacts'], rctx => rctx.effect(() => …))` registers two inspect-only facts owned by the provider package — `web-search.<id>.local-available` (sync/dynamic, `provider.available()`) and `web-search.<id>.credential-configured` (async/dynamic, `credentials.describe(ref).configured`, environment fallback). `@deepseek-ai/dsh-runtime-facts` is an optional peer dependency; without the service the provider works exactly as before, and unloading the plugin withdraws the facts. `available()` reports true while a resolver exists even if no key resolves yet, because credential presence is an asynchronous fact the sync contract cannot read; a selected keyless provider fails at search time instead.

## Verification

`packages/web/web-search-exa/tests/exa.settings.spec.ts` and `packages/web/web-search-perplexity/tests/perplexity.settings.spec.ts` pin, against real `SettingsProvider` and `LocalCredentialProvider` instances: a user layer overrides the composition entry and reaches the next search; a stored key is resolved per search and a rotation reaches the next call; a non-empty literal `apiKey` wins over the stored credential; the ambient environment serves when no credentials service is mounted; a missing key fails as `WEB_PROVIDER_CREDENTIAL_MISSING`; both facts register with inspect exposure and report the right values (including `false` while nothing is stored); disposing the plugin withdraws the facts (HMR-safe); and the provider keeps working with no runtime-facts service. The existing `exa.spec.ts` / `perplexity.spec.ts` suites pass with the thunk constructor and the credential-error semantic.

## Alternatives considered

**Keep reading the environment in `apply`.** Rejected: it freezes the key at registration, leaves no settings surface for the user-preference plane, and cannot pick up a rotation without a restart.

**Resolve directly from the environment in the provider.** Rejected: the per-operation resolve belongs on the credentials seam so a mounted store is authoritative and the environment stays a fallback, matching the DeepSeek provider and `repository-facts.md §4.1`.

**Declare `runtimeFacts` as a hard injection.** Rejected (R3.1-B3): it would make runtime awareness a hard dependency of web providers and break the composition that predates the plugin. The optional `ctx.inject` wiring withdraws facts on unload and keeps the provider fully functional without the service.

## Consequences

Provider state facts (`local-available`, `credential-configured`) are owned by each provider package and V1 uses `exposure: 'inspect'` only — they never auto-project into context; `credential-configured` is asynchronous and answered by `runtime_inspect kind=facts`. The DeepSeek provider registers no facts yet (V1 lands the fact contract through Exa and Perplexity). `apiKey` literals remain supported but deprecated in favor of `apiKeyEnv`, and a configuration surface learns only whether the named reference is configured, never a key value.
