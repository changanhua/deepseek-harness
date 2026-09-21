# Agent Note: Tool terminal-state containment

Status: implemented

## Problem

At personal baseline `6ddb5ca503da7b8a0da286a716565963efcb2f50`, the scheduler
records a tool call before preparation. An internal prepare, dispatch or
finalization failure drains work but omits outcomes. The driver then seals the
step and turn. Interrupted-tail repair does not rewrite such already-closed
history, so the next model request may carry unmatched tool calls.

A second boundary matters: if a terminal event cannot be appended or its
recovery flush fails, the driver must not make that tail look closed.

## Decision

`packages/core/agent-loop/src/tool-calls.ts` owns one batch of planned calls.
Each call retains its append sequence, dispatch-entry fact, finalization-attempt
fact, committed-result fact and settled slot. This state is execution-local;
Session events remain the only transcript authority.

After an internal scheduler failure the batch stops dispatching, drains started
work, and walks all requested calls in model order. It keeps committed results,
finalizes settled siblings once through the normal policy path, and records
`TOOL_NOT_STARTED` or `TOOL_OUTCOME_UNKNOWN` for the remaining calls. It does not
retry a tool body or a failed finalizer. Result commit is marked before an inbox
context callback, preventing that callback's failure from duplicating results.
The original scheduler exception still ends the turn as an error.

Recovery uses the existing `ctx.sessions.flush(session)` checkpoint. A rejected
append or checkpoint becomes `ToolCallSettlementError`; `agent.ts` leaves the
step/turn tail open, reports the failure, and fences further sends, maintenance
and automatic wakes on that exact driver. It does not clear already accepted
input. Recovery requires disposing/reopening the handle through the existing
persistence path after addressing the storage fault. A missing persistence
listener is not evidence of on-disk durability.

`packages/core/session/src/tool-protocol.ts` supplies a read-only closed-gap
scan to the existing opt-in Session invariant companion's history seeding.
Diagnostics identify turn, step, call and source/closing sequences; they do not
append, migrate, compact or repair old closed history. Open-tail repair is
unchanged. Surface replacements do not count as new tool executions.

## Alternatives considered

**Move prepare before tool/call.** Preparation includes policy and admission,
not merely scheduler lookup. Only scheduler availability is checked before
recording; policy ordering stays intact.

**Replay failed calls or rerun finalizers.** Either can repeat effects. A missing
validated result is not evidence that the external operation failed.

**Persist the raw body result when finalization fails.** This bypasses output
validation and post-policy. The result is unknown unless normal finalization
succeeds; a sibling's successfully finalized result is retained.

**Repair every historical closed step in this change.** That changes append-only
history, provenance and migration semantics. This change diagnoses those gaps
without rewriting their source.

**Seal the turn after a settlement failure.** That hides the exact interrupted
tail needed by recovery. The current driver is blocked instead.

## Consequences

Ordinary success and cancellation retain existing ordering and error codes.
The failure path adds per-request error text and one awaited durability
checkpoint, but no model request, new package, new event vocabulary, scheduler,
or persistent execution ledger. BrowserTask, browser effects and installation
authority are untouched: an unknown tool result never completes a browser task
or grants permission to replay it.

The opt-in invariant companion can now reject a seeded closed-but-unbalanced
history with a specific diagnostic. It is not enabled by this change. Full
closed-history repair, package-identity remediation, source/runtime startup
changes and UI work remain outside scope.

## Testing

The change adds real-registry/Agent/Session Vitest cases in
`packages/core/agent-loop/tests/tool-terminal-state.spec.ts`, plus pure read-only
diagnostic cases in `packages/core/session/tests/tool-protocol.spec.ts`.

The authoring environment cannot clone or install the workspace. Its isolated
Node test carrier executes the production scheduler and driver boundary code
against substitute service/persistence carriers: 25 cases pass, and the original
scheduler fails 13 of the 15 scheduler cases. This is not a repository Vitest,
typecheck, built-profile, provider or recorded-session snapshot acceptance.
Those repository gates remain required before merge; do not infer a green
product from the isolated carrier results.
