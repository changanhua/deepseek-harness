# @deepseek-ai/dsh-web

English | [中文](README.zh.md)

The **`WebRuntime`** (`ctx.web`) defines WHAT web access the harness has — search the web, fetch a URL — over multiple providers, without binding the model contract to one vendor's API shape.

This package owns the Service Definition role of the web capability. Unlike shell/fs it spans two operations (search and fetch) on one seam, with potentially multiple providers each:

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-web` (this) | Service Definition: the service, provider registries, selection policy, request/result vocabulary, the `WebError` taxonomy |
| `@deepseek-ai/dsh-web-search-exa` | Search provider: Exa |
| `@deepseek-ai/dsh-web-search-perplexity` | Search provider: Perplexity |
| `@deepseek-ai/dsh-web-fetch-http` | Fetch provider: anonymous public HTTP(S) |
| `@deepseek-ai/dsh-tool-web` | Consumer: the model-facing `web_search` / `web_fetch` tool schemas over `ctx.web` |

Search and fetch share no request schema and no business logic, but they are deliberately one seam: `ctx.web` is a single web-access middle layer with one provider-selection policy owner, one abort/error vocabulary, and one product-facing "how this harness reaches the web" config surface. The `Search`/`Fetch` method pairs are deliberately parallel.

## Service API (`ctx.web`)

| Member | Semantics |
|---|---|
| `registerSearchProvider(provider)` / `registerFetchProvider(provider)` | Register a backend. Throws `WebError` `WEB_DUPLICATE_PROVIDER` on a duplicate id within that capability kind. Returns a disposer. Disposed with the calling fiber. |
| `search(request, signal?)` | Resolve the search provider and run one search. Enforces `request.maxResults` on the result (truncates `sources[]`, sets `truncated`). Throws `WebError` when the capability cannot run. |
| `fetch(request, signal?)` | Resolve the fetch provider and retrieve one URL. A non-2xx response is a result, not a throw. Throws `WebError` for failures to safely retrieve or represent the resource. |

Providers register **capabilities**, not tools. `dsh-tool-web` is the only owner of model-facing names, descriptions, prompt guidance, JSON schemas, and presentation.

## Selection

Selection never depends on registration, config, or HMR order. A capability has an explicit provider id (config `searchProvider`/`fetchProvider`, or env `$DSH_WEB_SEARCH_PROVIDER`/`$DSH_WEB_FETCH_PROVIDER` feeding the same fields), or auto-selects when exactly one usable provider is registered. `search()`/`fetch()` resolve the provider at execution time:

| Situation | Execution |
|---|---|
| configured id registered and `available()` | runs that provider |
| configured id not registered | `WEB_PROVIDER_CONFIGURED_MISSING` |
| configured id registered but unavailable | `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` |
| no id, exactly one registered usable provider | runs it |
| no id, no usable provider | `WEB_PROVIDER_UNAVAILABLE` |
| no id, multiple usable providers | `WEB_PROVIDER_AMBIGUOUS` |

The failure branches throw `WebError`, whose structured code (plus message detail — the missing id, the ambiguous candidate set) is the direct callers route on. A provider's own `available()` is a cheap local check (credential presence, parseable config) that feeds this execution-time selection and **must not make network calls**; `dsh-tool-web` never calls it — the tool executes through `ctx.web.search()`/`fetch()` and routes on the thrown codes, so provider selection has one owner.

## Preference (`web` settings section)

The `searchProvider`/`fetchProvider` preference is user-editable through the `web` settings namespace (`settings.yaml`), layered over the composition entry (`searchProvider`/`fetchProvider` config plus the same-field env override). `WebRuntime` reads the section live at every `search()`/`fetch()` call, so a user-layer edit reaches the next call without a restart or provider re-registration; an in-flight call keeps the preference snapshot it resolved when it started. A deployment without a settings provider uses the composition entry exactly as before. `WEB_SETTINGS_NAMESPACE` / `WEB_SETTINGS_SCHEMA` carry the section; the wiring follows `installSettingsSection` (`@deepseek-ai/dsh-settings`).

## Runtime fact (`web.search-selected`)

When the optional `@deepseek-ai/dsh-runtime-facts` service is mounted, `WebRuntime` registers one baseline runtime fact: `web.search-selected` (sync, dynamic, owner `web`). Its resolver reads the live settings source and runs the same internal provider-selection policy as `search()`, returning the selected provider id or `undefined` (observed as `unavailable`) when no provider is unambiguously selected. No second public selection API is exposed for this derived state. The fact declares `relevance: { tools: ['web_search'] }`, so it projects into the runtime-context snapshot only when the `web_search` tool is visible to the exact assembly scope; the runtime-facts registry evaluates visibility centrally through `ctx.tools.get(name, scope)`. A settings-layer preference or provider-registry change updates the next assembly without re-registration because the fact is `dynamic`.

The runtime-facts package is an **optional peer/type dependency** here: emitted web runtime code does not import a runtime-facts value. `ctx.inject(['runtimeFacts'], ...)` owns the lifecycle instead, so the web seam works before the service appears, withdraws its fact when the service unloads, and re-registers it if the service appears again. The projection layer does not invent readiness or fallback state; execution failures remain owned by the `WebError` codes from `search()`.

## Vocabulary

`WebSearchRequest` (`query`, `maxResults?`) → `WebSearchResult` (`content?`, `sources[]`, `truncated`); each `WebSearchSource` has a required `url` and optional `title`/`snippet`/`publishedAt` (Perplexity citations may be URL-only). `WebFetchRequest` (`url`) → `WebFetchResult` (final `url`, `statusCode`, `body`, `truncated`); cancellation is a direct optional `AbortSignal` argument to `search()`/`fetch()`. `WebFetchBody` is a CLOSED discriminated union (`html` | `text`) owned here — consumers `switch` to exhaustiveness so a new kind breaks their compilation until handled. See `src/types.ts` for the full contracts and the `WebError` code taxonomy.

## Model Experience

`dsh-tool-web` still owns the `web_search` / `web_fetch` tool schemas, descriptions, guidance, calls, and results. Separately, when runtime-facts is mounted, this seam contributes the dynamic `web.search-selected` runtime-context line only for an assembly scope where `web_search` is actually visible. The model therefore sees the effective search-provider identity without provider readiness, credential values, or Web implementation details; if selection is unresolved the fact is omitted rather than guessed.

#### KV Cache effect

`web.search-selected` is part of the dynamic runtime-context snapshot rather than the stable system prompt. An unchanged effective provider produces unchanged context text; a settings/provider-topology change that changes the effective selected id changes that request context on the next assembly. No additional agent-loop or prompt mechanism is introduced.

## Known Limitations and Deferred Work

- **No observation surface** — no provider-change event and no capability-status query; availability is observed only by executing `search()`/`fetch()` and routing the thrown `WebError` codes, and the no-provider failure is the generic `WEB_PROVIDER_UNAVAILABLE` with no per-provider reason enumeration ([Agent Note](../../../.agents/notes/archived/simplification/2026-07-04-drop-unconsumed-web-observation-surface.md)).
- **`WebSearchRequest` carries only `query` + `maxResults`** — provider-neutral controls (recency, domain filters, regional hints, search depth) are deferred until Exa and Perplexity can both honor them honestly ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)).
- **`WebFetchBody` has no `pdf` arm** — text-extractable PDF support is named deferred work; the closed union makes adding it a compile-enforced change across the three web packages.
- **Provider-backed page extraction is out of scope of `fetch()`** — a Firecrawl/Tavily-style `web_extract` capability is deferred rather than widening the fetch operation.
