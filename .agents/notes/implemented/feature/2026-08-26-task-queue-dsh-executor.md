# Agent Note: Restricted DSH task-queue executor

Status: implemented

English | [中文](2026-08-26-task-queue-dsh-executor.zh.md)

## Problem

The durable task queue could run local scripts and external coding-agent CLIs, but it could not execute a real Harness worker through its own plugin composition. Reusing the ordinary headless profile without a final restriction would also expose recursive queue, goal, subagent, workflow, and shell surfaces to a background child. Treating the artifact directory as the checkout would conflate work-in-place edits with result collection, while storing unbounded stdout in the task snapshot would duplicate the run log.

## Decision

`@deepseek-ai/dsh-task-queue-executor-dsh` is the Service Provider for `executor: dsh`. It registers an adapter through `ctx.effect()` and leaves subprocess ownership, retry, timeout, cancellation, settlement, and run-log durability in `@deepseek-ai/dsh-task-queue-local`. The base bundle enables `dsh` admission and mounts exactly one provider after the queue service.

The auto-initialized `task-worker` profile uses base plus headless. Every DSH task launch adds the package-owned restriction patch after the profile and home layers, so persisted user configuration cannot reactivate shell/jobs, recursive task submission, goals, subagents/Ralph, workflows, HMR, or the interactive permission-preset surface. The child receives a `workspace-write` sandbox policy rooted at its explicit `workspaceDir`; `outputDir` remains a separate artifact directory. Existing records without `workspaceDir` materialize it from `outputDir`.

The provider forwards the Harness home explicitly but does not forward credential values. The subprocess service still scrubs the ambient environment, and the worker resolves managed credentials from the Harness-home credential document. On a successful exit, the adapter trims trailing newlines and stores at most `maxAssistantBytes` of UTF-8 stdout as `TaskResult.assistantText` without splitting a code point. The summary is fixed text that never echoes model output; complete stdout and stderr remain in the run log. Empty stdout has no `assistantText`, and unsuccessful attempts never enter semantic normalization.

## Alternatives considered

**Run the ordinary `headless` profile directly.** Rejected because home and profile patches could retain recursive orchestration and shell tools, allowing a queued child to expand its authority or recursively enqueue work.

**Use `outputDir` as both checkout and artifact root.** Rejected because an executor needs an explicit existing workspace while the queue needs a separately scannable result directory. Conflating them would report arbitrary checkout files as task artifacts.

**Persist the complete worker stdout as `assistantText`.** Rejected because the run log already owns complete process evidence. The task snapshot carries a bounded semantic projection with a stable summary.

**Automatically dispatch work or resume the owner goal when the task settles.** Deferred. Explicit enqueue plus durable owner notification is the P1 execution slice; autonomous selection and durable continuation require separate authorization, wakeup, and session-lease decisions.

## Testing

Focused adapter tests pin validated launcher configuration, final overlay placement, explicit environment values, workspace and artifact directory creation, effect disposal, empty output, and multibyte-safe result bounds. Scheduler and composition tests pin late adapter registration, `task-worker` initialization, and one base-bundle provider. The real-process E2E starts the built DSH CLI against the mock LLM server, inspects the actual model request for the task capsule and absent recursive or shell tools, and verifies the persisted semantic result plus run log.

## Consequences

An Agent can explicitly enqueue a durable DSH coding task against an existing workspace and later consume a bounded semantic answer and artifacts without granting the child recursive orchestration or shell execution. This does not add automatic dispatch, durable goal continuation, or multi-host ownership; those capabilities remain separate future decisions.
