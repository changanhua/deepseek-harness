# Agent Note: Application knowledge with fresh browser bindings

Status: implemented

English | [中文](2026-09-27-browser-application-bindings.zh.md)

## Problem

Choosing among raw browser controls repeats knowledge about pages and business fields. A faster selector still spends requests on decisions whose meaning is already known. Persisting the resulting element references with application knowledge would instead carry stale page identity into later tasks.

## Decision

Keep stable application knowledge and optional task templates in a repository Skill. The [GitHub Issues skill](../../../skills/github-issues/SKILL.md) describes page paths, control meanings, and duplicate-search/form-readback requirements. Knowledge includes isolated fixtures and observed GitHub issue-list controls; every live use still requires fresh confirmation.

Its [callable flow](../../../skills/github-issues/references/execution.md) uses the caller's existing browser tools and returns ambiguous or uncertain stages to the Agent. DSH loads attachments through the selected Skill provider and runs optional deterministic steps through `run_code`, preserving BrowserTask and the initiating Agent. Codex calls its existing MCP tools in the current code execution context, preserving that connection's request ownership. The flow does not retain a second task ledger, recover by replaying inputs, or infer creation from a submission acknowledgement. The [Skill attachment decision](2026-09-27-skill-bundle-resources.md) owns the resource boundary.

The existing `browser_snapshot` consumer accepts bounded semantic control descriptors and derives bindings from that read's original references. Only a complete unfiltered observation with exactly one eligible match yields `bound`. Partial, missing, ambiguous, or mismatched observations remain explicit. Each result names its read source. The binder does not retain references, dispatch actions, evaluate business success, or add a task ledger. Existing BrowserTask and Provider checks remain the owners of budgets, page identity, authorization, and unknown writes.

This supplements the [execution authority decision](2026-09-08-browser-execution-authority.md) and [explicit form readback](../bug-fix/2026-09-27-browser-form-readback.md). The [platform proposal](../../proposed/architecture/2026-09-26-browser-capability-platform.md) retains broader task-scope work. None is superseded.

## Alternatives considered

**A new workflow service or evidence store.** Existing task attempts, receipts, and checks already own execution. A second owner would duplicate recovery and authority rules.

**Site selectors in the extension.** This makes the executor responsible for business knowledge and couples its release to page changes. Application descriptors belong above that boundary.

**Send every known step to a faster model.** A selector remains useful for genuine ambiguity, but its latency is unnecessary when current evidence leaves one valid action. Representation and orchestration must be measured separately; adding semantic names alone does not promise fewer model calls.

## Consequences

The snapshot annotation is opt-in and bounded. Existing tools execute its references, so it adds no new permissions or automatic submission. Navigation requires new operation references; scoped historical search facts need their own freshness reasoning rather than blanket invalidation. The generic task checker does not automatically prove duplicate-search coverage or exactly-once external creation. Source tests cover incomplete and ambiguous binding, and a real Loader/Chromium test drives the returned reference through the existing task with observable readback. The independent MCP reader has no binding parameter; its caller may apply the same knowledge to fresh observations.
