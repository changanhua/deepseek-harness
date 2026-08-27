---
name: dsh-task-queue
description: Use before submitting or managing durable cross-session work through Queue v2 tools. Select a composed typed WorkKind, enqueue through its specific admission tool, and inspect, cancel, retry, or read results through generic task_queue_* controls. Do not use it to choose legacy executor names or construct arbitrary shell, argv, provider, or credential payloads.
---

# DSH Task Queue

Queue is the durable scheduling and owner-delivery substrate. A typed WorkKind owns execution semantics; its Consumer owns model-facing admission. Queue is not a generic executor registry.

Use Queue when even one task must survive the current turn or Session, needs durable retry/cancellation/result history, consumes bounded shared capacity, or belongs in an atomic Batch. Keep a quick single-turn action inline when durability adds no value. Task count alone does not decide the route.

## Route before enqueueing

1. Call `task_queue_kinds`. Continue only when the required WorkKind is present. If the tool or kind is absent, report that the host has not composed the capability; do not construct a payload for a missing admission tool.
2. Call `task_queue_list` or `task_queue_status` when matching work may already exist. Reuse the same stable `idempotencyKey` for the same logical request instead of enqueueing a duplicate.
3. Choose the WorkKind-specific admission tool. Never add fields that its schema does not expose.

| WorkKind | Admission tools | Use it for | Caller controls |
| --- | --- | --- | --- |
| `agent.run@1` | `task_queue_enqueue`, `task_queue_enqueue_batch` | A restricted Harness worker request | title, prompt, idempotency key, and Batch concurrency |
| `image.generate@1` | `image_generate_enqueue`, `image_generate_enqueue_batch` | Durable image generation whose result is stored as Attachment references | finished visual request, provider/model selectors allowed by the schema, idempotency key, and Batch concurrency |
| `operation.run@1` | `operation_run_enqueue`, `operation_run_enqueue_batch` | A finite operation whose entire process definition is fixed by the host | title, host-documented operation id, idempotency key, and Batch concurrency |

If the work does not fit a composed WorkKind, run it through its owning capability or propose a domain-specific WorkKind. Do not fall back to a legacy `node`, `shell`, `codex`, `claude`, `opencode`, or `arkcli` executor name.

## Allowlisted operations

Call `operation_run_enqueue` only after `task_queue_kinds` returns `operation.run@1` and the exact `operationId` is known from host documentation or configuration. If no operation catalog is available, ask for the configured identifier or explain that the deployment must add one.

If execution needs a credential, `operation.run@1` is the wrong WorkKind: route through the domain capability or a WorkKind that owns credential references and operation-boundary resolution. Never place the value in host argv or an Agent payload.

Single admission contains exactly:

```text
operation_run_enqueue({ title, operationId, idempotencyKey })
```

Batch admission contains exactly:

```text
operation_run_enqueue_batch({
  items: [{ title, operationId }],
  idempotencyKey,
  maxParallel,
})
```

`maxParallel` is a positive safe integer. Do not send executable paths, argv, cwd, environment values, shell text, credentials, profiles, model names, providers, or generic JSON parameters. An operation id never encodes those controls. Unknown identifiers are configuration errors, not an invitation to guess or synthesize a command.

## Batches and capacity

Use a Batch when the items form one atomic admission set and share a meaningful concurrency bound. Use separate WorkItems when they have independent idempotency or lifecycle decisions. `maxParallel` bounds that Batch; host `resourceCapacity` and global Queue concurrency may impose a lower effective rate.

## Observe and steer

- Report returned Work or Batch ids immediately. Let durable owner Notifications carry terminal completion across turns instead of continuously polling.
- Use `task_queue_status` for lifecycle state and `task_queue_result` for the typed terminal output or failure. Executor output is not injected into the owner Notification.
- Use `task_queue_cancel` for an accepted WorkItem that should stop. A process-backed WorkKind reaches `canceled` only after it proves the process tree has exited; an unprovable outcome becomes `unknown` for operator attention.
- Use `task_queue_retry` for a failed WorkItem when retry is appropriate. Do not re-enqueue the same logical work, and do not treat `unknown` as succeeded or safe to retry without operator resolution.
- Use `task_queue_stats` for backlog and capacity context when scheduling or diagnosing several WorkItems.

Keep the user-facing update compact: selected WorkKind, ids, current state, and the next meaningful action. Do not expose resolved argv, cwd, environment, credentials, spill paths, or other host-only execution facts.
