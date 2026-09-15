---
description: "Model-facing browser inspection and approval-gated page actions using the session-addressed browser service."
kind: "package-reference"
---

# @changanhua/dsh-tool-browser

English | [中文](README.zh.md)

## Summary

This package lets a model inspect authorized browser instances, tabs, and snapshots, then perform one explicit page action. Every operation uses the initiating Agent's Session rather than a model-supplied session id. Personal deployments use standing browser authorization without per-action confirmation. Immutable provider tickets bind targets and parameters; an observed result confirms only a local browser action, not a business outcome.

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

`browser_instances`, `browser_tabs`, and `browser_snapshot` inspect current provider state. Snapshots include bounded page regions and collection items so the Agent can locate generic cards and lists. `browser_extract` filters those fresh collections into bounded structured items without executing an action. `browser_action` accepts a closed action schema, prepares a page action, and submits only the returned ticket. `browser_entry_mount` and `browser_entry_unmount` expose persistent page-entry references directly; they are provider-authorized mounts rather than one-shot prepared actions. Matching actions use standing personal authorization, including navigation, filling, submitting, and clicking. A mismatched prepared action kind still requires review. Cancellation, target checks, ticket expiry, and the prohibition on automatically retrying unknown results remain enforced.

For a natural-language browser task, first inspect the page, then call `browser_task_start` with its goal and a concrete success condition (`text`, exact `url`, or stable control facts such as role, label, checked, or expanded). Use `browser_action` for one planned action and `browser_task_verify` to re-observe and check the condition. The native Agent loop continues only while that task remains unverified. Direct `browser_action` calls do not silently start a task because they lack a machine-checkable success condition.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The tool reads `exec.agent.session.id` for every operation. The provider owns preparation and ticket expiry. [Policy](src/policy.ts) applies standing personal consent when the prepared kind matches; [tool registration](src/index.ts) submits the opaque ticket exactly once. Its [invariant](src/invariant.ts) registers no independent runtime state because Browser and Approval own dispatch and exceptional approval lifetimes.

</details>

-----

<a id="model-experience"></a>
## Model Experience

The package registers nine browser tools plus optional activity search, and no prompt sections. `browser_snapshot` supports label/card-title substring search, matching-control pagination through `query`, `offset`, and `limit`, and bounded `structure` regions and collection items with the controls contained by each item; `tree: true` returns bounded tree entries with `snapshotId`, `treeCursor`, `treeComplete`, and page identity. Defaults are 64 controls, 8,000 body characters, and structure enabled; `textLimit: 0` returns controls only. `browser_extract` performs a fresh bounded observation and returns filtered collection items with their order and stable contained-control references. `scanTruncated` marks an incomplete DOM scan, so an absent match is not proof that a target does not exist. `browser_action` attaches one fresh snapshot in `value.feedback` with up to 64 controls and 4,000 body characters; the original value is under `value.actionValue`. `browser_entry_mount` and `browser_entry_unmount` let an Agent add or remove bounded, document-bound entry references for dynamic pages. `browser_task_start` and `browser_task_verify` provide a bounded 12-action observe-act-verify loop with a three-identical-failure stop. Unknown actions terminate the task without an automatic retry. Stale preparation errors include fresh references when available, allowing the model to select the intended target again. The tool never selects a replacement or repeats a write itself, and a failed feedback read preserves the original outcome.

#### KV Cache Impact

Tool schemas add a small fixed capability description. Dynamic browser data enters a request only when a model calls a tool.

## Known Limitations and Deferred Work

- The package has no browser provider, Chrome worker, or site-login executor of its own.
- A visible same-Session Chrome peer can answer through the existing Approval chain; hidden or disconnected peers delegate to Web. Site-login and real-model acceptance depend on the configured deployment.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
