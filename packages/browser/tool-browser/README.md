---
description: "Model-facing browser inspection and approval-gated page actions using the session-addressed browser service."
kind: "package-reference"
---

# @changanhua/dsh-tool-browser

English | [中文](README.zh.md)

## Summary

This package lets a model inspect authorized browser instances, tabs, and snapshots, then perform one explicit page action or continue a bounded Session-backed browser task. Every operation uses the initiating Agent's Session rather than a model-supplied session id. Personal deployments use standing browser authorization without per-action confirmation. Immutable provider tickets bind targets and parameters; an observed result confirms only a local browser action, not a business outcome.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose this consumer with `ctx.browser`, `ctx.tools`, and the existing `ctx.approval` service.

When `ctx.browserActivity` is composed, `browser_activity_search` reads retained activity for the initiating Agent's Session. The model cannot supply another Session id. Search is bounded by text, time, count, and encoded bytes; current Host grant epoch and sites remain authoritative while Chrome is offline. Results are source material, not instructions. Knowledge writes use the deployment's separately configured MCP tools and user-requested workflow.

`browser_instances`, `browser_tabs`, and `browser_snapshot` inspect current provider state. Snapshots include bounded page regions and collection items so the Agent can locate generic cards and lists. `browser_extract` filters those fresh collections into bounded structured items without executing an action. Call `browser_page_map` before `browser_region_render`: it returns short-lived opaque region references rather than CSS selectors. Rendering accepts one reference plus high-level title, summary, item, fact, link, and footer fields; the Provider compiles the private page payload. `browser_region_clear` restores the exact extension-owned result panel by mount id. `browser_request_status` reads a retained or extension-journal request without replaying it, and `browser_action_sequence` prepares and submits an already planned sequence until the first non-observed result. `browser_action` accepts a closed action schema, prepares a page action, and submits only the returned ticket. `browser_entry_mount` and `browser_entry_unmount` expose persistent page-entry references directly; they are provider-authorized mounts rather than one-shot prepared actions. Cancellation, target checks, ticket expiry, and the prohibition on automatically retrying unknown results remain enforced.

For a natural-language browser task, first inspect the page, then call `browser_task_start` with its goal and a concrete success condition: `text`, exact `url`, stable control facts such as role/label/checked/expanded, or `region.mountId` plus expected rendered text. The consumer writes planned-before-dispatch attempts, receipts, evidence, checker facts, capability snapshots, canonical delegation identities, and page-resource leases through `ctx.browserTasks`; it does not keep a task `Map`. Every Browser entry path shares that authority. A deterministic not-sent failure pauses its unchanged semantic target after the first occurrence; another mount id does not evade the block. A new region reference or later page-map fact may restore execution only when it changes the failed precondition. A sent unknown write is never replayed and is queried by `browser_request_status`. Region presentation succeeds only after an observed render and a later snapshot reports the exact live mount/text pair; identical page text outside the panel is insufficient, and task completion still requires cleanup. A missing or duplicate mount observation creates `capability-drift`; exact cleanup remains available. Repeating verify without any intervening action or recovery fact returns `stalled` and does not create another snapshot or automatic continuation. Provider reads such as `wait` remain reads, so interruption cannot invent an unknown write. For an unknown effect, the Agent must ask the user to place `[browser-task:cancel]` or `[browser-task:accept-unknown]` in the latest direct message; `browser_task_cancel` records that decision only after every page resource is final and never turns unknown into observed. The native Agent loop continues only while that task remains unverified, has no blocker, has made progress, and remains under the durable limits of 12 model continuations and 40 browser actions. Exhausted action budget still permits exact cleanup and terminates as `budget-exhausted` once all resources are final. A direct `browser_action` does not start a task because it has no machine-checkable success condition.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The tool reads `exec.agent.session.id` for every operation. The provider owns preparation and ticket expiry; `@changanhua/dsh-browser-task` owns the replayable task projection and completion gate. [Policy](src/policy.ts) applies standing personal consent when the prepared kind matches; [tool registration](src/index.ts) submits the opaque ticket exactly once. Its [loop](src/loop.ts) is a stateless continuation and checker facade, so Host restart recovery reads Session facts rather than an independent task map.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The generated [browser tool schemas](../../../docs/tool-catalog.md#changanhuadsh-tool-browser) expose fifteen browser tools plus optional activity search, and no prompt sections. `browser_snapshot` returns bounded fresh references; `browser_page_map`, `browser_region_render`, and `browser_region_clear` expose the evidence-bound page workspace; `browser_request_status` supplies the recovery boundary; and `browser_task_start`, `browser_task_verify`, and the direct-user decision boundary `browser_task_cancel` expose the durable task control flow. For an unknown action, the Agent asks the user to send `[browser-task:cancel]` or `[browser-task:accept-unknown]`; ordinary cancellation prose is deliberately insufficient.

#### Token effect

Tool definitions have a fixed cost while visible. Results add bounded snapshot, task, or status facts only when the model calls a tool; `browser_snapshot` defaults to 64 controls and 8,000 body characters, while action feedback contains at most 64 controls and 4,000 characters.

#### KV Cache effect

Prefix-stable while the visible tool set and scoped composition are unchanged. Tool results append after the reusable request prefix and do not alter earlier cached content.

## Known Limitations and Deferred Work

- The package has no browser provider, Chrome worker, or site-login executor of its own.
- A visible same-Session Chrome peer can answer through the existing Approval chain; hidden or disconnected peers delegate to Web. A representative DeepSeek-v4.1-flash field acceptance completed through the standard Web composition on an authorized Zhihu page: exact mount-scoped presentation evidence was observed, the temporary resource was cleared, and the task terminated completed without blockers. Other site logins and model routes still depend on the configured deployment.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
