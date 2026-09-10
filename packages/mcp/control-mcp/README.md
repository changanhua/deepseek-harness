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

The connector exposes seventeen tools covering runtime identity, composition and write reconciliation; Host close; Session open, prompt, cancel, wait, events, observation and question answers; source-free Dynamic Cordis inspection; browser installations, tabs, snapshots and entry selectors; and evidence export. `dsh_runtime_status` works before Session binding and reports the process, Profile, home, package-code fingerprint and source checkout observed at adapter load. Its package fingerprint does not certify the whole application build or later source changes. `dsh_runtime_inspect` reads the current Loader plugin inventory or, after Session binding, its scoped Skills, tools and configured MCP servers. Query and result limits avoid returning the full registries when Codex needs one capability.

A development round opens a Session, submits an instruction, and calls `dsh_session_wait`. Waiting returns when the Agent becomes idle, a live question needs an answer, or the timeout expires. The result includes phase, pending questions and a bounded event page. Continue event reads with the returned `cursor`; `hasMore` and `latestSeq` distinguish a partially read page from the end. `dsh_session_observe` reads the phase and live questions without waiting. For a question, call `dsh_session_attention_answer` with its `attentionId`, a caller-minted `requestId` and answers for every question id. The existing question service resumes the original tool call and records the answer in the Session. A follow-up instruction may use `session_prompt` with `mode: steer`.

The control Host claims questions only from its exact live bound Agent; other agents retain their existing answerers. Human-only decisions still require the human's answer. Cancellation or Host disposal retracts pending questions, and a stale identity rejects. Concurrent questions remain independent. The Host keeps at most 32 pending requests; each question batch and answer is limited to 64 KiB. Answers validate question ids, offered options and single/multi-select semantics. Approval policy is unchanged. `dsh_browser_snapshot` returns page facts; entry inspection uses only the latest successful snapshot's page identity.

-----

<a id="control-contract"></a>
## Control contract

### Identity and authority

Every request carries the configured `runId`. The first successful `dsh_session_open` binds the Host adapter to one Session. Browser access then binds one installation selected from the latest `dsh_browser_instances` result, and snapshots accept only tabs from the latest `dsh_browser_tabs` observation. A page operation cannot provide its own document identity; entry inspection uses the latest successful snapshot's page object.

### Writes, waits, and evidence

Session open, prompt, cancellation and attention answers require caller-minted `requestId` values. Reuse the same id and payload after a lost reply; a matching receipt replays even after the question settles, while another payload rejects. `dsh_request_receipt` reconciles the result without repeating the write; absence means only that this Host process has no retained receipt. `dsh_session_cancel` interrupts the active turn and preserves queued or steering input. A subsequent prompt wakes new work. The Host retains up to `maxWriteReceipts` write results, with a default of 256, and rejects new writes when full. These receipts and live questions do not survive Host restart. Evidence export includes runtime identity, current observation, Session events and operation counts; an external checker owns the verdict.

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

An attached MCP client sees seventeen fixed `dsh_*` tool schemas and their JSON results. Question text and browser page facts are untrusted data; no tool result grants new authority or certifies success.

#### Token effect

The seventeen tool schemas add a fixed context cost to the external MCP client. Event pages, registry queries and question batches are bounded; a complete evidence export scales with Session history. The package adds no tools or prompt sections to the target DSH model; a supplied question answer enters its existing tool result and subsequent model context.

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
