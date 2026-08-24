# @deepseek-ai/dsh-runtime-facts

English | [中文](README.zh.md)

Owned registry for secret-free scalar facts about the active Harness runtime. Providers register one fact key each; consumers list declarations, inspect selected values, or render the synchronous baseline into dynamic runtime context. The registry does not discover capabilities or probe the host by itself. Decision record: [the runtime-facts Agent Note](../../../.agents/notes/implemented/architecture/2026-08-23-runtime-facts-registry.md).

## Config

```yaml
- id: runtime-facts
  name: '@deepseek-ai/dsh-runtime-facts'
  config:
    includeInRuntimeContext: true
```

`includeInRuntimeContext` defaults to `true`. Setting it to `false` disables this package's automatic baseline contribution without disabling registration, listing, or inspection.

## Registration and ownership

`ctx.runtimeFacts.registerFact(declaration)` validates the complete declaration, reserves its dotted lowercase kebab-case key for one owner, and returns the exact effect disposer. Duplicate ownership fails during registration. Disposal removes the declaration and its cached observation.

Each declaration has three independent dimensions:

| Dimension | Values | Meaning |
|---|---|---|
| `evaluation` | `sync`, `async` | Which resolver form is required; asynchronous facts are inspect-only at evaluation time. |
| `freshness` | `static`, `dynamic` | Static facts are observed once for the registration lifetime; dynamic facts are evaluated on every observation. |
| `exposure` | `baseline`, `inspect` | Baseline facts may enter automatic context; inspect facts require an explicit consumer. |

Values are finite numbers, booleans, or single-line strings. A provider owns the stronger obligation that values and diagnostics contain no secret. A synchronous resolver failure is logged and treated as unavailable. An asynchronous rejection or abort is contained as `probe-failure`; one failed fact does not reject an inspection of other keys.

## Baseline projection

The registry contributes `systemPrompt.context({ name: 'runtime-facts', order: 120, ... })`. Every assembly evaluates only synchronous baseline facts, orders them by key using JavaScript code-unit order, omits unavailable values, and returns an empty string when nothing applies. Asynchronous resolvers are never started from prompt assembly.

A declaration may require visible tool names through `relevance.tools`. The registry evaluates those names centrally against `ctx.tools` for the assembly scope. Missing scope, missing tool service, or any hidden required tool suppresses that fact without changing its value.

## Inspection

`list()` returns resolver-free metadata in key order. `inspect(keys, context?)` returns one result per requested key: `ok`, `unknown`, `unavailable`, or `probe-failure`. Static asynchronous observations share the first in-flight probe and cache its result; dynamic observations run again. The registry provides no model tool itself; a consumer decides how inspection is authorized and presented.

The generated [`ctx.runtimeFacts` service catalog](../../../docs/subsystems/runtime-facts.md#ctxruntimefacts--runtimefacts) owns the method signatures.

## Model Experience

### Synchronous baseline snapshot

#### What the model sees

When at least one synchronous baseline fact is available and relevant, this package contributes the fragment below inside the system-prompt service's sourced runtime-context snapshot. `<key>` rows are sorted and absent values are omitted.

##### Runtime-facts fragment

```markdown
Host runtime facts:
- <key>: <scalar-value>
```

#### Token effect

Conditional. The current fragment remains model-visible while active; identical assemblies add no replacement snapshot. Evaluation is synchronous and adds no probe latency.

#### KV Cache effect

Prefix-stable while the rendered rows remain identical. A changed row causes the runtime-context projection to replace its active snapshot and may invalidate reuse from the first changed context token.

## Known Limitations and Deferred Work

- **Scalar declarations do not prove secrecy** — the registry rejects non-scalar and multiline results, but each provider must sanitize identifiers and diagnostics before registration.
- **No automatic asynchronous facts** — network, credential, and other asynchronous probes require explicit inspection and never delay prompt assembly.
- **No expiry policy** — a static observation lasts until its registration is disposed; providers must declare hot-loadable service state as dynamic.
- **No built-in model tool** — this package supplies the service and baseline projection only; inspection needs a separately authorized consumer.
