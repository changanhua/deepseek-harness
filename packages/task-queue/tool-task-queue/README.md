# @changanhua/dsh-tool-task-queue

English | [中文](README.zh.md)

`@changanhua/dsh-tool-task-queue` exposes generic Queue v2 controls to a live Agent session. The plugin requires `tools`, `taskQueue`, `sessions`, and the required `maxNotificationsPerStep` bound. Every WorkItem operation derives an owner-fenced `AgentWorkQueue` from the current Session.

## Tools

- `task_queue_list()` returns summaries of owned WorkItems.
- `task_queue_status(id)` returns one owned WorkItem summary.
- `task_queue_result(id)` explicitly returns typed terminal output or structured failure.
- `task_queue_cancel(id)` requests cancellation of one owned non-terminal WorkItem.
- `task_queue_retry(id)` retries one owned failed WorkItem.
- `task_queue_stats()` counts owned WorkItems by lifecycle status.
- `task_queue_kinds()` lists the typed WorkKinds enabled by the host.

WorkKind-specific admission tools belong to separate Consumer packages.

## Owner delivery

For each pending owner Notification, the plugin adds at most `maxNotificationsPerStep` stable metadata messages after downstream pre-step listeners accept the step. The message identifies the WorkItem, Attempt, terminal outcome, and Result id and directs the Agent to `task_queue_result`; it never includes executor output, stderr, prompts, paths, or attachments.

The plugin acknowledges a Notification only after the matching `user/message` is durable and `sessions.flush()` succeeds. Restart processing recognizes an existing stable message and retries acknowledgement without reinjecting it. A rejected step or failed flush leaves the Notification pending.

## Config

- `maxNotificationsPerStep` — required positive integer limiting stable owner messages added to one accepted step.

## Model Experience

Indirectly, through seven `task_queue_*` tools and stable terminal-notification messages; typed executor output becomes model-visible only after an explicit `task_queue_result` call.

#### KV Cache effect

Mounting or removing this plugin changes the reusable request prefix through its tool schemas. Delivery messages add ordinary logged user content only when pending Notifications exist.

## Known Limitations and Deferred Work

- Controls operate only on WorkItems owned by the current Agent Session; trusted operators use the operator Queue API.
- Stable delivery does not wake an idle Agent or continue a Goal automatically.
- Full Attempt history remains available through Queue operator views rather than these model tools.
