# MCP capability endpoint

English | [中文](mcp.zh.md)

The MCP subsystem has two directions. [`mcp-client`](../../packages/mcp/mcp-client/README.md) consumes external MCP tool servers and registers their tools in DSH. [`dsh-mcp-server`](../../packages/mcp/mcp-server/README.md) exposes a fixed DSH capability catalog to local MCP clients. The server binds each declared tool to a lazy agent preset; discovery does not mount it, while a call creates a fresh real Agent and runs the native tool pipeline.

The capability endpoint is loopback-only, bearer-authenticated, origin-less Streamable HTTP. It exposes tools and `dsh_capabilities`; it does not bridge Resources or Prompts. Its declaration digest prevents a loaded tool from silently diverging from its published schema. Each call writes and flushes `mcp/invocation-start` plus `mcp/invocation-end`; a terminal `unknown` result is not replayable.

The endpoint accepts only native, passive presets. A PTC presentation, non-text content, additional model context, or turn completion returns a bounded failure. The [capabilities bundle](../../packages/bundle/capabilities/README.md) supplies a standalone Profile with two bindings: bounded candidate choice and local filesystem globbing.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmcpserver--mcpserver"></a>

### `ctx.mcpServer` — `McpServer`

One Host-owned MCP endpoint; each stateless HTTP exchange owns its SDK transport.

Source: [`packages/mcp/mcp-server/src/index.ts`](../../packages/mcp/mcp-server/src/index.ts)
<!-- END GENERATED cordis-surface -->
