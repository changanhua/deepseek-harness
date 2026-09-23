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

`browser_instances`, `browser_tabs`, and `browser_snapshot` inspect current provider state. Snapshots include bounded page regions and collection items so the Agent can locate generic cards and lists. Browser observation results persist bounded, selector-free presentation metadata beside the model-facing text so UI projections remain available when output retention spills that text. Input, textarea, and contenteditable values are intentionally redacted, so empty `text` does not prove an empty value. A fill result with `valueSet` confirms that action set its requested value; it does not prove a downstream business effect. `browser_extract` filters those fresh collections into bounded structured items without executing an action. Call `browser_page_map` before `browser_region_render`: it returns short-lived opaque region references rather than CSS selectors. Rendering accepts one reference plus high-level title, summary, item, fact, link, and footer fields; the Provider compiles the private page payload. `browser_region_clear` restores the exact extension-owned result panel by mount id. `browser_request_status` reads a retained or extension-journal request without replaying it, and `browser_action_sequence` prepares and submits an already planned sequence until the first non-observed result. An unknown result names the exact request id to query. A `target_busy` result is a rejected not-sent request, so the Agent queries the earlier in-flight or unknown request id rather than the rejected id. `browser_action` accepts a closed action schema, prepares a page action, and submits only the returned ticket. Its compact feedback keeps controls and body text but omits repeated page regions and collections. `browser_entry_mount` and `browser_entry_unmount` expose persistent page-entry references directly; they are provider-authorized mounts rather than one-shot prepared actions. Cancellation, target checks, ticket expiry, and the prohibition on automatically retrying unknown results remain enforced.

For a natural-language browser task whose success fits the available machine conditions, first inspect the page, then call `browser_task_start` with its goal and one or more concrete conditions: `text`, exact `url`, stable control facts such as role/label/checked/expanded, or `region.mountId` plus expected rendered text. A task with a prohibition, negative condition, or other outcome that these clauses cannot express must not claim complete machine verification from `browser_task_verify`. The consumer writes planned-before-dispatch attempts, receipts, evidence, checker facts, capability snapshots, canonical delegation identities, and page-resource leases through `ctx.browserTasks`; it does not keep a task `Map`. Every Browser entry path shares that authority. A deterministic not-sent failure pauses its unchanged semantic target after the first occurrence; another mount id does not evade the block. A new region reference or later page-map fact may restore execution only when it changes the failed precondition. A sent unknown write is never replayed and is queried by `browser_request_status`. Region presentation succeeds only after an observed render and a later snapshot reports the exact live mount/text pair; identical page text outside the panel is insufficient, and task completion still requires cleanup. A missing or duplicate mount observation creates `capability-drift`; exact cleanup remains available. Repeating verify without any intervening action or recovery fact returns `stalled` and does not create another snapshot or automatic continuation. Provider reads such as `wait` remain reads, so interruption cannot invent an unknown write. For an unknown effect, the Agent must ask the user to place `[browser-task:cancel]` or `[browser-task:accept-unknown]` in the latest direct message; `browser_task_cancel` records that decision only after every page resource is final and never turns unknown into observed. The native Agent loop continues only while that task remains unverified, has no blocker, has made progress, and remains under the durable limits of 12 model continuations and 40 browser actions. Exhausted action budget still permits exact cleanup and terminates as `budget-exhausted` once all resources are final. A direct `browser_action` does not start a task because it has no machine-checkable success condition.

`browser_snapshot` with structure enabled also captures ordered source blocks with an extractor version and explicit omissions. New `browser-source-v2` captures retain visible accessible icon names together with distinct image titles; previously saved `browser-source-v1` evidence remains readable. Neither version guarantees complete page coverage. `browser_read_source` pages those already-delivered blocks without reading the webpage again. `browser_publish_semantic_map` accepts AI grouping and summaries only after their referenced blocks have been delivered through source-read results; it validates the initiating Session, exact snapshot, hierarchy, and overall bounds. The result is a derived map, not authoritative webpage content. Unorganized blocks remain available, and new candidates remain separate versions.

The extension marks a semantic-generation user turn. A replayable Session projection tracks that turn across Host recovery. A monotonic Host tool guard allows only snapshot, source-read, and map-publication tools in that turn, including through nested transports; it confines reads to the fixed tab and frame. A later ordinary turn uses its normal tool policy. The marker restricts authority and never grants it. A separate host-only projection retains the four most recent authenticated source snapshots and their read receipts per Session; an evicted snapshot cannot be used for a new read or publication. A target rebind, target clear, or later snapshot attempt invalidates publication from an earlier source. A successful snapshot after same-tab navigation is accepted when installation, tab, frame, and target revision match; its returned documentId and URL identify the source rather than the binding-time page. Source location targets that returned documentId and verifies the current text before highlighting.

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

The generated [browser tool schemas](../../../docs/tool-catalog.md#changanhuadsh-tool-browser) expose seventeen browser tools plus optional activity search, and no prompt sections. `browser_snapshot` returns bounded fresh references; `browser_page_map`, `browser_region_render`, and `browser_region_clear` expose the evidence-bound page workspace; `browser_request_status` supplies the recovery boundary; and `browser_task_start`, `browser_task_verify`, and the direct-user decision boundary `browser_task_cancel` expose the durable task control flow. For an unknown action, the Agent asks the user to send `[browser-task:cancel]` or `[browser-task:accept-unknown]`; ordinary cancellation prose is deliberately insufficient.

#### Token effect

Tool definitions have a fixed cost while visible. Results add bounded snapshot, task, or status facts only when the model calls a tool; `browser_snapshot` defaults to 64 controls and 8,000 body characters; structured source capture adds at most 64 blocks and 16,000 characters. Source-read pages contain at most eight complete blocks and 4,800 source characters, while action feedback contains at most 64 controls and 4,000 characters and omits page structure.

#### KV Cache effect

Prefix-stable while the visible tool set and scoped composition are unchanged. Tool results append after the reusable request prefix and do not alter earlier cached content.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The package has no browser provider, Chrome worker, or site-login executor of its own.
- Semantic maps cover only captured source blocks. Source validation proves a reference to captured text, not summary accuracy or complete page coverage; two-level navigation does not infer causal relations or silently remap changed source content.
- A visible same-Session Chrome peer can answer through the existing Approval chain; hidden or disconnected peers delegate to Web. A representative DeepSeek-v4.1-flash field acceptance completed through the standard Web composition on an authorized Zhihu page: exact mount-scoped presentation evidence was observed, the temporary resource was cleared, and the task terminated completed without blockers. Other site logins and model routes still depend on the configured deployment.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
