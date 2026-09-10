---
name: dsh-feature-delivery
description: Coordinate authorized DSH feature work when outcome, ownership, dependencies, or integration need coordination. Complete bounded known-owner changes directly; add only the discovery, planning, handoff, and review justified by a concrete gap. Do not start delivery for product discussion or design-only output.
---

# DSH Feature Delivery

Complete the requested outcome with the fewest coordination steps that preserve necessary verification. Use the current conversation, plan, and tool results directly. A new phase or technical term does not require a new workflow.

## Start with direct work

An explicit user choice wins. Otherwise begin with the known implementation owner and focused evidence; no mode declaration, receipt, or process measurement is needed. Establish [checkout and package ownership](../dsh-reuse/references/checkout-ownership.md) once when relevant, preserving personal, upstream, and integration responsibilities.

Use these labels only when a requested plan or measurement needs them:

| Mode | Meaning |
| --- | --- |
| native | Bounded, known-owner work handled directly. |
| adaptive | Direct work with extra steps added for actual uncertainty or risk. |
| governed | Explicitly requested full process, or unresolved cross-owner decisions and independently managed delivery stages. Make the necessary decisions and dependencies explicit. |

Modes change coordination depth, not authority or completion semantics. A Service, Provider, WorkKind, public signature, or multi-file change does not alone require a Charter, Issue DAG, or multi-agent plan. Preserve a full process the user explicitly requested; otherwise return to direct work when the uncertainty that required extra coordination is resolved.

## Add the step that resolves the gap

The following are alternatives, not a sequence:

| Gap or risk | Add |
| --- | --- |
| User outcome, supported entry, or authority is materially undecided | Clarify that choice; use dsh-feature-charter for a substantial product boundary. |
| Reuse or implementation ownership is uncertain | Focused dsh-reuse investigation; use xia-pluginmaster only for missing current plugin/composition facts. |
| Several independently deliverable stages have real dependencies or separate owners | dsh-issue-stack-planner for those stages. Several files in one change do not need an Issue DAG. |
| Permissions, durable behavior, recovery, or concurrent state transitions change | Inspect the affected contract, obtain independent review where warranted, and verify the corresponding failure paths. Planning does not replace those checks. |
| Source, composition, and runtime disagree | dsh-runtime-composition-debug for that specific disagreement. |
| A running DSH instance participates in changing or judging DSH | dsh-self-development for controller/subject/verifier isolation and independent acceptance. Ordinary Codex editing does not trigger this overlay. |

Do not invoke an upstream Skill merely to reproduce a known conclusion in its named format. Keep shared decisions, authority decisions, integration, and final acceptance with the primary agent; collect independent facts concurrently only when useful.

## Reuse context and evidence

Reuse a result when its relevant source, environment, and claim still match. Known edit history and completed tool results within the current task can establish this; do not compute a whole-worktree digest at each phase. When identity is uncertain, check the relevant inputs or repeat the affected observation. Unknown identity cannot establish freshness, and an unrelated edit does not invalidate every prior check.

Missing receipts are not missing knowledge. Investigate only absent facts. Read [the handoff protocol](references/handoff-evidence.md) when another agent or session needs a transfer, or evidence identity cannot be established from the current context. Transfer the necessary decisions, ownership, evidence, and remaining work once, linking existing results instead of copying them.

## Resume after interruption

Resume from Codex's native task and tool state. Reuse completed results and still-relevant evidence. Continue or wait on a returned execution handle. Only when the runtime explicitly marks the last mutation unknown and provides no handle, reconcile that call's exact target once, then continue the same work.

An interruption does not reopen Charter, discovery, planning, implementation, or verified checks. One ambiguous tool outcome does not justify a recovery Skill, operation journal, Registry, or DSH architecture diagnosis. Investigate a product recovery gap only when concrete repeated evidence shows native task/tool state cannot represent the required behavior.

## Delegate for a concrete contribution

Use subagents only when the assigned work is independently useful, ownership is disjoint, and its benefit exceeds coordination cost. Describe the question or exclusive files, necessary context, expected result, and stopping condition in the task message or existing plan. A separate agentPlan is needed only when coordinating the lanes requires it; working alone needs no justification record.

- Consider an explorer for a bounded independent evidence question.
- Give implementation workers non-overlapping files after shared contracts are settled; preserve other contributors' changes.
- For a stable candidate changing security, authority, persistence, recovery, or concurrency semantics, use an independent reviewer unless the user opts out or delegation is unavailable. A public signature alone does not establish this risk.
- Reserve architecture review for an unresolved high-risk design or repeated failure.

Select the cheapest adequate role/model class from current capabilities. Use observed model and reasoning values only when reporting actual execution, not as a permanent routing table. Substantial lanes usually cost less than many microtasks. Do not assign duplicate scans or fresh checks to multiple agents.

The primary agent integrates and owns completion. Workers run their focused checks, report evidence, and do not declare the overall feature complete. Reviewers receive the stable candidate and relevant evidence without an intended verdict.

## Verify the changed promise

Use dsh-change-verification for the layers the change actually reaches. Run shared cross-package and generated-artifact checks once at integration; dsh-pre-push-checks applies later to an authorized publication. Keep required high-risk and self-development evidence even when the surrounding process is short.

A known failure stops test expansion. Diagnose its cause, correct the relevant implementation or environment within authorization, and invalidate only affected evidence. Plans, receipts, and successful subagents do not replace the promised user-visible result.

## Optional process measurement

Use [mode learning](references/mode-learning.md) only for an explicitly requested comparison, an active project sampling assignment, or a run already started for this task. Do not start measurements on ordinary delivery. Use the existing helper; do not install it or change another checkout to obtain it.

Finish a started run once at a completed, partial, blocked, or abandoned handoff. Preserve summary-only input, sensitive-data checks, and finalization safeguards. Use unknown when no comparison supports an effect claim. Recording failure is reported but does not block delivery or prove completion.

## Report once

For direct work, report the outcome, relevant verification, and remaining limits. At a real handoff, add ownership, unresolved decisions, reusable evidence, and the next action. A structured OrchestrationReceipt is optional unless the recipient or explicit deliverable requires it; do not produce a second report containing the same facts.
