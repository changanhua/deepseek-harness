---
description: "Model-facing browser inspection and approval-gated page actions using the session-addressed browser service."
kind: "package-reference"
---

# @changanhua/dsh-tool-browser

English | [中文](README.zh.md)

## Summary

This package lets a model inspect authorized browser instances, tabs, and snapshots, then perform one explicit page action or continue a bounded Session-backed browser task. Every operation uses the initiating Agent's Session rather than a model-supplied session id. Personal deployments use standing browser authorization without per-action confirmation. Immutable provider tickets bind targets and parameters; an observed result confirms only a local browser action, not a business outcome.

`browser_task_verify` returns `verification.scope = declared-conditions-only`, the goal, conditions and evaluations. A passing URL or unchanged-text condition does not prove a requested write or mount. The Agent reports requirements outside those conditions separately. An admitted tab can be reselected after reload within the same descendants or explicit-set task, retaining budget and history; unresolved writes must be reconciled first.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

`browser_tabs` remains available for authorized installation discovery while a task is blocked, unselected or terminal. Listing does not adopt a page, change the task scope or consume its action budget; user-fixed target filtering still applies. If an initial selection returns `tab_reference_stale`, a task with no adopted or pending page, resources, delegated work or unresolved attempts ends as failed. List fresh tabs before starting a new task from a newer direct user instruction; never substitute a new browser-session identity into the old scope. Tasks that already own a page or unresolved work retain their recovery obligations.

Compose this consumer with `ctx.browser`, `ctx.tools`, and the existing `ctx.approval` service.

A task can begin before a page exists. With no user-fixed target, omit `page` from `browser_task_start`, then use a page-free `tab_open` through `browser_action` on an installation advertising `targetFreeOpen`. The returned `tab` reference contains `tabId`, `windowId`, and `browserSessionId`; `browser_task_verify` reads and adopts that exact tab into the same task. A direct first `browser_snapshot` must carry the reference as `expectedTab`. Opening and the first snapshot each consume one action; adoption and status recovery consume none. An unknown open blocks another open in that task and must be reconciled by its original request id. The adopted target belongs to the task and does not change the user's Session selection. A later user selection or clear invalidates that authority. Cordis page-function handoff requires the exact current task target, unchanged user-selection revision, current acceptance and complete owned resources; a manual page pin is not required.

When `ctx.browserActivity` is composed, `browser_activity_search` reads retained activity for the initiating Agent's Session. The model cannot supply another Session id. Search is bounded by text, time, count, and encoded bytes; current Host grant epoch and sites remain authoritative while Chrome is offline. Results are source material, not instructions. Knowledge writes use the deployment's separately configured MCP tools and user-requested workflow.

`browser_task_start.scope` defaults to `single-tab`. Choose `descendants` for linked child pages, or `explicit-set` for up to 32 complete tab references from `browser_tabs`. A descendants task with a user-fixed page requires its complete root tab; a task opening its first page acquires the root from bootstrap. An explicit set can begin without an active page: `select-scope-tab` requests `browser_task_select` on a declared member, without opening an extra tab. Child candidates never select themselves. Each selection spends one original action budget on an exact fresh snapshot; only `status: selected` permits using its returned page and controls. Unknown reads retain their request identity; a quiescent recovery may release the selection fence while the old outcome remains unknown. Scope selection does not change the user's binding or Cordis page-function permission.

Switching pages keeps earlier attempts and resource leases. Only exact owned clear/unmount operations may clean a former page; a new render or input still requires the current target. Success checks use only the current page's evidence. A completed task keeps its final exact page available for readback under the unchanged user-selection revision, even when the user's root binding differs; it permits no further selection or writes. A new task declares its own scope.

After a task adopts a page, `browser_snapshot` and `browser_extract` pin an omitted `documentId` to that accepted document only when installation, tab, and frame match. An explicit different document is rejected. This also applies after the task ends; a tab navigating elsewhere does not silently extend the task's authority.

`browser_instances`, `browser_tabs`, and `browser_snapshot` inspect current provider state. Snapshots include bounded page regions and collection items so the Agent can locate generic cards and lists. Form values are omitted by default, so empty `text` does not prove an empty value. Set `includeValues: true` only when the task needs current non-sensitive form values; password, file, hidden, and sensitive autocomplete fields remain redacted. A fill result with `valueSet` confirms that action set its requested value; it does not prove a downstream business effect. `browser_extract` filters those fresh collections into bounded structured items without executing an action. Call `browser_page_map` before `browser_region_render`: it returns short-lived opaque region references rather than CSS selectors. Rendering accepts one reference plus high-level title, summary, item, fact, link, and footer fields; the Provider compiles the private page payload. `browser_region_clear` restores the exact extension-owned result panel by mount id. `browser_request_status` reads a retained or extension-journal request without replaying it, and `browser_action_sequence` prepares and submits an already planned sequence until the first non-observed result. An unknown result names the exact request id to query. A `target_busy` result is a rejected not-sent request, so the Agent queries the earlier in-flight or unknown request id rather than the rejected id. `browser_action` accepts a closed action schema, prepares a page action, and submits only the returned ticket. Its compact feedback keeps controls and body text but omits repeated page regions and collections. `browser_entry_mount` and `browser_entry_unmount` expose persistent page-entry references directly; they are provider-authorized mounts rather than one-shot prepared actions. Cancellation, target checks, ticket expiry, and the prohibition on automatically retrying unknown results remain enforced.

For a natural-language browser task whose success fits the available machine conditions, first inspect the page, then call `browser_task_start` with its goal and one or more concrete conditions: `text`, exact `url`, stable control facts such as role/label/checked/expanded, or `region.mountId` plus expected rendered text. A task with a prohibition, negative condition, or other outcome that these clauses cannot express must not claim complete machine verification from `browser_task_verify`. The consumer writes planned-before-dispatch attempts, receipts, evidence, checker facts, capability snapshots, canonical delegation identities, and page-resource leases through `ctx.browserTasks`; it does not keep a task `Map`. Every Browser entry path shares that authority. A deterministic not-sent failure pauses its unchanged semantic target after the first occurrence; another mount id does not evade the block. A new region reference or later page-map fact may restore execution only when it changes the failed precondition. A sent unknown write is never replayed and is queried by `browser_request_status`. Region presentation succeeds only after an observed render and a later snapshot reports the exact live mount/text pair; identical page text outside the panel is insufficient, and task completion still requires cleanup. A missing or duplicate mount observation creates `capability-drift`; exact cleanup remains available. Repeating verify without any intervening action or recovery fact returns `stalled` and does not create another snapshot or automatic continuation. Provider reads such as `wait` remain reads, so interruption cannot invent an unknown write. For an unknown effect, the Agent must ask the user to place `[browser-task:cancel]` or `[browser-task:accept-unknown]` in the latest direct message; `browser_task_cancel` records that decision only after every page resource is final and never turns unknown into observed. The native Agent loop continues only while that task remains unverified, has no blocker, has made progress, and remains under the durable limits of 12 model continuations and 40 browser actions. Exhausted action budget still permits exact cleanup and terminates as `budget-exhausted` once all resources are final. A direct `browser_action` does not start a task because it has no machine-checkable success condition.

-----

`browser_snapshot` optionally accepts `bindings`, reusable application control descriptions keyed by semantic name and exact page URL. Each description has up to four alternative role/label/tag/context/name/type/href matches. A complete fresh snapshot yields `bound` only for one enabled, writable match; repeated controls yield `ambiguous`, and paginated, queried, or truncated observations yield `incomplete`. Other states are `missing`, `page-mismatch`, and `unavailable`. Results retain the read request, installation, page, snapshot, and original element references. They are derived read annotations, not action authorization or completed business checks; actions still use `browser_action` and the existing task journal. Definitions are limited to 16 entries and 16 KiB in total; each result exposes at most four candidates plus its full observed match count. The optional result adds context only when requested and incurs no additional model request. The [GitHub Issues skill](../../../.agents/skills/github-issues/SKILL.md) supplies initial application knowledge and a task template, validated on isolated fixtures rather than assumed current on the live website.

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

The generated [browser tool schemas](../../../docs/tool-catalog.md#changanhuadsh-tool-browser) expose browser tools plus optional activity search, and no prompt sections. `browser_snapshot` returns bounded fresh references; `browser_page_map`, `browser_region_render`, and `browser_region_clear` expose the evidence-bound page workspace; `browser_request_status` supplies the recovery boundary; and `browser_task_start`, `browser_task_select`, `browser_task_verify`, and the direct-user decision boundary `browser_task_cancel` expose the durable task control flow. For an unknown action, the Agent asks the user to send `[browser-task:cancel]` or `[browser-task:accept-unknown]`; ordinary cancellation prose is deliberately insufficient.

#### Token effect

Tool definitions have a fixed cost while visible. Results add bounded snapshot, task, or status facts only when the model calls a tool; `browser_snapshot` defaults to 64 controls and 8,000 body characters, while action feedback contains at most 64 controls and 4,000 characters and omits page structure.

#### KV Cache effect

Prefix-stable while the visible tool set and scoped composition are unchanged. Tool results append after the reusable request prefix and do not alter earlier cached content.

## Known Limitations and Deferred Work

- The package has no browser provider, Chrome worker, or site-login executor of its own.
- A visible same-Session Chrome peer can answer through the existing Approval chain; hidden or disconnected peers delegate to Web. A representative DeepSeek-v4.1-flash field acceptance completed through the standard Web composition on an authorized Zhihu page: exact mount-scoped presentation evidence was observed, the temporary resource was cleared, and the task terminated completed without blockers. Other site logins and model routes still depend on the configured deployment.
- A click acknowledgement can only report that the old document is no longer observable; it does not prove a click input or business result. Cancellation, deadline, grant loss, lost acknowledgement, and unverified fill remain `unknown`, even when navigation is observed.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
