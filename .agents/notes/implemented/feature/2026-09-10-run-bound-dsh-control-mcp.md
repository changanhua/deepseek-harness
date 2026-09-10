# Agent Note: Run-bound DSH control MCP

Status: implemented

English | [中文](2026-09-10-run-bound-dsh-control-mcp.zh.md)

## Problem

An external Codex verifier had to drive an isolated DSH Session, inspect Dynamic Cordis state, read browser page facts, and export evidence. The Web UI and terminal logs expose those facts for people, but they require screen navigation and ad hoc log parsing. The public ACP surface controls an agent workflow, while this validation path also needs DSH-specific Cordis and browser observations that ACP does not own.

The existing [MCP client decision](2026-07-07-mcp-client-plugin.md) rejects a generic Harness-as-MCP server because ACP already serves external agent automation. That decision remains valid: the missing capability is a narrow local verifier adapter, not another public agent protocol or a projection of every DSH tool.

## Decision

`@changanhua/dsh-control-mcp` supplies two explicitly composed halves. The startup-only `control-mcp` profile runs a stdio MCP server for the external client and, by default, owns a child Web Host plus temporary isolated home. `dsh_control_close` and connector disposal stop that child. An opt-in Web-profile patch mounts a Host adapter that registers a dedicated authenticated Connection RPC channel. The normal Web profile does not load that adapter; attaching to a pre-existing Host remains an explicit diagnostic mode.

The connector accepts only HTTP loopback origins. It exchanges the target Host's process launch token with redirects disabled, keeps the returned signed cookie pair, and sends control requests without the token in their URL. A 401 permits one cookie re-exchange; a Host-process restart still requires the new launch token and a connector restart.

Every Host request carries a configured `runId`. The first successful Session open binds that adapter instance to one Session. Browser access binds an installation only after it appears in a fresh instance observation, accepts snapshots only for tabs from the latest tab observation, and supplies the latest successful snapshot's page identity to entry inspection. Callers cannot provide a document identity for entry inspection.

The MCP server exposes fixed operations for runtime identity; Session open, prompt, wait, events, live observation and question answers; source-free Cordis inventory; browser instances, tabs, snapshots and entry inspection; and evidence export. It exposes no arbitrary Remote endpoint, Context object, Node.js execution, shell, filesystem, Dynamic Cordis mutation, or acceptance decision.

Session open, prompt, cancellation and question answers require caller-minted idempotency keys. The Host retains a fixed number of write receipts and rejects new writes after capacity is exhausted, while reads and waits remain separately counted. Receipt lookup reconciles an uncertain reply without issuing another write. Repeated writes replay their receipt; a changed payload under the same identity rejects. Cancellation preserves pending input for later work. Receipts and pending questions are process-local. Evidence export includes package-code fingerprint, source identity at adapter load, current observation and Session events; an independent verifier interprets these facts.

The opt-in Host answers the existing `user-questions/request` waterfall only for its exact live bound Agent. Pending requests receive independent identities; cancellation and disposal retract them. Observation reads these live requests instead of inferring unanswered questions from historical tool calls. Waiting wakes for a live question or Agent settlement, and event-page cursors advance only over returned events. The existing question tool records the supplied answer and continues the same Agent loop. Human-only decisions remain human-owned; the bridge adds no approval-policy override.

## Alternatives considered

**Drive only the Web UI and parse logs.** Rejected because UI state, scroll position, and formatted logs are weaker automation inputs than the owning Session, Cordis, and browser services. Independent browser checks still remain appropriate for final page-visible acceptance.

**Extend ACP with DSH-specific browser and Cordis methods.** Rejected because ACP is the interoperable external agent protocol. Adding validation-only DSH internals would make its contract vendor-specific and would still not establish an independent evidence owner.

**Expose every Host Remote method or model-facing tool through MCP.** Rejected because it would inherit unrelated authority, duplicate API discovery, and let the verifier mutate the subject through paths outside the validation plan.

**Provide one tool that completes and judges the browser task.** Rejected because it would hide page understanding, plugin generation, and acceptance inside the adapter. Separate observations keep the tested model's work and the verifier's judgment distinguishable.

## Consequences

Codex can create and prompt one isolated Session, wait on its real lifecycle, inspect Cordis and browser state, and receive evidence without controlling the DSH UI. The channel remains local, explicit, and absent from ordinary profiles. The fixed tool schemas and progressive bindings reduce accidental cross-run or stale-page control.

The package adds a private personal bundle and one shipped profile template. Browser operations are available only when the target Host composition provides the separately owned `browser` service; until that integration lands, those tools return a structured unavailable result. Stdio MCP, loopback HTTP, automatic child Host ownership, and one Host per connector are the supported deployment shape. A prepared `DSH_CONTROL_HOST_HOME` can supply credentials and durable settings; an omitted value uses a temporary home that is removed on close.

Source tests cover run and Session binding, bounded idempotency, waiting, Cordis filtering, browser observation fences, authentication, MCP mapping, and lifecycle disposal. A built-profile smoke performs an MCP handshake and authenticated control call. A live isolated Web Host run has also created a Session and exported its durable events through the connector; browser-visible acceptance remains owned by the browser page-model integration.
