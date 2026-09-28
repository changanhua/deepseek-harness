---
description: "Expose selected DSH native tools through an authenticated loopback MCP endpoint while loading only the preset each call needs."
kind: "package-reference"
---

# @changanhua/dsh-mcp-server

English | [中文](README.zh.md)

## Summary

This package lets a local MCP client call selected DSH tools without starting every agent preset at Host boot. It publishes a fixed capability catalog, loads the called tool's preset on first use, and returns a bounded structured result with a DSH receipt. Choose it when one DSH Host is the tool owner and an external MCP client needs a controlled subset. It is loopback-only and requires a configured bearer token.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it in a Host composition that already provides the web server, agent factory, session store, tool runtime, Loader, and agent-presets service.

### Capability catalog and configuration

Each `catalog` row names one trusted declaration module and its owning preset. The declaration exports `describe(options)` and returns the tool name, description, object-root input schema, and output schema. Discovery imports declarations but does not mount a preset or create an agent.

```yaml
- id: local-capabilities
  name: '@changanhua/dsh-mcp-server'
  config:
    path: /mcp
    tokenEnv: DSH_CAPABILITIES_TOKEN
    workspace: C:/work/project
    catalog:
      - preset: selector
        declaration: ./capabilities/select.declaration.js
        options: {}
    requestMaxBytes: 65536
    resultMaxBytes: 65536
    callTimeoutMs: 30000
    maxPendingCalls: 8
```

`path`, `tokenEnv`, `workspace`, every limit, and `catalog` are required. The web server must listen on `127.0.0.1`; the package rejects another bind address, a missing or empty token environment variable, a relative workspace, and an invalid route. The generated [configuration catalog](../../../docs/config-catalog.md#changanhuadsh-mcp-server) is the exhaustive field reference.

### Calling and recovery

The endpoint accepts authenticated, origin-less `POST` requests only. Every request creates a stateless MCP exchange; invalid credentials return `401`, a supplied `Origin` returns `403`, and other methods return `405`. `tools/list` exposes `dsh_capabilities` plus the fixed catalog. Calling `dsh_capabilities` reports each capability's unloaded, loading, ready, or failed state without activating it.

An ordinary call waits for the target preset's shared standing mount, creates one fresh real DSH Agent, verifies the loaded native tool still matches the declared metadata, and executes it through `ToolRuntime`. The Agent receives a call-specific guard, so sibling tools cannot run. The session records `mcp/invocation-start` and `mcp/invocation-end`, flushes before the receipt returns, and contains no model request, turn, step, or assistant event.

The call receipt contains a session id, call id, preset id, and elapsed time. Callers must treat an `unknown` terminal state as uncertain and must not automatically replay it. Cancellation and timeout are cooperative: they stop admission and propagate a signal, but a tool that has begun work must settle before its result is known.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The catalog is immutable after Host activation. A per-preset single-flight load prevents concurrent first callers from mounting duplicate compositions; a failed mount clears that load so a later repaired configuration can retry. Calls for one preset serialize after loading, while different presets can load independently.

The endpoint converts only JSON values and text content blocks into MCP results. It measures the complete MCP response before persisting the terminal value. An oversized, rich, or failed result becomes a bounded error receipt; the terminal event stores `null` instead of a rejected value. Host disposal stops admission, aborts active calls, closes exchanges and incomplete HTTP requests, then waits for owned work to settle.

No runtime invariant companion is published. `dsh_capabilities` is an asynchronous runtime observation: its state can change after it is read and before a separate call mounts a preset. A static invariant could not prove that observation equals a later mount, so an empty reporter would add no check.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent presets](../../preset/agent-presets/README.md) — standing preset composition and scope ownership.
- [Tool runtime](../../core/tools/README.md) — tool policy, output validation, and cancellation.
- [MCP client](../mcp-client/README.md) — DSH consuming external MCP tools.
- [Session persistence](../../session/session-persistence/README.md) — durable session ownership.

-----

<a id="model-experience"></a>
## Model Experience

### External MCP catalog

#### What the model sees

The external MCP client receives configured capability names, descriptions, input schemas, and `dsh_capabilities`. The package does not create a DSH model request or add prompt text.

#### Token effect

The external client decides whether and how its discovered tools enter its model context. This package returns only the called tool's bounded text and structured result.

#### KV Cache effect

None in DSH. External-client cache behavior is outside this package; a changed capability catalog can change that client's tool prefix.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Native tools only** — a preset exposing `run_code` is rejected; external calls do not enter PTC mode.
- **Passive presets only** — the preset must be safe to mount without a model turn or user input. A preset that starts background work, requires an interactive channel, or treats mount as an agent task is not a capability binding.
- **No automatic replay** — timeout, disconnect, and cancellation can leave a sent operation unknown.
- **Text and JSON only** — non-text content blocks return a bounded `UNSUPPORTED_CONTENT` error.
- **No turn control** — additional model context and turn-completion signals return `UNSUPPORTED_EXECUTION_SEMANTICS`; an external tool call has no model turn to update.
- **One local Host** — this release supports one authenticated loopback Streamable HTTP endpoint, without remote listeners, stdio transport, Resources, Prompts, or long-running task control.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
