---
description: "A fixed-Workspace Planning MCP endpoint inside the existing Harness Host."
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-gateway

English | [中文](README.zh.md)

## Summary

This optional Host plugin exposes three Planning tools through Streamable HTTP. It uses the Host's existing Planning provider and stores raw ideas as pending proposals, with unknown scope, acceptance, and estimates left empty. It does not start another Harness or invoke a model.

## Table of Contents

- [Use this package](#use-this-package)
- [Tool contract](#tool-contract)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Install the package into a `dsh` profile that already composes Planning and a loopback web server. Configure its Loader row with the same Workspace Registry realm as Planning:

```yaml
- id: planning-mcp
  name: '@deepseek-ai/dsh-mcp-gateway'
  isolate:
    workspaceRegistry: web-host
  config:
    planningWorkspaceId: '<existing Workspace id>'
    tokenEnv: DSH_PLANNING_MCP_TOKEN
```

Supply that named environment variable to the Host before starting the profile through `dsh --profile <name>`. Configure the MCP client to use `http://127.0.0.1:<host-port>/mcp/planning` with the same bearer credential. Keep credentials out of tracked configuration. The plugin rejects non-loopback hosting and browser-origin requests. Removing the plugin closes active calls and unregisters the endpoint.

The package patch supplies the Workspace Registry realm but does not select a Workspace or credential. Those values must be supplied by the deployment. No shipped default profile enables it.

| Config | Default | Meaning |
| --- | --- | --- |
| `planningWorkspaceId` | Required | Existing Workspace exposed by this endpoint. |
| `tokenEnv` | Required | Host environment variable containing the bearer credential. |
| `path` | `/mcp/planning` | Absolute HTTP route, without a trailing slash. |
| `requestMaxBytes` | `65536` | Maximum incoming JSON body size. |
| `resultMaxBytes` | `262144` | Maximum complete tool-result size, including text and structured content; excludes the JSON-RPC transport envelope. Minimum `512`. |
| `callTimeoutMs` | `12000` | Maximum request lifetime before disconnect and cancellation. |
| `maxPendingCalls` | `8` | Maximum concurrent MCP exchanges. |

## Tool contract

| Tool | Input and result |
| --- | --- |
| `dsh_planning_list` | Lists objects and proposal summaries in the configured Workspace, with the current Board version. |
| `dsh_planning_read` | Reads one exact item or proposal id in that Workspace. |
| `dsh_planning_propose` | Takes an idempotent request id, observed Board version, raw idea, and optional suggested lane. Creates a pending proposal with unfilled detail fields. |

Search both item and proposal summaries before capture to avoid semantic duplicates. An exact retry preserves the request id and all input fields; changing the payload under that id is rejected by Planning. A stale Board version requires rereading before submitting a new request. Read back the returned proposal id to confirm capture. Caller input cannot select a different Workspace, actor, or Session. Acceptance, revision, Memory, and Delivery operations are not exposed.

## Dev Note

The gateway owns transport lifetime and admission; Planning owns persistence, version checks, and receipts. No invariant companion is published because this transport has no independent durable projection to compare. Loader composition tests cover the real provider, repeated capture, workspace isolation, and endpoint teardown.

## Model Experience

### Planning tools

#### What the model sees

The model sees `dsh_planning_list`, `dsh_planning_read`, and `dsh_planning_propose`, with bounded JSON results. Raw idea text is source material, not an instruction to execute or a confirmed scope. Refinement and explicit adoption remain inside Planning.

#### Token effect

Tool definitions and returned records consume context tokens. Capture and read operations themselves make no model calls. Responses that exceed the endpoint limit are rejected rather than silently truncated.

#### KV Cache effect

Tool schemas are stable across Board changes. Each call appends its returned data without rewriting prior tool results.

## Known Limitations and Deferred Work

- One deployment exposes one Workspace. The credential grants only these three Planning operations.
- Semantic duplicate detection remains the caller's responsibility; identical-request deduplication is enforced by Planning.
- The list/read surface is bounded but not paginated. Oversized results return an explicit error.
- Raw capture does not infer scope, acceptance, exclusions, decomposition, or execution permission.
