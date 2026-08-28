# @deepseek-ai/dsh-task-queue-executor-dsh

English | [中文](README.zh.md)

The Service Provider for `executor: dsh`. It registers one `ExecutorAdapter` with `ctx.taskQueue`; the local queue backend remains the sole owner of spawn, timeout, cancellation, retry, settlement, and the durable run log.

## Execution

The adapter launches the current DSH argv under the auto-initialized `task-worker` profile, then applies [`worker.cordis.patch.yml`](worker.cordis.patch.yml) as the final command-line overlay. It creates and uses `workspaceDir` as the child `cwd`, creates `outputDir` separately for artifacts, and includes both absolute task paths in the worker prompt. A task without `workspaceDir` uses `outputDir` for compatibility.

The subprocess receives only `DSH_HOME`, `DSH_PERMISSION_MODE=workspace-write`, and telemetry opt-out values from this provider. Ambient secrets remain subject to the subprocess service scrub; the child resolves managed model credentials from `$DSH_HOME/.credentials.yaml`. Successful stdout becomes bounded `TaskResult.assistantText`, while the fixed summary never echoes worker output and the complete process evidence remains in the queue run log. Empty stdout produces a summary without `assistantText`; nonzero exit, timeout, cancellation, prepare failure, and spawn failure follow the queue backend's ordinary failure policy and are never normalized as success.

## Restriction overlay

The final overlay disables shell and process jobs, recursive task-queue submission, goals, subagents and Ralph, workflow fan-out, HMR, and the interactive permission-preset surface. The base sandbox policy still resolves `workspace-write` against the worker `cwd`, and the filesystem provider remains sandboxed. Because the overlay is passed after profile and home patches, those disabled rows cannot be re-enabled by a worker's persisted configuration.

## Config

| key | default | meaning |
|---|---|---|
| `launcher` | required | Non-empty argv prefix for the current DSH launcher |
| `dshHome` | required | Harness home forwarded to the child |
| `profile` | `task-worker` | Dedicated one-shot profile |
| `maxAssistantBytes` | `65536` | Maximum UTF-8 bytes persisted as semantic text |
| `collectBytes` | `262144` | In-memory collection bound per output stream before spill |
| `graceMs` | `5000` | Grace period before subprocess termination escalates |

`maxAssistantBytes` cannot exceed `collectBytes`; byte limits are safe integers and UTF-8 truncation never persists a partial code point. Invalid configuration fails during plugin load.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-task-queue`, which owns the submit schema, coding-agent guidance, terminal summary notification, and status projection; this provider only supplies the bounded semantic outcome.

#### KV Cache effect

No direct invalidation; the named consumer owns tool-schema and prompt-prefix changes, while task outcomes append after the reusable request prefix.

## Known Limitations and Deferred Work

- **No automatic dispatch** — an Agent or host operator must explicitly enqueue `executor: dsh`; this provider does not select tasks autonomously.
- **No durable continuation** — task completion produces durable queue state and an owner notification, but does not wake or resume a goal by itself.
- **One host owns a queue root** — multi-host session and task ownership remain outside this provider.
