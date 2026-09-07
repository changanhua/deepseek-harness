# Client UI Task Queue

English | [中文](README.zh.md)

Browser workbench for Queue v2. One shared `QueueStore` supplies the sidebar entry and center-column workspace from `ctx.remote.taskQueue` snapshots.

## Shell contributions

- `sidebar.modules` registers `queue-module`. Its badge reports failed/unknown attention, running count, a faulted or paused provider, or idle.
- `shell.view` registers the `queue` workspace without unmounting the conversation underneath.

## Workspace

The workbench projects durable records into four operator states — queued, running, attention, and done — and keeps each terminal outcome (succeeded, failed, canceled) inside the done state. Rows sort by operator urgency (attention, running, queued, done) and then by update time, and the four filters (all, active, attention, done) count every projection. Search matches title or id case-insensitively.

A master-detail layout shows one compact task list beside one structured detail pane. Selecting a row exposes kind, owner, Batch, attempt progress, and timestamps, plus the current failure, every attempt, and the result. Queued rows explain the provider's current scheduling wait. Agent, operation, and image results use readable WorkKind-specific presentations, while malformed or unknown result shapes retain the JSON tree. After a failed refresh the store retains the last successful rows, detail, and refresh timestamp, and the page labels them honestly beside an error banner.

Actions are scoped to the selected row: cancel for queued or running work, retry for failed work, and an attention decision that either authorizes another attempt after an explicit duplicate-side-effect acknowledgement or confirms failure with an operator-supplied reason. Selecting a Batch focuses its members; the operator can retry failed members or request cancellation for unfinished members, with the same acknowledgement before running work is canceled. Unknown retry is described as “confirm retry”, never “safe retry”. Success feedback uses a toast; a mutation failure stays visible beside its row or Batch controls.

The store reads rows, counters, and optional detail through one `snapshot()` call. It refreshes after mutations and uses one serialized five-second polling chain, so an older response cannot overwrite a later read.

## Model Experience

None, as this browser-side workbench renders Queue records and registers no model surface.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- Refresh uses polling because Queue lifecycle events are not forwarded to the browser.
- Image results list durable Attachment references; opening or previewing those bytes remains deferred.
- `confirm-succeeded` result editing is not offered; the UI keeps retry and confirmed failure only.
- Server-side pagination remains deferred if real volume requires it.
