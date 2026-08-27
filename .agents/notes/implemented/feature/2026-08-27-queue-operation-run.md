# Agent Note: Allowlisted Queue operations

Status: implemented

English | [中文](2026-08-27-queue-operation-run.zh.md)

## Problem

Queue v2 durably schedules typed work, but a host also needs a narrow way to expose a finite maintenance or build operation. The legacy executor adapters accept prompts, script paths, arbitrary argv, or executor names, so reusing them would let a caller choose process topology and would restore the generic executor selector that typed WorkKinds remove.

A durable process Attempt needs stronger cancellation evidence than a direct child exit. Queue may record `canceled` only after the subprocess capability proves that the complete process tree is quiescent; an exit, timeout, cancellation, or crash that cannot establish that fact cannot become a safe retry.

## Decision

`@deepseek-ai/dsh-operation-run-task-queue` is an opt-in `operation.run@1` WorkKind Bridge, and `@deepseek-ai/dsh-tool-operation-run-task-queue` is its Agent Consumer. An Agent submits only an `operationId`; host configuration maps that identifier to a fixed revision, argv, cwd, resource claim, retry policy, output limits, termination grace, and timeout. Admission persists a defensive copy of the resolved facts, so configuration reload cannot alter an admitted WorkItem.

The Bridge reuses `ctx.subprocess` for scrubbed process spawning, tree termination, collected output, and quiescence checks. Queue retains ownership of durable Work, Attempt, Result, Notification, retry, recovery, and owner delivery. Successful stdout and failed stderr are bounded with `TextRetainer`; results never expose argv, cwd, environment, spill paths, or complete failure output.

The Consumer derives Agent authority from the live Session and registers only `operation_run_enqueue` and `operation_run_enqueue_batch`. Their schemas contain titles, operation identifiers, idempotency keys, and the Batch concurrency bound. Generic Queue tools remain the model-facing path for status, cancellation, retry, explicit result retrieval, and owner delivery.

Both packages are absent from the base, web, and standard active rows. The base Queue reserves one `operation-run` resource unit and the CLI dependency graph makes both packages resolvable; a deployment opts in to the Bridge and Consumer and supplies at least one fixed, secret-free operation definition.

## Security and lifecycle boundary

Configuration rejects unknown fields, non-canonical operation ids, credential-shaped argv flags, headers, environment assignments, URL userinfo, and common credential literals. This structural filter complements review of the finite host allowlist; it is not a credential store or a license to place opaque secret values in positional arguments.

One operation lifecycle has one owner. Cancellation and timeout latch the first cause and share one idempotent terminate-and-wait promise. A canceled outcome requires `waitForExit()` to prove tree exit; failed or rejected quiescence becomes `unknown` with operator Attention. A durable cancel request wins a success that arrives before terminal settlement. Nonzero exit and timeout are started side effects and are not automatically retried.

## Verification

Bridge tests pin the closed configuration and admission schemas, resolved-fact durability, bounded output, first-cause cancellation and timeout, cancel-versus-exit success, tree quiescence, and Cordis disposal. Local Queue tests pin the atomic settlement rule that a persisted cancel request wins a later successful handler outcome.

A real Loader vertical invokes the registered Agent Consumer, rejects unauthorized or widened input before persistence, runs a fixed Node operation, reopens the Queue root, delivers a stable metadata-only owner Notification after Session flush, and reads the typed bounded result through `task_queue_result`. The Queue Workspace browser test cancels a real parent and descendant process, observes durable `canceled` only after both exit, retains the outcome across refresh and reload, and proves the final Queue root lock is reusable.

## Alternatives considered

**Reuse the legacy node, shell, Codex, Claude, OpenCode, or ArkCLI adapters.** These adapters accept arbitrary execution controls or provider prompts and have no typed admission, resolved-fact durability, or WorkKind-specific result contract.

**Add a generic shell or argv WorkKind.** Omitting execution controls only from the tool schema would not enforce the rule at direct admission boundaries. A finite host allowlist makes arbitrary process construction unrepresentable to callers.

**Put operation registration and execution in Queue core.** Queue core owns durable scheduling rather than subprocess or business-operation semantics. A WorkKind Bridge preserves the [Queue v2 ownership split](../architecture/2026-08-27-queue-v2-reuse-boundaries.md).

**Queue Skill scripts directly.** A Skill is model guidance and may construct dynamic arguments or invoke several capabilities. Each production operation needs its own stable host definition or a domain-specific WorkKind, not an implicit script executor.

## Consequences

The host can expose a durable process operation without granting callers process-construction authority, while the ordinary Queue owner, retry, recovery, result, and notification contracts remain shared with other WorkKinds. Opt-in composition prevents a deployment from advertising an empty or accidental operation catalog.

The allowlist must remain finite and reviewed. Repeated demand for parameters calls for a new contract or a domain-specific WorkKind; identifiers cannot become encoded argv. Credential-shaped validation is deliberately conservative and may reject a benign argument that resembles a secret, while arbitrary opaque positional text still requires human review.

Bounded text cannot represent byte-exact or large file results. Such a Consumer requires a separate Artifact capability and authority model instead of spill-path exposure. A subprocess Provider that cannot prove descendant exit produces operator Attention rather than guessed cancellation or retry safety.
