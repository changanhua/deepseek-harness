# `@deepseek-ai/dsh-tool-runtime-inspect`

English | [中文](README.zh.md)

`runtime_inspect` is the model-facing consumer of DSH's authoritative runtime state. It does not discover host facts itself: fact queries delegate to `ctx.runtimeFacts`, while command resolution delegates to `ctx.subprocess.resolveExecutable()` and reports that same subprocess provider's `executionWorld`.

## Tool contract

The tool has two tagged request variants:

```json
{ "kind": "facts", "keys": ["host.os", "web-search.exa.credential-configured"] }
```

Omit `keys` to inspect every currently registered runtime fact. The returned object preserves each registry observation state (`ok`, `unknown`, `unavailable`, or `probe-failure`), and async inspect-only facts are awaited. Caller cancellation is forwarded to the registry.

```json
{ "kind": "command", "command": "codex" }
```

Command inspection calls only `ctx.subprocess.resolveExecutable(command, undefined, signal)`. Success returns `{ "resolved": "...", "world": "local|remote" }`; failure returns a stable `{ "status": "unavailable", "reason": "..." }` without forwarding arbitrary provider diagnostics. Cancellation remains cancellation rather than being converted into an availability answer.

The schema forbids fields from the other variant and arbitrary extra fields. The command variant deliberately has no `env` argument: the tool must not become a route for injecting or echoing credential-bearing environment values.

## Ownership and security

- Runtime fact values come only from registered fact owners; this package neither re-probes nor overrides them.
- Executable resolution comes only from the active subprocess provider; this package never reads `PATH`, checks the filesystem, or invokes a shell independently.
- `world` comes from `ctx.subprocess.executionWorld`.
- Credential values are not queried. Provider credential facts expose only safe derived state such as `credential-configured`.
- Command-resolution exceptions are not returned verbatim because provider diagnostics can contain deployment details.

## Model Experience

The package registers one stable `runtime_inspect` tool schema and one stable prompt section telling the model to prefer authoritative runtime facts over inference. Dynamic host values do not enter the stable section; baseline values continue to arrive through `@deepseek-ai/dsh-runtime-facts`, while long-tail values appear only after a tool call.

#### KV Cache effect

The tool schema and prompt guidance are stable for the plugin lifetime, so runtime value changes do not themselves invalidate the stable request prefix. A `runtime_inspect` result is ordinary turn content and therefore affects only the conversation after that call.

## Known Limitations and Deferred Work

- V1 supports only registered facts and executable resolution. It is not a Doctor, provider-readiness framework, network scanner, or generic process inspector.
- V1 does not pre-register per-command facts and does not expose raw environment, proxy URLs, credential values, or subprocess-provider exception text.
- Richer execution-world descriptions and automatic network reachability probes remain deferred by the Runtime Awareness design.
