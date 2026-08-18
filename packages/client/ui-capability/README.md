# Client UI Capability

The Capability module's browser surface: the sidebar's first-level Capability
navigation entry (directly above the Queue entry) with a count badge, and the
center-column read-only Capability workspace over the `capabilityRegistry`
Remote.

The workspace answers one question at a glance: what Skills, MCP servers, and
Tools does the current Harness expose to the agent. It is a **read-only
projection** — no CRUD, no policy editing, no connection control. Three tabs
(Skills / MCP Servers / Tools) render from a single snapshot, with a search box,
summary cards, and a per-row detail drawer.

## Shell contracts

- `sidebar.modules` — the navigation entry (`id: capability-module`, `order: 5`),
  registered into the sidebar shell's module seat directly above the Queue
  module (`order: 10`). The badge (`nav.badge`) shows the combined count
  (`N skills + M tools`) or `0` while loading/failed.
- `shell.view` — the center-column module view (`id: capability`), rendered by
  the frame's module ring while the `capability` module is active. The
  conversation stays mounted underneath, so switching back loses nothing.

## Data flow

One `CapabilityStore` (snapshot/subscribe) serves both entries. On the current
session it calls `ctx.remote.capabilityRegistry.list({ sessionId })`, caching the
host projection with a generation guard so a stale response never overwrites a
newer load. The store exposes `load` / `retry` / `reset`; the view renders
`status: loading | ready | error`. A missing Remote namespace falls back to an
explicit `{ ok: false }` error so the UI shows "failed to read capabilities"
with a retry rather than silently rendering empty data.

## Read-only contract

The host `CapabilityRegistryGateway` mirrors three live registries and returns
only projection fields:

- **Skills** from `ctx.skills.managementSnapshot({ scope })` for the viewing
  session's scope — name, description, invocation policy, source/provider, path,
  origin, and selection state.
- **Tools** from `ctx.tools.schemas(scope)` — public name and description, with
  MCP-bridged tools (`mcp__<serverName>__<rawName>`) tagged with their server.
- **MCP servers** from Loader entries whose module is `@deepseek-ai/dsh-mcp-client` —
  configured `serverName`, `transport`, and the count of tools currently
  registered under that namespace.

MCP env, headers, command, and args are never returned to the browser.

## Model Experience

The Capability view is a client-only presentation surface with no model-visible
token cost and no language-model calls. Loading one snapshot reads the live
Skill, Tool, and Loader registries on the host (small, bounded projections);
there is no model inference, token consumption, or KV-cache effect.

## Known limits

- No forwarded `capability/*` refresh events yet: the store loads on mount and
  on session change, with a manual retry; there is no live push when the host
  registries change under an open view.
- Skills and Tools are **scope-aware**: the projection resolves the current
  session's scope. For a session whose preset has not mounted (no live agent),
  it falls back to the global layer, which may show fewer — or zero — entries.
- MCP status is confined to what the runtime can prove: configured server +
  registered tool count. Connection lifecycle (connected / reconnecting / last
  sync) is internal to the MCP client supervisor and is not exposed; a host with
  no configured `mcp-client` rows truthfully shows 0 servers.
- Invalid-skill diagnostics are not surfaced; the view shows whatever the skill
  registry reports at runtime.
