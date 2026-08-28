# Client UI Task Queue

English | [中文](README.zh.md)

The Queue module's browser surface: the sidebar's first-level Queue navigation
entry with a live status badge, and the center-column Queue workspace over the
taskQueue Remote.

The workspace answers four questions at a glance: is the service
healthy, what is running, what needs a person, and what did the selected task
produce. The default view shows service state and capacity, status filters and
search, the task list, and the selected task's detail; internal fields
(receipt, run pids, command fingerprints) stay behind the explicit
Diagnostics disclosure.

## Shell contracts

- `sidebar.modules` — the navigation entry (`id: queue-module`), registered
  into the sidebar shell's module seat between the session region and the
  foot. The badge derives from the store's stats (`N running`, `N failed`,
  `faulted`, or `idle`).
- `shell.view` — the center-column module view (`id: queue`), rendered by the
  frame's module ring while the `queue` module is active. The conversation
  stays mounted underneath, so switching back loses nothing.

## Data flow

One `QueueStore` (snapshot/subscribe) serves both entries. It reads
`ctx.remote.taskQueue` (stats + list in parallel), selects task details via
`get`, and confirms every mutation (`cancel` / `retry` / `pause` / `resume`)
by re-reading the host before updating the snapshot. A 5-second poll keeps the
badge live; the workspace refreshes on mount and offers a manual refresh.
Every write reports pending → success/failure through an aria-live region.

## Model Experience

None, as this browser-side queue panel renders durable task records and registers no model surface.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- No forwarded `task-queue/*` events yet: the poll is the refresh floor until
  the events join the remote allowlist.
- The capacity readout shows live counts (`N running · M starting`) without a
  denominator: `QueueStats` does not expose `maxConcurrent`, and the UI never
  invents one.
