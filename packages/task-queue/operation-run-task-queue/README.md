# @changanhua/dsh-operation-run-task-queue

English | [中文](README.zh.md)

`@changanhua/dsh-operation-run-task-queue` registers the `operation.run@1` WorkHandler. It resolves one caller-selected operation id to an immutable host allowlist entry before Queue persistence, then starts that resolved operation through `ctx.subprocess`.

## Configuration

The plugin has one `operations` object. Each non-blank object key is the caller-visible operation id; each revision is unique within that object.

| Field | Contract |
| --- | --- |
| `revision` | Non-blank immutable host revision persisted with admitted work. |
| `description` | Non-blank host description; it is not caller input. |
| `argv` | Non-empty fixed executable-and-argument array selected by the host. |
| `cwd` | Existing directory selected by the host and checked during preparation. |
| `resource` | Non-blank Queue resource name claimed by every attempt. |
| `units` | Positive safe-integer resource units claimed by every attempt. |
| `maxAttempts` | Positive safe-integer Queue retry limit. |
| `collectBytes` | Positive safe-integer bound for retained process output. |
| `resultBytes` | Positive safe-integer bound for successful stdout, not greater than `collectBytes`. |
| `failureTailBytes` | Positive safe-integer bound for failure stderr tail, not greater than `collectBytes`. |
| `graceMs` | Positive safe-integer termination grace period no greater than the runtime timer limit. |
| `timeoutMs` | Positive safe-integer execution deadline no greater than the runtime timer limit. |

Operation definitions are trusted deployment configuration and must remain secret-free. Load-time validation rejects known credential carrier structures in fields and argv, but no generic parser can prove that arbitrary opaque positional text is not a secret; an operation that requires credentials belongs in a domain capability or WorkKind that owns credential references and operation-boundary resolution.

The package is not mounted by the base bundle. An opt-in composition mounts the Queue service and local subprocess runtime, declares capacity before admission can run, and then adds this handler with a host-reviewed allowlist.

```yaml
- id: task-queue
  name: '@changanhua/dsh-task-queue-local'
  config:
    resourceCapacity:
      operation-run: 1

- id: subprocess
  name: '@deepseek-ai/dsh-subprocess-local'

- id: operation-run-task-queue
  name: '@changanhua/dsh-operation-run-task-queue'
  config:
    operations:
      health.check:
        revision: health-check-v1
        description: Host-reviewed health check.
        argv: [host-reviewed executable, fixed host-reviewed argument]
        cwd: host-reviewed working directory
        resource: operation-run
        units: 1
        maxAttempts: 1
        collectBytes: 8192
        resultBytes: 4096
        failureTailBytes: 2048
        graceMs: 5000
        timeoutMs: 60000
```

## Admission, Execution, and Results

Admission accepts only `{ operationId }`, rejects an unknown id or widened input, and persists the resolved revision, execution facts, retry policy, and resource claim. Preparation rejects a missing working directory before a process starts. Each attempt retains bounded stdout and stderr, terminates the whole process tree for cancellation or timeout, and waits for tree quiescence before recording a terminal state. A successful result contains the operation id, revision, summary, and optional bounded stdout; generic owner-scoped Queue result reads expose that typed result.

## Failures and Extension Boundary

Spawn failure is retryable only when no operation started. A non-zero exit records bounded stderr as an `operation-exit` failure; timeout records `operation-timeout`; missing output or unconfirmed tree quiescence records an unknown outcome. Callers cannot select command arguments, environment values, credentials, working directories, timeout policy, resource claims, or retry policy. Add an operation by changing the host allowlist and capacity composition; add a different execution model by registering another WorkKind rather than widening `operation.run@1`.

## Model Experience

### Queue result projection

#### What the model sees

The model receives `operation.run@1` admission schemas from `@changanhua/dsh-tool-operation-run-task-queue`; the generic owner-scoped Queue result read returns this handler's persisted result.

#### Token effect

Zero direct token effect; this handler registers no prompt section or model-facing tool.

#### KV Cache effect

No direct invalidation; mounting or changing this handler leaves the model request prefix unchanged until its Consumer changes the registered tool schemas.

## Known Limitations and Deferred Work

- The handler runs only explicitly configured local operations and does not provide an arbitrary command-execution interface.
- Completion output is bounded text; streamed progress, structured per-operation output, and operation-specific result renderers are not part of `operation.run@1`.
