# Agent Note: web.search-selected derived fact and capability-visible projection

Status: implemented

English | [中文](2026-08-23-web-search-selected-fact-and-capability-projection.zh.md)

## Problem

The `WebRuntime` selection path (`resolveProvider`) picks a search provider at execution time from the live settings source, but the model had no way to learn which provider is currently selected without issuing a `search()` call and reading the success or `WebError` code. The runtime-facts registry (batch 1) already supports sync baseline projection with centralized relevance filtering, yet the web package registered no fact, so the runtime-context snapshot carried no web-selection state.

## Decision

`WebRuntime` registers one baseline runtime fact, `web.search-selected` (sync, dynamic, owner `web`), through the optional seam R3.1-B3 defines: `ctx.inject(['runtimeFacts'], rctx => rctx.effect(() => …))`. `@deepseek-ai/dsh-runtime-facts` is an optional peer dependency; without the service the web seam works unchanged, and unloading the service withdraws the fact through the `effect` disposer.

The fact's `resolveSync` calls `selectedSearchProviderId()`, a new public method that runs the same `resolveProvider` selection path as `search()` but catches `WebError` and returns `undefined` (observed as `unavailable`) instead of throwing. The runtime-facts registry's `observeSync` would contain a throw as `unavailable` with a warning log, but the internal catch avoids that noise and keeps the projection layer from pre-judging operability (R3-5): the model discovers failure reasons from the `WebError` codes thrown by `search()`, not from the projection.

The fact declares `relevance: { tools: ['web_search'] }`, so the runtime-facts registry evaluates visibility centrally through `ctx.tools.get('web_search', scope)` and projects the fact only when the tool is visible to the assembly scope. The web package writes no visibility code (R3-3). The fact is `dynamic`, so each assembly re-reads `this.source()` and a settings-layer preference change updates the next snapshot without re-registration.

## Verification

`packages/web/web/tests/web.search-selected.spec.ts` (10 tests) pins: the fact declaration (owner, evaluation, freshness, exposure, relevance); `resolveSync` returns the configured provider id; a settings-layer preference change updates the next inspection without re-registration; `unavailable` when no provider is unambiguously selected; `render` does not project when the scope is undefined or the tool is invisible; `render` projects `- web.search-selected: <id>` when `web_search` is visible to the scope; the fact flows through `systemPrompt.assemble`; the web seam works without a runtime-facts service; and disposing the runtime-facts service withdraws the fact while the web seam continues. Package tests and repository typecheck pass.

## Alternatives considered

**Cache the selected id at registration.** Rejected: the fact is `dynamic` — a settings-layer preference change must reach the next assembly, and a cached value would serve stale selection.

**Let `resolveSync` throw `WebError` and rely on the registry's `observeSync` catch.** Rejected: it produces a warning log per assembly when no provider is selected, and the projection layer should not signal operability through error semantics. `selectedSearchProviderId()` catches internally and returns `undefined`.

**Declare `runtimeFacts` as a hard injection.** Rejected (R3.1-B3): it would make runtime awareness a hard dependency of the web seam and break compositions that predate the plugin.

**Evaluate tool visibility inside the web package.** Rejected (R3-3): relevance is declarative and visibility is evaluated centrally by the runtime-facts registry through `ctx.tools`, so the fact owner writes no visibility code.

## Consequences

The baseline runtime-context snapshot gains one capability-scoped line (`- web.search-selected: <id>`) when `web_search` is visible to the scope; the unconditional baseline (host.os, host.arch, runtime.execution-world) is unchanged. V1 does not project operability — whether the selected provider can run is observed only by executing `search()` and routing the thrown `WebError` codes. A unified provider readiness protocol and `web.search-operable` are deferred to V2 (R3-5).
