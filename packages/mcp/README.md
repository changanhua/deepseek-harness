---
description: "The MCP package group: connect Harness to external Model Context Protocol servers and expose bounded Harness capabilities to MCP clients."
kind: "package-group"
---

# MCP — Model Context Protocol

English | [中文](README.zh.md)

## Summary

The `mcp/` group connects Harness to the Model Context Protocol in both directions. Client packages attach external tool servers; gateway packages expose bounded capabilities from one running Harness Host without starting another Host.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The group includes clients, a local capability server, and a Host gateway; their READMEs own the details.

| Package | What it provides |
|---|---|
| [`mcp-gateway/`](mcp-gateway/README.md) | Expose the Host's existing Planning provider through a fixed-Workspace MCP endpoint |
| [`mcp-client/`](mcp-client/README.md) | Attach one external MCP server so the model can call its tools as native tools |
| [`mcp-server/`](mcp-server/README.md) | Expose declared DSH native tools to local MCP clients through lazy presets |

-----

<a id="related-documentation"></a>
## Related documentation

Try the worked example configurations to see the plugin in action, then read the Agent Note for the behavior decisions behind it.

- [MCP client plugin Agent Note](../../.agents/notes/implemented/feature/2026-07-07-mcp-client-plugin.md) — the bridge's design: server-qualified naming, discovery, execution, and environment scrubbing.
- [Third-party memory MCP guide](../../docs/user/guide/mcp-memory.md) — runnable overlay rows and setup instructions.
- [Tools subsystem reference](../../docs/subsystems/tools.md) — the `ToolRuntime` that receives the registered tools.
- [MCP subsystem reference](../../docs/subsystems/mcp.md) — client consumption and local capability exposure.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
