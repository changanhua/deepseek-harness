# Agent Note: Add delivery process only for an unresolved need

Status: implemented

English | [中文](2026-09-07-demand-driven-skill-delivery.zh.md)

## Problem

A bounded implementation could acquire a full delivery chain because it introduced a Provider or WorkKind. Phase transitions required named receipts even when the same agent retained the decisions and tool results. Mandatory mode measurements and agent plans added records without establishing that they improved the task. Correct verification requirements did not justify this coordination cost.

## Decision

[Feature Delivery](../../../skills/dsh-feature-delivery/SKILL.md) begins with direct work. It adds product clarification, reuse discovery, dependency planning, or independent review for the specific uncertainty or failure risk involved. Technical component names do not select a full process. An explicitly requested full process remains binding; required authority, persistence, concurrency, and self-development verification remains independent of coordination depth.

Accepted conversation decisions and identified tool results can carry task state without receipts. The [handoff protocol](../../../skills/dsh-feature-delivery/references/handoff-evidence.md) provides optional structures for a recipient that needs them. Unknown identity never proves freshness; cross-session transfers retain the necessary input identity, and self-development retains immutable verifier plans. Only relevant changes invalidate evidence. One report suffices when a plan and a receipt would repeat the same facts.

Charter templates serve explicit or substantial multi-stage product decisions. Issue DAGs serve genuinely dependent delivery stages. Reuse questions stop when decisive local evidence answers them. Focused document edits retain the surrounding structure and validate their changed claims. Mode learning runs only for a requested comparison, an active sampling assignment, or an already-started measurement. Subagent task messages carry actual ownership; solo work needs no agent-plan justification.

This partially supersedes the [earlier handoff and multi-agent decision](2026-08-31-dsh-skill-handoff-and-multi-agent-orchestration.md) for mandatory phase receipts, keyword-driven full-process escalation, default measurement, and mandatory agent plans. Its evidence identity, disjoint ownership, integration, interruption recovery, and measurement finalization safeguards remain applicable. The [stage and checkout decision](2026-09-07-skill-stage-distinction-and-checkout-ownership.md) continues to govern scope and placement.

## Alternatives considered

**Retain the full chain but label it lightweight.** This preserves the extra artifacts and predecessor requirements. Direct exit paths and optional handoff representations remove the obligations themselves.

**Remove high-risk verification together with planning.** Less coordination does not reduce the consequences of data loss, permission escape, or self-certification. Select evidence for those risks even when no Charter or DAG is needed.

## Consequences

Routine tasks require fewer planning and reporting actions; complex tasks retain the coordination they need. The agent must justify added steps by the decision or failure path they resolve. Required repository documentation and publication checks still apply to their actual corpus. Scenario-based forward review checks routing and retained risk controls; actual time and cost savings require comparable delivery runs and are not established by shorter instructions alone.
