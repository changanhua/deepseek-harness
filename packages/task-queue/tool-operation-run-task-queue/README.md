# @changanhua/dsh-tool-operation-run-task-queue

English | [中文](README.zh.md)

`@changanhua/dsh-tool-operation-run-task-queue` registers model-facing Queue admission for host-configured `operation.run@1` work. It derives owner authority from the live Agent Session and submits only operation ids; the operation WorkHandler owns resolution and execution.

## Tools

- `operation_run_enqueue(title, operationId, idempotencyKey)` durably enqueues one host-configured operation and returns its WorkItem id.
- `operation_run_enqueue_batch(items, idempotencyKey, maxParallel)` atomically enqueues individually titled operation ids and returns its Batch id; `maxParallel` must be a positive safe integer.

Both tools close their parameter objects before ToolRuntime dispatch. They require a live Agent Session, preserve the calling session as Queue owner, and return only the durable id. Generic `task_queue_kinds`, status, result, cancellation, retry, statistics, and Notification delivery remain in `@changanhua/dsh-tool-task-queue`.

## Configuration and Opt-in Composition

The plugin has no configuration fields and is not mounted by the base bundle. It is useful only when the Queue provider has capacity for the resolved operation resource and `@changanhua/dsh-operation-run-task-queue` is mounted with its host allowlist.

```yaml
- id: task-queue
  name: '@changanhua/dsh-task-queue-local'
  config:
    resourceCapacity:
      operation-run: 1

- id: operation-run-task-queue
  name: '@changanhua/dsh-operation-run-task-queue'
  config:
    operations: host-reviewed allowlist

- id: tool-operation-run-task-queue
  name: '@changanhua/dsh-tool-operation-run-task-queue'
```

## Admission, Results, and Failures

Admission rejects a missing live Agent Session, unsupported parameter fields, and a non-positive or unsafe Batch concurrency value before work is enqueued. The Queue provider rejects unavailable `operation.run@1`, unknown host operation ids, missing resource capacity, and other admission failures. Accepted work keeps owner scope through terminal result reads and durable Notifications; execution failures and results are supplied by the WorkHandler rather than this Consumer.

## Extension Boundary

The schemas deliberately expose only title, operation id, idempotency key, Batch items, and Batch concurrency. They do not expose command arguments, environment values, credentials, working directories, execution deadlines, resource claims, or retry policy. Add a caller-visible operation by extending the host allowlist; add new execution semantics through a distinct WorkKind and Consumer.

## Model Experience

### Admission tool schemas

#### What the model sees

The model receives [`operation_run_enqueue` and `operation_run_enqueue_batch`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-operation-run-task-queue) schemas plus rendered durable ids; the catalog owns their complete JSON Schema.

#### Token effect

Mounting or removing this plugin adds or removes the two tool schemas and their tool-result text from the request path.

#### KV Cache effect

The two schemas change the reusable request prefix when this plugin is mounted, removed, or its schema changes; Queue lifecycle results are independent tool-result content.

## Known Limitations and Deferred Work

- Admission requires both a live Agent Session and a host composition that has mounted the operation WorkHandler with matching resource capacity.
- Batch admission is atomic but has no per-item partial-success response; callers receive the Batch id and inspect durable Queue records for terminal outcomes.
