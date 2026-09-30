---
description: "Project-aware Planning tools for the existing DSH connector and Host."
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-gateway

English | [中文](README.zh.md)

## Summary

This optional Host plugin exposes project discovery, search, reading, and raw idea capture through the Host's existing Planning provider. Its connector extension adds these tools to an existing MCP server, preserving that server's other tools. Captured ideas remain pending proposals with unknown details empty; no operation invokes a model.

Planning proposal capture also accepts an optional structured delta for an existing Plan or Focus. The Host resolves the subject in the allowed project and retains the external origin and evidence as unverified references. This path only submits a pending generation; it grants no adoption or execution authority.

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
    tokenEnv: DSH_PLANNING_MCP_TOKEN
```

Supply that named environment variable to the Host before starting the profile through `dsh --profile <name>`, or replace `tokenEnv` with `tokenFile`, the absolute path to a private credential file. Exactly one credential source is required. File credentials survive normal Host restarts without modifying the launch environment. Configure the MCP client to use `http://127.0.0.1:<host-port>/mcp/planning` with the same bearer credential. Keep credentials out of tracked configuration. The plugin rejects non-loopback hosting and browser-origin requests. Removing the plugin closes active calls and unregisters the endpoint.

The package patch supplies the Workspace Registry realm. The operator supplies the credential and can restrict accessible projects with `workspacePaths`. Without that option, this local connection may access all registered projects; an empty array permits none. Calls select a returned project id or exact path, and cannot create a Workspace. If several projects are available, omitting the selection fails instead of guessing. No shipped default profile enables it.

An existing connector can import `registerPlanningTools` from `@deepseek-ai/dsh-mcp-gateway/connector` and call it with its MCP server plus `{ url, token }`, where `token` is an asynchronous credential reader. This library extension has no executable entry point. It makes no network calls during registration, so discovery and the connector's other tools still work when the Planning Host is offline. Do not replace the existing browser/session gateway with this Planning-only Host endpoint.

| Config | Default | Meaning |
| --- | --- | --- |
| `workspacePaths` | All registered projects | Optional exact project-path allowlist. An empty array denies access. |
| `tokenEnv` | Unset; required without `tokenFile` | Host environment variable containing the bearer credential. |
| `tokenFile` | Unset | Absolute private credential file, used instead of `tokenEnv`. |
| `path` | `/mcp/planning` | Absolute HTTP route, without a trailing slash. |
| `requestMaxBytes` | `65536` | Maximum incoming JSON body size. |
| `resultMaxBytes` | `262144` | Maximum complete tool-result size; excludes the JSON-RPC transport envelope. Minimum `512`. |
| `callTimeoutMs` | `12000` | Maximum request lifetime before disconnect and cancellation. |
| `maxPendingCalls` | `8` | Maximum concurrent MCP exchanges. |

## Tool contract

The connector also accepts `currentWorkspace`, an optional callback supplying the trusted connection's current project id or exact path. It is resolved per call and supplies only an omitted project selection. An explicit `workspace` takes precedence; the Host still enforces its allowlist. Without connection context, the Host selects the sole permitted project or requires an explicit choice when several exist. The callback does not infer a browser tab's current project.

| Tool | Input and result |
| --- | --- |
| `dsh_planning_workspaces` | Discovers permitted registered projects, with pagination. |
| `dsh_planning_list` | Searches item and proposal summaries within a selected project, with query, pagination, and Board version. |
| `dsh_planning_read` | Reads an exact object or immutable version; large JSON results expose bounded chunks and a continuation cursor. |
| `dsh_planning_propose` | Takes an idempotent request id, observed Board version, raw idea, and optional suggested lane. Creates a pending proposal with unfilled detail fields. |

Search both item and proposal summaries before capture to avoid semantic duplicates. Continue list pages with the returned Board version; restart the search if that version changes. An exact write retry preserves the request id and every input field. A stale Board version requires rereading before a new request. Read back the returned proposal id to confirm capture. Unknown fields and caller-supplied actor, Session, or source assertions are rejected. Captured external text remains an unverified manual source; it is not falsely attributed to a DSH user message. Acceptance, revision, Memory, and Delivery operations are not exposed.

## Dev Note

The gateway owns transport lifetime and admission; Planning owns persistence, version checks, and receipts. No invariant companion is published because this transport has no independent durable projection to compare. Loader composition tests cover the real provider, repeated capture, workspace isolation, and endpoint teardown.

## Model Experience

### Planning tools

#### What the model sees

The model sees `dsh_planning_workspaces`, `dsh_planning_list`, `dsh_planning_read`, and `dsh_planning_propose`, with bounded JSON results. Raw idea text is source material, not an instruction to execute or a confirmed scope. Refinement and explicit adoption remain inside Planning.

#### Token effect

Tool definitions and returned records consume context tokens. Capture and read operations themselves make no model calls. Search summaries and continuation cursors bound output; full object reads page large JSON without losing text. Payloads are returned once, without duplicating the same JSON in text and structured content.

#### KV Cache effect

Tool schemas are stable across Board changes. Each call appends its returned data without rewriting prior tool results.

## Known Limitations and Deferred Work

- The credential grants Planning access to the deployment's permitted registered projects; it does not establish a remote user's identity or a browser tab's current project.
- Semantic duplicate detection remains the caller's responsibility; identical-request deduplication is enforced by Planning.
- A connector transport failure after submission is an unknown outcome. The connector never automatically resubmits a write.
- Raw capture does not infer scope, acceptance, exclusions, decomposition, or execution permission.
