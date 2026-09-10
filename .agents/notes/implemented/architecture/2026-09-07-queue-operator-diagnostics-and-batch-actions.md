# Agent Note: Queue operator diagnostics and Batch actions

Status: implemented

English | [中文](2026-09-07-queue-operator-diagnostics-and-batch-actions.zh.md)

## Problem

The operator could see that work was queued but not whether dispatch was paused, its handler was unavailable, or a concurrency limit was occupied. The Remote kept a second pause flag that diverged when another host entry paused the Queue. The workbench exposed only per-row actions and rendered every structured result as a JSON tree.

## Decision

`OperatorWorkQueue.dispatchState()` reads the provider-owned process state. `waitReason()` derives one transient explanation for a queued WorkItem from the same handler, global concurrency, Batch concurrency, and resource checks that control claims. These reads do not add a durable status or scheduling priority. The Remote copies them into browser-safe snapshots.

`WorkQueueStore` stages each validated projection separately and publishes it only after the append has been synced. A query therefore observes either the previous durable projection or the committed successor. Sync failure faults that open store and rejects later mutations until reopen and recovery, so a fully written but unsynced line cannot become process-visible and dispatch cannot continue on an uncertain durability boundary.

The workbench can focus one Batch from a selected WorkItem. It reuses the existing per-WorkItem Remote mutations to retry failed members or cancel unfinished members, refreshes once after the group, and requires risk acknowledgement before canceling running work. Agent, operation, and image results have small WorkKind-specific presentations; malformed known results and unknown result shapes still use `JsonTree`.

## Alternatives considered

**Persist a blocked state or wait reason.** Rejected because the reason can change when a handler registers or capacity is released without a durable Work transition. It remains a runtime projection over durable state.

**Let each Remote remember pause state.** Rejected because commands and other trusted host callers can pause the same provider without passing through that Remote instance.

**Add Batch mutation methods to the Queue service and Remote.** Rejected because the current actions are operator conveniences over existing authorization and per-WorkItem transitions. The client store already combines them and reports partial failures without creating another durable transaction contract.

**Build a schema-driven result renderer.** Rejected because Queue core does not own WorkKind presentation. Small known renderers improve the current tasks while the JSON fallback preserves unfamiliar outputs.

## Consequences

Operators can distinguish a capacity wait, missing composition, and a faulted store, and can act on one Batch without selecting every row. Batch actions are intentionally non-atomic: successful member transitions remain committed when another member races or fails, and the workbench reports those failures after one refresh. Image results identify durable Attachments but do not open their bytes; server pagination and event-driven browser refresh remain separate work.

## Testing

Store tests pin publish-after-sync ordering, fail-closed mutation after sync failure, and replay after reopen. Scheduler and Remote tests pin the provider-owned running, paused, and faulted states plus queued wait projection. Client tests pin readable wait text, Batch focus, risk-confirmed group actions, partial-failure reporting after one refresh, known WorkKind result rendering, malformed-result fallback, and the existing serialized refresh behavior. A browser test exercises a real staged-handler wait and risk-confirmed Batch cancellation through the built Web application.
