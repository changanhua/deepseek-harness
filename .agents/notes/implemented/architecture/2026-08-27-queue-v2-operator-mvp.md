# Agent Note: Queue v2 operator MVP

Status: implemented

English | [中文](2026-08-27-queue-v2-operator-mvp.zh.md)

## Problem

The Queue page exposed every durable lifecycle state directly, offered an unsupported reconcile action, and let overlapping browser reads replace fresher state. The standard Web composition bound an unauthenticated operator surface to every network interface.

## Decision

The Queue v2 Remote projects durable records into four operator states: queued, running, attention, and done. Terminal done rows carry a separate succeeded, failed, or canceled outcome; durable lifecycle events and recovery semantics remain unchanged. The four-state projection stays deliberately smaller than the durable status vocabulary, and the operator-urgency ordering is a client projection, never a persisted priority.

The browser workbench uses one serialized refresh chain, a master-detail layout, four filters, and case-insensitive title/id search. Rows sort by operator urgency and update time. Actions are scoped to the selected row: cancel for queued or running work, retry for failed work, and attention decisions. An unknown retry is described as “confirm retry” and requires an explicit duplicate-side-effect acknowledgement; confirming failure requires an operator-supplied reason. The UI does not offer reconcile or success confirmation because it cannot verify either claim. Owner remains routing metadata, never an authorization guarantee.

The store retains the last successful rows, detail, and refresh timestamp across a failed refresh and labels them honestly. A pending mutation locks only its own work ID, so search, filters, selection, refresh, and unrelated rows stay usable. The workbench reuses `RiskConfirmation`, `Toast`, and `JsonTree` from the shared primitives instead of package-local equivalents. Batch actions, analytics, task creation, and structured success confirmation remain absent.

The standard Web bundle binds loopback by default and the CLI rejects an all-interface bind until an authenticated operator surface exists.

## Alternatives considered

**Collapse the durable state machine.** Rejected because `starting` and `unknown` protect dispatch and crash recovery even when an operator does not need to distinguish them.

**Keep reconcile as a one-click action.** Rejected because it changes an unknown durable attempt to running without proving that the executor still owns it.

**Keep LAN publishing with a warning.** Rejected because the Queue Remote grants operator authority and has no browser login boundary.

**Card grid over the master-detail workbench.** Rejected because a compact list plus one detail pane serves the find-and-resolve path with less scanning.

**Extra UI states beyond the four.** Rejected because `starting` presents as running and `unknown` as attention without extra operator-facing states.

**Always-visible raw JSON.** Rejected because operators need structured summary, attempts, and result inspection instead of a raw dump.

**A global pending lock.** Rejected because one in-flight mutation would block unrelated rows and refresh.

**Native `window.confirm` for risk.** Rejected because the shared `RiskConfirmation` dialog provides the checked acknowledgement and consistent keyboard behavior.

**Batch controls.** Rejected because operator work in this version is one task at a time.

## Consequences

The workbench is small enough for routine task management while preserving the durable Queue v2 model. Batch actions, artifact browsing, server pagination, and structured success confirmation remain deferred. A future LAN operator surface must add authentication before re-enabling a non-loopback bind.

## Testing

Focused Remote tests pin the four-state projection. Client tests pin the view-model ordering and dots, retained refresh evidence, serialized refreshes, and the accessible attention workflows with exact Remote inputs. A real browser smoke verifies the Queue page, a durable Work ID, and the loopback listener.
