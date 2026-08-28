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

### `runtime_inspect` tool

#### What the model sees

The package contributes no separate system-prompt section; usage guidance stays in the tool description. The model sees one `runtime_inspect` tool with a tagged `kind: "facts" | "command"` request: `facts` accepts optional `keys`, while `command` requires one `command` string and exposes no `env` field.

#### Token effect

Fixed tool-definition cost per request while the plugin is visible; fact keys and resolved command paths are not enumerated in the definition.

#### KV Cache effect

Prefix-stable while the tool definition and scope visibility are unchanged; plugin lifecycle or scoped tool restrictions may change the tool projection.

### Inspection results

#### What the model sees

A facts call returns per-key structured observations (`ok`, `unknown`, `unavailable`, or `probe-failure`); a successful command call returns `{ "resolved": "...", "world": "local|remote" }`, while an unresolved command returns a stable secret-free `unavailable` result. Provider exception text and credential values are not rendered.

#### Token effect

Result cost is data-dependent: a facts call grows with the requested or registered key set, while a command call returns one bounded record. Retained calls and results remain in conversation history until compaction.

#### KV Cache effect

Append-only; newly returned inspection content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- V1 supports only registered facts and executable resolution. It is not a Doctor, provider-readiness framework, network scanner, or generic process inspector.
- V1 does not pre-register per-command facts and does not expose raw environment, proxy URLs, credential values, or subprocess-provider exception text.
- Richer execution-world descriptions and automatic network reachability probes remain deferred by the Runtime Awareness design.
