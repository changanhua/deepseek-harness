# Client UI Task Queue

English | [中文](README.zh.md)

Browser workbench for Queue v2. One shared `QueueStore` supplies the sidebar entry and center-column workspace from `ctx.remote.taskQueue` snapshots.

## Shell contributions

- `sidebar.modules` registers `queue-module`. Its badge reports failed/unknown attention, running count, paused state, or idle.
- `shell.view` registers the `queue` workspace without unmounting the conversation underneath.

## Workspace

The workbench projects durable records into four operator states — queued, running, attention, and done — and keeps each terminal outcome (succeeded, failed, canceled) inside the done state. Rows sort by operator urgency (attention, running, queued, done) and then by update time, and the four filters (all, active, attention, done) count every projection. Search matches title or id case-insensitively.

A master-detail layout shows one compact task list beside one structured detail pane. Selecting a row exposes kind, owner, attempt progress, and timestamps, plus the current failure, every attempt, and the result. After a failed refresh the store retains the last successful rows, detail, and refresh timestamp, and the page labels them honestly beside an error banner.

Actions are scoped to the selected row: cancel for queued or running work, retry for failed work, and an attention decision that either authorizes another attempt after an explicit duplicate-side-effect acknowledgement or confirms failure with an operator-supplied reason. Unknown retry is described as “confirm retry”, never “safe retry”. Success feedback uses a toast; a mutation failure stays visible beside its row.

The store reads rows, counters, and optional detail through one `snapshot()` call. It refreshes after mutations and uses one serialized five-second polling chain, so an older response cannot overwrite a later read.

## Model Experience

None, as this browser-side workbench renders Queue records and registers no model surface.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- Refresh uses polling because Queue lifecycle events are not forwarded to the browser.
- Result output renders through a JSON tree; artifact-specific previews remain deferred.
- `confirm-succeeded` result editing is not offered; the UI keeps retry and confirmed failure only.
- Batch-wide actions and server-side pagination remain deferred if real volume requires them.
