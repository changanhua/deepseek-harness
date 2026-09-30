---
name: dsh-feature-delivery
description: Use when an approved or emerging DeepSeek Harness feature must move across Charter, reuse/current-contract discovery, Issue DAG planning, implementation, verification, and optional self-development or runtime-debug branches without repeating decisions, repository scans, or fresh evidence. Route small or already-scoped changes directly to their owning workflow instead of loading the full feature chain.
---

# DSH Feature Delivery

Coordinate DSH feature work through shared receipts and fresh evidence. This Skill owns routing, handoff validation, parallel-work admission, and integration checkpoints. It does not repeat architecture, implementation, debugging, review, or verification rules owned by the selected Skills.

Read [the handoff and evidence protocol](references/handoff-evidence.md) only when the task actually needs a multi-phase handoff or must carry evidence across separate owners or sessions.

Read [the delivery-mode learning protocol](references/mode-learning.md) only when the user explicitly asks to evaluate delivery modes or an already-active learning run must be closed. It is not part of ordinary feature delivery.

## Select and preserve a delivery mode

Choose one task-level mode before the first delivery action. An explicit user choice wins; otherwise reuse the active task's recorded mode, and default to `adaptive` for a new task.

| Mode | Use | Behavior |
| --- | --- | --- |
| `native` | bounded, known-owner work | Let Codex implement directly, load only owning Skills, and run focused evidence. |
| `adaptive` | ordinary default | Start on the native path and escalate in place when a concrete risk trigger appears. |
| `governed` | DSH kernel, new capability, cross-domain, durable-state, security, or explicit full-process work | Preserve the complete Charter/reuse/DAG/integration/review path and do not silently optimize it away. |

Mode changes process depth, not permissions or completion semantics. `adaptive` escalates to `governed` when work introduces a Service, Provider, WorkKind, persistence or recovery contract, security/authority boundary, DSH self-development, unclear ownership, or a source/composition/runtime disagreement. Reuse completed work and evidence during escalation; never restart the task merely to change mode. De-escalate only when the user explicitly asks or the task is re-scoped so the original trigger no longer exists.

Do not start a mode-learning run by default. When the user requested one, record the actual outcome and close it at handoff; the record remains advisory and never proves completion.

## Route proportionately

Do not load the feature chain for a mechanical edit, known-owner bug, documentation-only correction, or already-approved bounded implementation. Route those directly to the owning Skill and focused verification.

For a feature or multi-Issue capability, select only the stages that resolve a current decision. The full sequence is available when every boundary is genuinely present:

```text
Feature Charter
      ↓
Reuse decision + current-checkout contract evidence
      ↓
Issue DAG and shared-contract freeze
      ↓
Implementation lanes
      ↓
Integrated verification and acceptance
```

Use `dsh-feature-charter` only while the outcome remains materially unsettled, `dsh-reuse` only while reuse versus build is undecided, and `dsh-issue-stack-planner` only when dependent implementation units need separate ownership or sequencing. An approved outcome, settled owner, or bounded implementation skips the corresponding stage.

`dsh-self-development` is a trust and isolation overlay whenever DSH participates in changing or judging DSH. `dsh-runtime-composition-debug` is an exception branch only after a concrete composition-layer disagreement appears. Neither is a mandatory serial phase.

For a live Browser/Cordis cleanup repair, route through `dsh-runtime-composition-debug` and its [browser-resource cleanup reference](../dsh-runtime-composition-debug/references/browser-resource-cleanup.md). Establish the original request, owner, and resource state first, then confirm a state-preserving path to load the repair before issuing another write.

## Reuse receipts before rediscovery

At each transition, validate an available receipt against the current task, repository identity, dirty-diff identity, scope, and invalidation rules. Reuse its decisions and fresh evidence. Reopen only the field whose input changed; do not rerun an entire upstream Skill because one downstream artifact changed.

If no receipt exists, the selected Skill performs its normal minimum discovery and emits one. Do not require a central database or committed workflow file.

## Resume after interruption

Resume from Codex's native task and tool state before using receipts or repository discovery. Reuse every completed tool result and previously fresh evidence. If the last tool returned a running handle, continue or wait on that handle. Only when the runtime explicitly marks the last mutating call's outcome unknown and provides no handle, reconcile that call's exact target once, then continue from the same delivery phase.

Do not restart Charter, discovery, planning, implementation, or verified checks merely because a turn was interrupted. A single tool-level ambiguity does not justify a new recovery Skill, receipt kind, operation journal, Registry, or DSH architecture diagnosis. Escalate beyond exact-target reconciliation only when concrete repeated evidence shows the native task/tool state cannot represent a required product recovery contract.

## Delegation requires user authorization

This Skill never authorizes subagents. Use delegation only when the user explicitly requested it and the root repository instructions permit it. Keep the primary agent responsible for the outcome, shared contracts, integration, and completion claim. When delegation is authorized, assign disjoint ownership and do not duplicate scans or checks; otherwise perform the work directly and report any independence limitation honestly.

## Verify once at the right level

Workers run focused authoring checks. The primary agent runs cross-package and generated-surface checks once after integration. `dsh-change-verification` consumes the evidence ledger, reruns only stale or missing evidence, and owns the final DSH-specific completion ledger. `dsh-pre-push-checks` later covers only the outgoing diff and push state.

When a known failure exists, stop expanding tests. Insert `dsh-runtime-composition-debug` for a composition disagreement or systematic debugging for a local defect, fix the first cause, then invalidate only affected evidence.

## Output

For a real multi-phase handoff, return an `OrchestrationReceipt` containing:

- current phase and approved upstream receipt identities;
- serial decisions still required;
- admitted parallel lanes with owner, scope, dependencies, and stop conditions;
- fresh evidence reused, stale evidence invalidated, and shared checks reserved for integration;
- runtime-debug or self-development overlays in force;
- the next single integration decision and remaining closure gap.

Never claim that orchestration, receipts, plans, or subagent success close a Charter. Only its acceptance evidence can do that.

Close an active mode-learning run only when one was explicitly started. Keep the effect summary factual and use `unknown` when no comparison supports an effect claim.
