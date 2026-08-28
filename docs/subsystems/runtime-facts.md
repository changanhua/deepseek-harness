# Runtime Facts

English | [中文](runtime-facts.zh.md)

The runtime-facts subsystem is an owned registry for secret-free scalar observations about the active Harness process and its mounted capability providers. [`dsh-runtime-facts`](../../packages/context/runtime-facts) is the Service Definition and synchronous runtime-context Consumer; [`dsh-runtime-facts-host`](../../packages/context/runtime-facts-host) is the initial Service Provider. A declaration's owner remains responsible for source authority, sanitization, and whether changing state is static or dynamic.

Source: [`packages/context/runtime-facts/src/types.ts`](../../packages/context/runtime-facts/src/types.ts) and [`packages/context/runtime-facts/src/index.ts`](../../packages/context/runtime-facts/src/index.ts)

## Keys, values, and observation states

Keys use dotted lowercase kebab-case segments. Values remain scalar so automatic projection and inspection have deterministic compact rendering; the scalar restriction does not replace provider-owned secret sanitization.

```ts type-equiv
/** A dotted lowercase kebab-case runtime fact name. */
type RuntimeFactKey = Branded<'RuntimeFactKey'>
```

```ts type-equiv
/** Secret-free scalar value carried by a runtime fact. */
type RuntimeFactValue = string | boolean | number
```

An observation distinguishes a returned value, an unregistered key, ordinary source absence, and a contained probe failure. Consumers can therefore retry failures without treating unsupported facts as errors.

```ts type-equiv
/** Result of observing one runtime fact. */
type RuntimeFactObservationResult<T extends RuntimeFactValue = RuntimeFactValue> =
  | { readonly status: 'ok'; readonly value: T }
  | { readonly status: 'unknown' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'probe-failure'; readonly reason?: string }
```

## Three independent declaration dimensions

Evaluation controls resolver timing, freshness controls reuse, and exposure controls automatic projection. These dimensions are independent: for example, a synchronous dynamic inspect fact is valid, while an asynchronous baseline declaration remains inspect-only in practice because prompt assembly never awaits fact resolvers.

```ts type-equiv
/** Whether a fact resolver completes synchronously or asynchronously. */
type RuntimeFactEvaluation = 'sync' | 'async'
```

```ts type-equiv
/** Whether one observation may be reused for the registration lifetime. */
type RuntimeFactFreshness = 'static' | 'dynamic'
```

```ts type-equiv
/** Whether a fact may enter automatic context or only explicit inspection. */
type RuntimeFactExposure = 'baseline' | 'inspect'
```

```ts type-equiv
/** Per-observation scope and cancellation input. */
interface RuntimeFactContext {
  readonly scope?: ScopeKey
  readonly signal?: AbortSignal
}
```

```ts type-equiv
/** Tool visibility required before a baseline fact is projected. */
interface RuntimeFactRelevance {
  readonly tools: readonly string[]
}
```

```ts type-equiv
/** One owned runtime fact declaration. */
interface RuntimeFact {
  readonly key: RuntimeFactKey
  readonly owner: string
  readonly description: string
  readonly evaluation: RuntimeFactEvaluation
  readonly freshness: RuntimeFactFreshness
  readonly exposure: RuntimeFactExposure
  readonly relevance?: RuntimeFactRelevance
  readonly resolveSync?: (context: RuntimeFactContext) => RuntimeFactValue | undefined
  readonly resolveAsync?: (
    context: RuntimeFactContext,
    signal?: AbortSignal,
  ) => Promise<RuntimeFactValue | undefined>
}
```

`list()` removes executable resolvers but preserves all policy metadata:

```ts type-equiv
/** Resolver-free metadata returned by the registry. */
interface RuntimeFactInfo {
  readonly key: RuntimeFactKey
  readonly owner: string
  readonly description: string
  readonly evaluation: RuntimeFactEvaluation
  readonly freshness: RuntimeFactFreshness
  readonly exposure: RuntimeFactExposure
  readonly relevance?: RuntimeFactRelevance
}
```

## Registry and lifecycle

One active owner may register each key. Registration validates resolver exclusivity and relevance names before installing an effect; duplicate ownership fails loud. Disposing the owner removes the declaration and its cache. Static synchronous facts are observed at registration; a static asynchronous fact shares its first inspection result only when the inspection carries no scope or cancellation signal — a scoped or cancellable inspection probes independently so one caller cannot poison or cancel another's registration-lifetime cache — and a transient probe failure is never retained, so a later inspection can recover; dynamic facts resolve on every observation.

`list()` exposes metadata without resolver functions. `inspect()` contains each resolver independently and returns all requested statuses. `render()` considers only synchronous baseline facts, applies tool relevance centrally through `ctx.tools` for the supplied scope, sorts available rows by key, and returns no text when none applies.

## Host provider

The Host provider registers `runtime.execution-world` as its only baseline fact. It keeps OS, architecture, PID, sanitized proxy metadata, and the current bound Web-server URL inspect-only. Process constants and the launch-environment proxy snapshot are static; execution world and Web URL are dynamic because their Service Providers may hot-load. The [subprocess subsystem](subprocess.md) owns the authoritative local/remote classification.

## Runtime-context projection

The registry contributes the order-120 `runtime-facts` context through `ctx.systemPrompt`. Prompt assembly evaluates no asynchronous probe. Available rows render in a stable fragment whose complete model-visible wrapper is owned by the [system-prompt subsystem](system-prompt.md). The agent loop records a changed fragment as a sourced replacement runtime-context snapshot, so model-visible facts remain reconstructable from the Session log.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxruntimefacts--runtimefacts"></a>

### `ctx.runtimeFacts` — `RuntimeFacts`

Registry for uniquely owned runtime facts.

```ts cordis-catalog
/**
 * Register one uniquely owned fact for the calling plugin fiber.
 * @param declaration - resolver, ownership, projection, and freshness declaration.
 * @returns the exact effect disposer that removes the fact and its cached observation.
 * @throws when the declaration is malformed or its key already has an owner.
 */
registerFact(declaration: RuntimeFact): () => Promise<void>

/**
 * List resolver-free fact declarations in code-unit key order.
 * @returns detached metadata that callers may not use to mutate a registration.
 */
list(): RuntimeFactInfo[]

/**
 * Observe selected facts, awaiting asynchronous resolvers while containing each failure.
 * @param keys - valid fact keys; an unregistered key produces `unknown`.
 * @param context - optional scope and cancellation signal.
 * @returns one observation per requested key.
 */
async inspect( keys: readonly RuntimeFactKey[], context: RuntimeFactContext = {}, ): Promise<Record<string, RuntimeFactObservationResult>>

/**
 * Render available synchronous baseline facts in code-unit key order.
 * @param context - scope used for centralized tool-relevance filtering.
 * @returns the complete compact snapshot, or an empty string when none is active.
 */
render(context: RuntimeFactContext): string
```

Source: [`packages/context/runtime-facts/src/index.ts`](../../packages/context/runtime-facts/src/index.ts)
<!-- END GENERATED cordis-surface -->
