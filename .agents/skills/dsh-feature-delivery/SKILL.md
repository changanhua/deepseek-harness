---
name: dsh-feature-delivery
description: Use when an approved or emerging DeepSeek Harness feature must move across Charter, reuse/current-contract discovery, Issue DAG planning, implementation, verification, and optional self-development or runtime-debug branches without repeating decisions, repository scans, or fresh evidence. Route small or already-scoped changes directly to their owning workflow instead of loading the full feature chain.
---

# DSH Feature Delivery

Coordinate DSH feature work through shared receipts and fresh evidence. This Skill owns routing, handoff validation, parallel-work admission, and integration checkpoints. It does not repeat architecture, implementation, debugging, review, or verification rules owned by the selected Skills.

Read [the handoff and evidence protocol](references/handoff-evidence.md) when the task spans more than one phase, reuses prior evidence, or may use subagents.

Read [the delivery-mode learning protocol](references/mode-learning.md) when selecting `native`, `adaptive`, or `governed` delivery, recording its result, or comparing recent mode outcomes.

## Select and preserve a delivery mode

Choose one task-level mode before the first delivery action. An explicit user choice wins; otherwise reuse the active task's recorded mode, and default to `adaptive` for a new task.

| Mode | Use | Behavior |
| --- | --- | --- |
| `native` | bounded, known-owner work | Let Codex implement directly, load only owning Skills, and run focused evidence. |
| `adaptive` | ordinary default | Start on the native path and escalate in place when a concrete risk trigger appears. |
| `governed` | DSH kernel, new capability, cross-domain, durable-state, security, or explicit full-process work | Preserve the complete Charter/reuse/DAG/integration/review path and do not silently optimize it away. |

Mode changes process depth, not permissions or completion semantics. `adaptive` escalates to `governed` when work introduces a Service, Provider, WorkKind, persistence or recovery contract, security/authority boundary, DSH self-development, unclear ownership, or a source/composition/runtime disagreement. Reuse completed work and evidence during escalation; never restart the task merely to change mode. De-escalate only when the user explicitly asks or the task is re-scoped so the original trigger no longer exists.

At mode selection, start one learning run with the repository script. At a terminal handoff, finish it once with the actual actions, elapsed time, highest evidence, review findings, evidence reuse, and bounded effect assessment. Supply summaries rather than prompts or payloads; the helper rejects recognizable sensitive forms and competing finalization. Do not record every tool call. Learning records are advisory local artifacts: they do not prove completion, control recovery, change authorization, or replace receipts. A recording failure is reported but never blocks the user's task.

## Route proportionately

Do not load the feature chain for a mechanical edit, known-owner bug, documentation-only correction, or already-approved bounded implementation. Route those directly to the owning Skill and focused verification.

For a feature or multi-Issue capability, keep decisions serial:

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

`dsh-feature-charter` freezes the outcome first. `xia-pluginmaster` collects exact checkout contracts; `dsh-reuse` consumes current and community evidence to decide reuse. They may collect disjoint facts concurrently, but neither duplicates the other's scan. `dsh-issue-stack-planner` runs only after those receipts agree on ownership and dependencies.

`dsh-self-development` is a trust and isolation overlay whenever DSH participates in changing or judging DSH. `dsh-runtime-composition-debug` is an exception branch only after a concrete composition-layer disagreement appears. Neither is a mandatory serial phase.

## Reuse receipts before rediscovery

At each transition, validate an available receipt against the current task, repository identity, dirty-diff identity, scope, and invalidation rules. Reuse its decisions and fresh evidence. Reopen only the field whose input changed; do not rerun an entire upstream Skill because one downstream artifact changed.

If no receipt exists, the selected Skill performs its normal minimum discovery and emits one. Do not require a central database or committed workflow file.

## Resume after interruption

Resume from Codex's native task and tool state before using receipts or repository discovery. Reuse every completed tool result and previously fresh evidence. If the last tool returned a running handle, continue or wait on that handle. Only when the runtime explicitly marks the last mutating call's outcome unknown and provides no handle, reconcile that call's exact target once, then continue from the same delivery phase.

Do not restart Charter, discovery, planning, implementation, or verified checks merely because a turn was interrupted. A single tool-level ambiguity does not justify a new recovery Skill, receipt kind, operation journal, Registry, or DSH architecture diagnosis. Escalate beyond exact-target reconciliation only when concrete repeated evidence shows the native task/tool state cannot represent a required product recovery contract.

## Admit parallel work narrowly

Keep the primary agent responsible for outcome, shared contracts, authority, integration, and completion claims. Use subagents only when at least two tasks are independently useful, have disjoint file or read-only question ownership, and save more work than coordination costs.

Before governed implementation begins, record an explicit `agentPlan`: each admitted role, its independent question or exclusive ownership, the cheapest adequate role/model class, and when it should run. `none` is valid only with a concrete reason such as one tightly coupled file set and no independent evidence question. This is a decision checkpoint, not a requirement to maximize agent count.

Use positive triggers as well as exclusions:

- assign a read-only explorer for an unfamiliar subsystem, cross-store lifecycle, recovery contract, or two or more disjoint evidence questions;
- assign implementation workers only after contracts freeze and file ownership is genuinely disjoint;
- for a stable candidate that changes security, authority, persistence, recovery, concurrency, or public contracts, use an independent reviewer unless the user opts out or delegation is unavailable;
- reserve an architect for high-risk architecture/security/concurrency analysis or repeated failure, not routine search or first-pass implementation.

Choose the cheapest role that can answer the question. Prefer role presets over hard-coded model names: explorer/scout for bounded discovery, worker/implementer for exclusive implementation, reviewer for independent semantic review, and architect only for the high-risk cases above. Record the actual model and reasoning level when the runtime exposes them, but route future work by role and task risk so model catalog changes do not stale the Skill.

For expensive or high-reasoning agents, prefer two or three substantial lanes over many microtasks:

- read-only explorers answer distinct evidence questions and return receipts, not competing designs;
- implementation workers receive frozen shared contracts, exclusive files/packages, focused checks, and stop conditions;
- a reviewer waits for a stable integrated candidate and checks the diff plus evidence gaps independently;
- workers do not run shared broad gates or declare the Feature/Epic complete.

Do not parallelize Charter approval, shared-contract decisions, authority decisions, final integration, or final acceptance. Do not ask several agents to scan the same tree or run the same fresh command.

## Verify once at the right level

Workers run focused authoring checks. The primary agent runs cross-package and generated-surface checks once after integration. `dsh-change-verification` consumes the evidence ledger, reruns only stale or missing evidence, and owns the final DSH-specific completion ledger. `dsh-pre-push-checks` later covers only the outgoing diff and push state.

When a known failure exists, stop expanding tests. Insert `dsh-runtime-composition-debug` for a composition disagreement or systematic debugging for a local defect, fix the first cause, then invalidate only affected evidence.

## Output

Return an `OrchestrationReceipt` containing:

- current phase and approved upstream receipt identities;
- serial decisions still required;
- admitted parallel lanes with owner, scope, dependencies, and stop conditions;
- fresh evidence reused, stale evidence invalidated, and shared checks reserved for integration;
- runtime-debug or self-development overlays in force;
- the next single integration decision and remaining closure gap.

Never claim that orchestration, receipts, plans, or subagent success close a Charter. Only its acceptance evidence can do that.

Also close the active mode-learning run when this delivery reaches a completed, partial, blocked, or abandoned handoff. Keep the effect summary factual and short; use `unknown` when no comparison supports an effect claim.
