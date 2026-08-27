# @deepseek-ai/dsh-task-queue-executor-dsh

English | [中文](README.zh.md)

The `agent.run@1` WorkHandler provider. It registers one handler with `ctx.taskQueue`; the local queue backend owns admission, dispatch, cancellation, settlement, and durable `ChangeSet` records.

## Execution

The handler launches the current DSH argv under the auto-initialized `task-worker` profile, then applies [`worker.cordis.patch.yml`](worker.cordis.patch.yml) as the final command-line overlay. It uses configured `workspaceDir` as the child `cwd`.

The subprocess receives only `DSH_HOME`, `DSH_PERMISSION_MODE=workspace-write`, and telemetry opt-out values from this provider. Ambient secrets remain subject to the subprocess service scrub; the child resolves managed model credentials from `$DSH_HOME/.credentials.yaml`. Successful stdout becomes bounded `AgentRunOutput.assistantText`, while the fixed summary never echoes worker output. Empty stdout produces a summary without `assistantText`; a nonzero exit retains only the configured newest stderr tail in the structured failure, and cancellation, prepare failure, and spawn failure follow the queue backend's ordinary failure policy.

## Restriction overlay

The final overlay keeps one-shot foreground shell execution under the base `workspace-write` sandbox so installed Skills can invoke required CLIs. It disables background process jobs, recursive task-queue submission, goals, subagents and Ralph, workflow fan-out, HMR, and the interactive permission-preset surface. The shell tools explicitly remove `run_in_background`; because the overlay is passed after profile and home patches, persisted worker configuration cannot restore the disabled orchestration or background surfaces.

## Config

| key | default | meaning |
|---|---|---|
| `launcher` | required | Non-empty argv prefix for the current DSH launcher |
| `dshHome` | required | Harness home forwarded to the child |
| `workspaceDir` | required | Existing workspace made writable to the worker |
| `profile` | `task-worker` | Dedicated one-shot profile |
| `maxAssistantBytes` | `65536` | Maximum UTF-8 bytes persisted as semantic text |
| `collectBytes` | `262144` | In-memory collection bound per output stream before spill |
| `failureTailBytes` | `8192` | Maximum UTF-8 stderr tail included in a nonzero-exit failure |
| `graceMs` | `5000` | Grace period before subprocess termination escalates |
| `maxAttempts` | `3` | Maximum admitted attempts before Queue refuses another retry |

`maxAssistantBytes` and `failureTailBytes` cannot exceed `collectBytes`; byte limits are safe integers and UTF-8 truncation never persists a partial code point. Invalid configuration fails during plugin load.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-agent-run-task-queue`, which owns admission, and `@deepseek-ai/dsh-tool-task-queue`, which owns stable terminal notification and explicit result retrieval; this provider only supplies the bounded typed outcome.

#### KV Cache effect

No direct invalidation; the named consumer owns tool-schema and prompt-prefix changes, while task outcomes append after the reusable request prefix.

## Known Limitations and Deferred Work

- **Admission is WorkKind-specific** — `@deepseek-ai/dsh-tool-agent-run-task-queue` admits only `agent.run@1`; other capabilities use their own WorkKind Consumers and handlers.
- **No durable continuation** — task completion produces durable queue state and an owner notification, but does not wake or resume a goal by itself.
- **One host owns a queue root** — multi-host session and task ownership remain outside this provider.
