# Agent Note: DSH Skill handoff and multi-agent orchestration

Status: implemented

English | [中文](2026-08-31-dsh-skill-handoff-and-multi-agent-orchestration.zh.md)

## Problem

DSH feature Skills make strong decisions in isolation, but a multi-stage run can repeat the Charter, repository discovery, documentation obligations, and unchanged tests because later Skills cannot consume a bounded upstream result. High-reasoning subagents amplify the cost when several agents scan the same tree, own overlapping files, run broad checks independently, or review before an integrated candidate exists.

## Decision

[`dsh-feature-delivery`](../../../skills/dsh-feature-delivery/SKILL.md) owns lightweight routing, task-scoped receipts, evidence freshness, parallel-work admission, and integration checkpoints. Receipts may live in a task artifact or DSH durable metadata; they are not a new repository Registry or required committed format. A Skill remains usable alone and performs minimum discovery when no valid receipt exists.

Feature decisions stay serial: Charter, reuse/current-contract ownership, Issue DAG, integration, authority, and final acceptance. Distinct read-only evidence questions and implementation lanes may run concurrently after shared contracts are frozen. The primary agent owns integration and completion claims; workers own disjoint files/packages plus focused checks; an independent reviewer waits for a stable integrated candidate.

Every governed implementation records an explicit `agentPlan` before execution. The plan names each independent question or exclusive file lane, selects the cheapest adequate role/model class, and schedules review only after a stable candidate. Cross-store lifecycle, recovery, unfamiliar subsystems, and disjoint evidence questions positively trigger read-only exploration; security, authority, persistence, recovery, concurrency, and public-contract candidates normally receive an independent reviewer. Workers remain conditional on frozen contracts and disjoint ownership, while architects are reserved for high-risk architecture or repeated failure. `agentPlan: none` requires a concrete proportionality reason rather than silent omission.

The shared evidence ledger records the claim/layer, command or observation, input and environment identity, bounded proof, excluded boundary, side effects, and freshness. An unobserved identity needed for comparison is never reusable, and time-bound evidence records both observation and expiry. Later Skills reuse matching evidence and invalidate only records affected by source, manifest, composition, documentation, environment, time, or diagnosis changes. Workers run authoring checks, the integrator runs shared cross-package checks once, Feature acceptance observes the real vertical, and pre-push checks cover publication state.

An interrupted run resumes from Codex's native task and tool state before consulting Skill receipts. Completed tool results remain usable; a returned execution handle is continued; only an explicitly unknown mutating call with no handle receives one exact-target reconciliation. Tool-level ambiguity does not reopen the Feature phases or justify another recovery Skill, receipt kind, Registry, or architecture mechanism.

Feature Delivery exposes three coexisting task modes: `native` for bounded known-owner work, `adaptive` as the default path with in-place risk escalation, and `governed` for kernel, cross-domain, durable-state, security, or explicitly full-process delivery. An explicit mode cannot be silently weakened. Mode changes process depth, not permissions or evidence meaning, and escalation reuses completed decisions and fresh evidence instead of restarting phases.

One ignored local learning record measures each activated mode under `.artifacts/dsh-feature-delivery/`. A helper captures the start timestamp, writes one exclusive terminal claim, and atomically promotes the complete record under `completed/`; matching retries recover the same record, while different terminal values cannot overwrite it. The record contains duration, summarized actions, outcome, highest evidence, review findings, reused evidence, escalation, a conservative `improved`/`neutral`/`worse`/`unknown` effect, and each delegated role's observed model, reasoning level, finding count, and decision impact. Routing remains role- and risk-based rather than hard-coding historical model names. The primary agent writes once per task; workers do not emit competing records. The helper rejects recognizable credential, absolute-path, URL, prompt-shaped, and unknown-option inputs before persistence; callers remain responsible for omitting personal data or payloads that syntax cannot classify. The record is advisory, not a receipt, completion proof, telemetry stream, public persistence contract, or recovery mechanism; recording failure cannot fail the product task.

The Charter, Issue Stack, Change Verification, Runtime Composition Debug, and Self Development Skills publish their own receipt and invalidation boundaries. Issue cards carry conditional documentation and generated-artifact obligations. Self Development remains a trust overlay; Runtime Composition Debug remains an exception branch.

## Alternatives considered

**Keep natural-language handoffs only.** Rejected because later Skills cannot distinguish frozen decisions and fresh evidence from narrative context, so repeated discovery remains the safe default.

**Create more pairwise orchestration Skills.** Rejected because the resulting trigger graph duplicates rules and increases context and maintenance cost. One router references the owning Skills without copying their procedures.

**Assign every small task to a subagent and run full verification in each lane.** Rejected because coordination, conflicting design, and duplicate checks dominate small changes, especially with expensive reasoning. Parallel work requires independent value, disjoint ownership, and one integration verifier.

**Model Codex interruption as a new DSH recovery subsystem.** Rejected because Codex already retains task history, completed tool results, and resumable execution handles. The Skill supplies only the narrow fallback for an explicitly unknown final mutation; DSH runtime recovery remains owned by the product subsystem whose state actually survives interruption.

**Create a central learning database or automatically rewrite Skills from scores.** Rejected because the first useful question is only what each mode did, how long it took, what evidence it reached, and what observable effect occurred. A local bounded JSONL record is inspectable and disposable; automatic scoring would confuse unlike tasks and let process telemetry override risk boundaries.

## Consequences

Single Skills retain independent routing and minimum discovery. Linked runs can resume from valid receipts, reuse unchanged evidence, and reserve broad checks for integration. Native, adaptive, and governed work remain available without collapsing into one compromise workflow. Governed work can no longer omit delegation by default: it makes the role/model decision explicit without requiring wasteful fan-out. Recent mode and agent records can inform an uncertain choice but cannot waive explicit user selection, risk triggers, authority, or acceptance. Native interruption recovery prevents a completed phase or check from being reopened, while exact-target reconciliation contains the one unresolved mutation. The receipt producer must state identity and invalidation precisely; an incomplete or stale receipt causes focused rediscovery rather than blind trust. Validation uses representative positive, neighboring negative, linked, interruption, agent-plan, learning-record, and real self-development scenarios instead of exhaustive benchmark runs after every wording change.
