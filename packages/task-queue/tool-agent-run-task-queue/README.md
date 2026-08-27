# @deepseek-ai/dsh-tool-agent-run-task-queue

English | [中文](README.zh.md)

`@deepseek-ai/dsh-tool-agent-run-task-queue` provides WorkKind-specific Queue admission for `agent.run@1`. It derives owner authority from the live Agent Session and exposes no executor, profile, model, credential, or shell selection.

## Tools

- `task_queue_enqueue(title, prompt, idempotencyKey)` admits one restricted Harness worker request.
- `task_queue_enqueue_batch(items, idempotencyKey, maxParallel)` atomically admits individually titled requests while preserving the caller's positive Batch concurrency bound.

The Queue provider resolves and persists the worker specification, policy, and resource claims. Generic list, status, result, cancellation, retry, statistics, and Notification delivery remain in `@deepseek-ai/dsh-tool-task-queue`.

## Config

The plugin has no configuration fields. Host-owned worker routing is configured on the `agent.run@1` provider.

## Model Experience

Indirectly, through the two `task_queue_enqueue*` tool schemas and their rendered WorkItem or Batch id.

#### KV Cache effect

Mounting or removing the plugin changes the reusable request prefix through its tool schemas.

## Known Limitations and Deferred Work

- Admission requires a live Agent Session and supports only `agent.run@1`.
- Batch items accept a title and prompt only; execution controls remain host-owned.
