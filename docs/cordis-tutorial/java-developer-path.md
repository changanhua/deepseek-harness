# Java Developer Path

English | [中文](java-developer-path.zh.md)

This page is an orientation guide for Java developers who know dependency injection, interfaces, callbacks, and ordinary application lifecycle management but have not used DeepSeek Harness before. It gives you the runtime model first; the numbered Cordis chapters then let you build the same ideas in a scratch directory.

This page is not a runnable chapter. Start here if you want the shortest route to the project vocabulary, then continue with [Your first plugin](01-first-plugin.md).

## What you will understand

After this page, you should be able to follow one request through the harness, locate the service or package that owns each part, and choose the correct extension point for a new capability.

The main request path is:

```text
dsh entry
  -> Profile
  -> Bundle and Patch layers
  -> Agent
  -> Turn
  -> Step
  -> Prompt and Tool schemas
  -> LLM
  -> Tool execution
  -> SessionEvent log
  -> next Step or Turn end
```

The [architecture reference](../architecture.md) owns the complete composition and event map; this page only gives you the order in which to read it.

## Java-to-Harness map

These are useful first approximations, not replacement definitions.

| Harness concept | First Java approximation | Important difference |
| --- | --- | --- |
| Cordis Context | Spring `ApplicationContext` | It also owns typed events, scopes, and reversible plugin effects. |
| Plugin | Spring configuration module plus lifecycle hooks | The model adapter, Session log, and Agent loop are plugins too. |
| `ctx.foo` service | An injected service | The service has an explicit Definition, Provider, and Consumer relationship. |
| `ctx.effect()` / `ctx.on()` | Resource registration and event subscription | Registrations and listeners unwind with the owning plugin. |
| Agent | A live runtime object that drives work | It owns an inbox, a Session, and an Agent-scoped context. |
| Session | An event-sourced stream | It is not a JPA entity; model history is derived from its append-only events. |
| Turn | One admitted conversation cycle | A Turn can contain several Steps. |
| Step | One model request plus its tool calls | Tool execution and the resulting durable records belong to the Step. |
| Tool | A model-callable function endpoint | It includes a schema, policy pipeline, execution, rendering, and result recording. |
| Scope | An Agent-local child context | It controls visibility and lifetime for scoped contributions; it is not arbitrary nested DI. |
| Profile / Bundle / Patch | Deployment composition | They select and override plugin rows rather than representing business entities. |
| MCP | An adapter for external tools | The MCP client discovers external tools and registers them on `ctx.tools`. |
| Skill | A loadable instruction package | A Skill supplies instructions and resource guidance; it is not a Tool. |

For the precise definitions, use the [subsystem index](../subsystems/README.md) and the package README that owns the capability.

## Follow this reading order

1. Read [Architecture](../architecture.md) through Cordis, Profiles and bundles, Core packages, Events, Turn flow, and Session log.
2. Read [Core](../subsystems/core.md) for Agent ownership, inbox delivery, cancellation, and the Agent-to-Session relationship.
3. Read [Session](../subsystems/session.md) and [Session Persistence](../subsystems/persistence.md) to see why the event log is authoritative and how JSONL and SQLite make it durable.
4. Read [Tools](../subsystems/tools.md) and the [tool execution pipeline](../tool-execution-pipeline.md) to connect model schemas, policy checks, execution, and results.
5. Read [Skills](../subsystems/skills.md), the [Skill tool README](../../packages/skill/tool-skill/README.md), and the [MCP client README](../../packages/mcp/mcp-client/README.md) to distinguish instructions from external tools.
6. Work through [Your first plugin](01-first-plugin.md) and [Into the harness](07-into-the-harness.md), then compare your small composition with [headless-agent](../../examples/headless-agent/composition.md).

Do not start with the complete module graph or event producer/consumer table. Return to the [documentation graph index](../graph-atlas.md) after the request path is familiar.

## Use this template while reading code

For every unfamiliar package, answer these five questions:

- What problem does this package solve for a consumer?
- Which service, provider, consumer, event, or tool does it own?
- What is the smallest real entry point in `src/` or the package README?
- What is durable, what is live-only, and what is derived?
- Which focused test or runtime composition verifies the behavior?

The package README is the consumer contract. The subsystem page owns shared types and service or event semantics. The architecture page explains how the package participates in the runtime. Generated catalogs own exhaustive inventories; do not reconstruct those inventories by hand.

## Keep these distinctions

| Do not collapse | Read it as |
| --- | --- |
| Session and entity | Session is an append-only source of facts; projections provide read models. |
| Tool and Skill | A Tool performs an operation; a Skill supplies instructions for performing work. |
| MCP and storage | MCP may connect a server that owns its own data, but DSH only bridges its tools. |
| Live Agent events and Session events | Agent events observe work in flight; Session events survive reload and replay. |
| Cache and authority | A projection cache accelerates a fold; the Session log remains authoritative. |

The [Session Persistence](../subsystems/persistence.md) and [projection cache README](../../packages/session/session-projection-cache/README.md) describe these durability rules in detail.

## Continue with implementation

To add a model-facing capability, start with [Build a tool](../user/develop/basic/tool.md). To add a replaceable platform capability, read [Capability layering](../user/develop/practice/index.md). To understand all available services and events, use the [subsystem pages](../subsystems/README.md) rather than extending this orientation page.

When a design choice is not established by current code, tests, or a package contract, record it as a proposal or Agent Note instead of presenting it as current architecture.
