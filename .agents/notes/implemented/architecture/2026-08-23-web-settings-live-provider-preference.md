# Agent Note: Web search/fetch provider preference through the settings seam

Status: implemented

English | [中文](2026-08-23-web-settings-live-provider-preference.zh.md)

## Problem

The web seam selected its search and fetch providers from `WebRuntimeConfig.searchProvider` / `fetchProvider` (composition) with `$DSH_WEB_SEARCH_PROVIDER` / `$DSH_WEB_FETCH_PROVIDER` feeding the same fields. That value was captured once in the constructor, so a user had no persistent `settings.yaml` surface for the default provider and no way to change it without a restart. The settings seam already existed and had consumed several capabilities (theme, locale, default model route); the web provider preference was the next user-editable choice without an owner.

## Decision

`WebRuntime` registers a `web` settings namespace (`WEB_SETTINGS_NAMESPACE` via `settingsNamespace('web')`, `WEB_SETTINGS_SCHEMA` holding `searchProvider` / `fetchProvider`). The composition entry is built from the same fields as before (`config.searchProvider ?? process.env.DSH_WEB_SEARCH_PROVIDER`, and the fetch twin), so a deployment without a settings provider behaves exactly as it did. The wiring is the canonical `installSettingsSection` consumer pattern already used by `agent-default-model`: the service keeps a `source: () => WebSettingsSection` thunk that points at the resolved settings scope while one is attached and falls back to the entry when the settings provider detaches.

`search()` / `fetch()` read `source()` once at the start of the call and resolve the provider from that snapshot. A user-layer edit to `web.searchProvider` reaches the next call without a restart or provider re-registration (B5 live-resolve semantics); an in-flight call keeps the preference it resolved when it started. Omitted ids keep auto-selection exactly as before. The existing `WEB_SETTINGS_NAMESPACE` / `WEB_SETTINGS_SCHEMA` exports are the only additions to the public surface besides the `WebSettingsSection` type.

## Verification

`packages/web/web/tests/web.settings.spec.ts` pins the four live-resolve behaviors against a real `SettingsProvider`: a user layer overrides the composition entry; a hot `settings.replace` changes the next call but not the in-flight one (per-operation snapshot); detaching the settings provider falls back to the entry; and no settings provider means the composition entry runs unchanged. The existing `web.spec.ts` contract suite (registration, selection, `maxResults`, fetch, abort) passes unchanged.

## Alternatives considered

**Keep the constructor-captured id.** Rejected: it freezes the preference at boot, so an edit cannot take effect until restart, and it leaves no settings surface for the user-preference plane.

**Read `settings.yaml` directly in `search()`.** Rejected: it bypasses `ctx.settings` layering and watch semantics and would duplicate the source-of-truth question the settings seam already owns.

## Consequences

The web capability becomes another consumer of the user-preference plane (B2: `ctx.web` owns the default-provider preference). The preference, selection, and execution boundary stay with `WebRuntime`; `tool-web` and providers gain no selection authority. The live `source()` thunk is the same value the later provider-fact contribution reads for `web.search-selected`, so no separate state needs to be introduced there.
