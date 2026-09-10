---
description: "Run-bound local MCP control for Codex clients that need to observe and drive an isolated DSH Host without exposing general process authority."
kind: "package-bundle"
---

# @changanhua/dsh-control-mcp

English | [中文](README.zh.md)

## Summary

The `control-mcp` profile gives a local Codex client a small stdio MCP interface for one isolated DSH validation run. By default the connector starts and owns the child Web Host, including its temporary Harness home; `dsh_control_close` or connector shutdown stops and cleans that child. A separate opt-in Host patch exposes authenticated Session, Dynamic Cordis, and browser observations through the existing Connection transport. The connector accepts only an HTTP loopback origin and exchanges the Host launch token for its signed cookie before it sends control requests. The package does not expose arbitrary shell, Node.js, filesystem, Cordis source, or acceptance authority.

## Table of Contents

- [Use this package](#use-this-package)
- [Control contract](#control-contract)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Start an isolated Host

Build the current checkout. The connector normally starts the target Web Host itself with the opt-in patch and a temporary isolated Harness home.

```powershell
$env:DSH_CONTROL_HOST_HOME = 'C:\path\to\prepared-isolated-host-home'
pnpm dsh --profile control-mcp
```

When `DSH_CONTROL_HOST_HOME` is omitted, a temporary home is created and removed when the run ends. Do not point this patch at an ordinary production profile: the run binding is a validation boundary, not a general remote administration API.

### Start the stdio connector

For an already running Host, set `DSH_CONTROL_AUTOSTART=false` and pass its origin, token and run id. This compatibility mode is useful for diagnostics; Codex normally uses the automatic lifecycle above.

```powershell
$env:DSH_CONTROL_AUTOSTART = 'false'
$env:DSH_CONTROL_ORIGIN = 'http://127.0.0.1:52044'
$env:DSH_CONTROL_TOKEN = '<token printed by the isolated Host>'
$env:DSH_CONTROL_RUN_ID = 'validation-run-1'
pnpm dsh --profile control-mcp
```

An MCP client normally owns this process and its stdio. `dsh --profile control-mcp --help` checks profile composition without claiming the protocol stream.

### What you get

The connector exposes eleven tools: Host close; Session open, prompt, wait, and event reads; source-free Dynamic Cordis inspection; browser installation, tab, snapshot, and entry-selector inspection; and a structured evidence export. `dsh_browser_snapshot` returns page facts without choosing a selector. `dsh_browser_entry_inspect` accepts a candidate selector only after a successful snapshot and supplies the page identity from that stored observation.

-----

<a id="control-contract"></a>
## Control contract

### Identity and authority

Every request carries the configured `runId`. The first successful `dsh_session_open` binds the Host adapter to one Session. Browser access then binds one installation selected from the latest `dsh_browser_instances` result, and snapshots accept only tabs from the latest `dsh_browser_tabs` observation. A page operation cannot provide its own document identity; entry inspection uses the latest successful snapshot's page object.

### Writes, waits, and evidence

`dsh_session_open` and `dsh_session_prompt` require caller-minted `requestId` values. The Host retains up to `maxWriteReceipts` idempotent write results, with a default of 256, and rejects a new write when that fixed capacity is full. Read, write, and wait operations are counted separately. `dsh_evidence_export` returns bounded Host-observed JSON in the MCP result; it does not write an arbitrary path and does not declare acceptance.

### Authentication and recovery

The connector performs the launch-token exchange with redirects disabled, retains only the returned cookie pair, and sends no token on the control request URL. One HTTP 401 clears the cookie and attempts the exchange once. A new Host process has a new launch token, so restart the connector with the new token after a Host restart.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`cordis.patch.yml`](cordis.patch.yml) is the complete startup-only `control-mcp` application: one command-line owner and one stdio server. [`host.cordis.patch.yml`](host.cordis.patch.yml) is an explicit Web-profile overlay that mounts the Host adapter. The Host adapter registers a dedicated authenticated Connection RPC channel, while the stdio half maps fixed MCP schemas onto that channel. [`src/control-plane.ts`](src/control-plane.ts) owns run binding, idempotency, browser observation fences, operation counts, and evidence assembly.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [MCP package group](../README.md) — the consuming and serving MCP directions.
- [Application composition](../../../docs/architecture.md) — profile and bundle ownership.
- [Session subsystem](../../../docs/subsystems/session.md) — durable events returned by Session reads and evidence export.
- [MCP client decision](../../../.agents/notes/implemented/feature/2026-07-07-mcp-client-plugin.md) — why consuming arbitrary MCP servers remains a separate package.

-----

<a id="model-experience"></a>
## Model Experience

### External MCP control tools

#### What the model sees

An attached MCP client sees ten fixed `dsh_*` tool schemas and their JSON results. Page text and DOM facts returned by browser tools are untrusted data; no tool result grants new authority or certifies success.

#### Token effect

The ten tool schemas add a fixed context cost to the external MCP client. Tool results add data-dependent tokens bounded by the Session event limit, browser provider limits, and the evidence held for one run. This package adds no prompt or tool tokens to the DSH model running inside the target Session.

#### KV Cache effect

The tool list is stable for a fixed package version and can remain in a reusable external-client prefix. Tool calls and results append after that prefix; changing schemas or the external client's MCP assembly invalidates reuse according to that client and provider.

## Known Limitations and Deferred Work

- **Browser capability is an optional runtime dependency** — browser tools return a structured error when the target Host has no `browser` service. Full browser runtime acceptance belongs to the integration with the independently developed browser page model.
- **The channel is local and run-scoped** — only stdio MCP plus an HTTP loopback Host is supported. There is no shared HTTP MCP server, discovery registry, or multi-Host routing.
- **Cordis control is read-only** — the package reports source-free lifecycle state but does not define, run, update, or stop Dynamic Cordis packages.
- **Evidence is observation, not judgment** — external acceptance must still compare the exported facts with an independently frozen verifier plan.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
