# @deepseek-ai/dsh-host-capability-registry

English | [中文](README.zh.md)

Read-only Host projection of the current capability surface: Skills, Tools, and MCP server entries. `CapabilityRegistryGateway` registers the `capabilityRegistry` service and publishes one generated direct Remote, `capabilityRegistry/list`. Every call reads the live Loader entries, the skill registry's management snapshot, and the tool registry's schemas directly — no cache, history, or mutation path.

The skill projection mirrors `ctx.skills.managementSnapshot()` for the viewing session's scope, including each candidate's name, description, invocation policy, source, provider, path, origin, and selection state. The tool projection mirrors `ctx.tools.schemas()`, tagging MCP-bridged tools (`mcp__<serverName>__<rawName>`) with their server and raw MCP name. The MCP server projection reads Loader entries whose module is `@deepseek-ai/dsh-mcp-client`, exposing only the configured `serverName`, `transport`, and the count of tools currently registered under that server's namespace.

MCP connection lifecycle state (connected, reconnecting, last sync) is internal to the MCP client supervisor and is not exposed. MCP environment variables, headers, command, arguments, and working directory are never returned to the client. Its public payload types live under `./types`, and Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

The service is Remote-only and declares no same-process Cordis `Context` merge. Client packages consume it through the explicit [`api-remotes`](../../api/remotes/README.md) assembly.

## Model Experience

None, as this Host-only capability projection registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **MCP connection state is not observable** — the MCP client connection supervisor owns connection/reconnect state as private closure variables with no read interface; the projection can prove a server is configured and count its registered tools, not that it is connected.
- **Point-in-time state only** — the result contains no durable failure history or subscription; a server with zero registered tools may be connecting, reconnecting, or exhausted.
- **No invalid-skill diagnostics projection** — skills discarded before registry entry are not surfaced; only runtime-known candidates appear.
