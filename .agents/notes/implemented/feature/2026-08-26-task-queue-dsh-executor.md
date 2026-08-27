# Agent Note: Restricted DSH task-queue executor

Status: implemented

English | [中文](2026-08-26-task-queue-dsh-executor.zh.md)

## Problem

The durable task queue could run local scripts and external coding-agent CLIs, but it could not execute a real Harness worker through its own plugin composition. Requiring the submitting Agent to choose among those process adapters also exposed host runtime topology as a field on every business task. Reusing the ordinary headless profile without a final restriction would expose recursive queue, goal, subagent, workflow, and background-process surfaces to a child, while removing foreground execution entirely left CLI-backed Skills visible but unusable. Treating the artifact directory as the checkout would conflate work-in-place edits with result collection, while storing unbounded stdout in the task snapshot would duplicate the run log.

## Decision

`@deepseek-ai/dsh-task-queue-executor-dsh` provides the `WorkHandler` for `agent.run@1`. It registers the handler through `ctx.effect()`; `@deepseek-ai/dsh-task-queue-local` owns durable admission, attempts, retry, cancellation, settlement, recovery, shutdown, and resource scheduling, while `ctx.subprocess` owns the live process tree. The [Queue v2 ownership decision](../architecture/2026-08-27-queue-v2-reuse-boundaries.md) owns the current package split.

The WorkKind-specific `@deepseek-ai/dsh-tool-agent-run-task-queue` Consumer owns `task_queue_enqueue` and `task_queue_enqueue_batch`. Their schemas accept a title, prompt, idempotency key, and Batch concurrency bound without executor, profile, model, credential, or shell fields. The generic Queue Consumer remains WorkKind-independent and owns result collection and owner Notification delivery.

The auto-initialized `task-worker` profile uses base plus headless. Every DSH task launch adds the package-owned restriction patch after the profile and home layers. The final layer keeps the platform's one-shot foreground shell tool, removes background execution, and disables Jobs, every Queue Consumer and Provider, Goals, Subagents/Ralph, Workflows, HMR, and the interactive permission-preset surface. This lets filesystem-discovered Skills invoke required CLIs without granting recursive orchestration or background process ownership. The child receives a `workspace-write` sandbox policy rooted at its admitted `workspaceDir`. A deployment whose shared default model names an optional provider route must install that provider bundle in the `task-worker` profile; the worker never copies credentials or rewrites the global model selection.

The provider forwards the Harness home explicitly but does not forward credential values. The subprocess service scrubs the ambient environment, and the worker resolves managed credentials from the Harness-home credential document. On a successful exit, the handler trims trailing newlines and retains at most `maxAssistantBytes` of UTF-8 stdout as `AgentRunOutput.assistantText` without splitting a code point. Its summary is fixed text that never echoes model output. A failed exit retains only the configured newest stderr tail in the structured failure; empty successful stdout has no `assistantText`.

## Alternatives considered

**Require every task to name an executor.** Rejected because executor names describe host process topology, not business intent. It made ordinary users and the submitting model understand deployment wiring and encouraged one adapter per business capability.

**Route typed image generation through `agent.run@1`.** Rejected because provider discovery, image resource claims, Batch concurrency, and Attachment-backed output belong to the dedicated `image.generate@1` WorkKind rather than an opaque worker transcript.

**Run the ordinary `headless` profile directly.** Rejected because home and profile patches could retain recursive orchestration and background jobs, allowing a queued child to expand its authority or recursively enqueue work.

**Remove shell from the worker completely.** Rejected because filesystem-discovered CLI-backed Skills would remain model-visible but could not perform their documented action. Foreground execution under the existing workspace sandbox is the narrow capability they require; background jobs remain disabled.

**Expose a Queue-local output directory to the worker.** Rejected because `agent.run@1` returns bounded typed JSON and Queue core provides no generic path writer. A future byte-exact file consumer must justify a separate Artifact capability.

**Persist the complete worker stdout as `assistantText`.** Rejected because the WorkResult carries a bounded semantic projection with a stable summary, while failure diagnostics retain only their configured tail.

**Resume the owner goal when the task settles.** Deferred. Durable continuation requires separate authorization, wakeup, and session-lease decisions.

## Testing

Focused tests pin intent-only WorkKind admission, validated launcher configuration, final overlay placement, foreground-only shell configuration, explicit environment values, workspace preparation, effect disposal, empty output, failure-tail retention, and multibyte-safe result bounds. Scheduler and composition tests pin late handler registration and `task-worker` initialization. The real Queue vertical records a successful restricted worker result, stable owner Notification, Session flush before acknowledgement, and explicit `task_queue_result` retrieval.

## Consequences

An Agent submits durable `agent.run@1` intent without knowing or naming runtime topology. The host routes it to a restricted DSH worker that can use installed CLI-backed Skills while recursive orchestration and background jobs remain unavailable. The broader foreground command surface is constrained by the existing workspace sandbox. This does not add durable Goal continuation or multi-host ownership; those capabilities remain separate future decisions.
