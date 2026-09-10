---
description: "The MCP package group: attach external Model Context Protocol servers so their tools are callable as native tools."
kind: "package-group"
---

# MCP — Model Context Protocol

English | [中文](README.zh.md)

## Summary

The `mcp/` group connects the harness to the Model Context Protocol (MCP) ecosystem. One package attaches external tool servers to a DSH model; the other gives an external Codex client a run-bound control view of an isolated DSH Host. Both directions are explicit profile composition, and neither exposes MCP resources or prompts. This page maps the group; each package README owns its contract.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The group holds two packages; their READMEs own the details.

| Package | What it provides |
|---|---|
| [`control-mcp/`](control-mcp/README.md) | Observe and drive one isolated DSH validation run through a bounded local stdio MCP server |
| [`mcp-client/`](mcp-client/README.md) | Attach one external MCP server so the model can call its tools as native tools |

-----

<a id="related-documentation"></a>
## Related documentation

Try the worked example configurations to see the plugin in action, then read the Agent Notes for the behavior decisions behind it.

- [MCP client plugin Agent Note](../../.agents/notes/implemented/feature/2026-07-07-mcp-client-plugin.md) — the bridge's design: server-qualified naming, discovery, execution, and environment scrubbing.
- [MCP client auto-reconnect Agent Note](../../.agents/notes/implemented/feature/2026-08-06-mcp-client-auto-reconnect.md) — the reconnect policy, the per-outage attempt budget, and the opt-out.
- [Run-bound DSH control MCP Agent Note](../../.agents/notes/implemented/feature/2026-09-10-run-bound-dsh-control-mcp.md) — the local verifier boundary, identity fences, and rejected generic server alternatives.
- [Third-party memory MCP examples Agent Note](../../.agents/notes/implemented/feature/2026-07-31-third-party-memory-mcp-examples.md) — three default-off memory-server overlays delivered as reference configurations.
- [Third-party memory MCP guide](../../docs/user/guide/mcp-memory.md) — runnable overlay rows and setup instructions.
- [Tools subsystem reference](../../docs/subsystems/tools.md) — the `ToolRuntime` that receives the registered tools.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
