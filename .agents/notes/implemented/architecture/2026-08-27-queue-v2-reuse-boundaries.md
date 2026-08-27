# Agent Note: Queue v2 ownership and reuse boundaries

Status: implemented

English | [中文](2026-08-27-queue-v2-reuse-boundaries.zh.md)

## Problem

Queue v2 needs host-durable typed work, crash recovery, resource scheduling, and owner-visible outcomes that process-local Jobs, same-session Goals, Subagents, Workflows, Schedules, and Agent Teams do not provide. Its implementation must reuse bounded text retention, Session-message receipt detection, image storage, and provider-specific admission without moving those responsibilities into Queue core.

Queue closure requires recovered queued WorkItems to dispatch, crashed starting or running Attempts to become unknown, teardown to retain the root lock until active attempts settle, and every Batch to obey its own `maxParallel`. Delivery that only tells an Agent to inspect a status tool that omits the typed result is a lifecycle notification, not a completed business outcome.

## Decision

Queue v2 remains a separate capability seam. The Service Definition owns durable work records and typed handler registration; the local Service Provider owns the single-writer store, scheduling, recovery, and outboxes; WorkKind bridge plugins connect Queue to domain services; Consumer plugins own model, command, Remote, and Session-message entry paths. Queue core never imports a domain Provider, Goal, Jobs, Workflow, Subagent, Schedule, or Agent Teams implementation.

This decision refines the artifact and generic-tool ownership described by the [Queue v2 image canary](2026-08-26-queue-v2-image-canary.md). It retains the [Queue v2 operator MVP](2026-08-27-queue-v2-operator-mvp.md) four-state projection and its refusal to expose reconcile or unverified success confirmation.

### Capability ownership

| Need | Owner | Queue relationship |
| --- | --- | --- |
| Process-local live work and streaming output | `ctx.jobs` | Separate lifecycle; no Queue dependency |
| Host-durable finite work, attempts, retry, and recovery | `ctx.taskQueue` | Queue core responsibility |
| Model or provider image generation | `ctx.imageGeneration` | `image.generate@1` bridge consumes it |
| Durable normalized image bytes | `ctx.attachments` | Image bridge stores output references through it |
| Child Agent identity and continuation | `ctx.subagents` | Not a Queue executor abstraction |
| Same-session objective and Round budget | `ctx.goals` | A later opt-in continuation bridge may consume both services |
| Parallel dependency orchestration | Workflow | May submit WorkItems, but Queue does not execute Workflow semantics |
| Timed conversation delivery | Schedule | Independent from event-driven Queue completion |
| Peer roster, mailbox, and task board | Agent Teams | Its Session receipt helper is reusable; its task board is not the Queue backend |

### Package and dependency design

```text
@deepseek-ai/dsh-task-queue                 Service Definition
  ^                 ^                  ^
  |                 |                  |
task-queue-local    agent.run bridge   image.generate bridge
Store + scheduler   -> subprocess      -> imageGeneration
                                         -> attachments

tool-task-queue                    generic Agent control + owner delivery
tool-agent-run-task-queue          agent.run admission
tool-image-generation-task-queue   image.generate admission
command-task-queue                 trusted host command Consumer
task-queue-remote                  loopback operator Consumer
```

Providers and Consumers depend on `@deepseek-ai/dsh-task-queue`; Queue core does not depend on them. Bundles select the local Queue Provider, WorkKind bridges, resource capacity, and agent-scoped Consumer rows. Handler registrations remain Cordis effects and must trigger dispatch of recovered queued work.

### Durable records

`ChangeSet` remains the only append unit. `WorkItem` persists canonical intent, resolved execution facts, handler-derived `WorkPolicy`, and validated `ResourceClaim` values. Persisting claims prevents a restarted handler version or deployment change from silently changing the resources already admitted work requires.

`BatchRequest` contains homogeneous items with individual titles, inputs, and tags. One receipt, optional Batch, and every WorkItem commit in one ChangeSet after external admission resolution finishes. The provider rechecks the receipt inside its mutation transaction before append. `Batch.maxParallel` participates in every claim decision together with host `maxConcurrent` and resource capacity.

`Attention` represents only an unknown Attempt that requires operator resolution. It has `pending` and `resolved` states; `unknown/resolved` and `attention/resolved` commit together. There is no independent acknowledgement that can hide Attention while its WorkItem remains unknown.

`Notification` is the owner-delivery outbox for terminal `succeeded`, `failed`, or `canceled` work. It commits in the same ChangeSet as the terminal event, carries immutable Work, Attempt, Result, owner, and message identities, and never contains executor output. Cancellation before dispatch uses a null Attempt id. Ownerless work creates no Notification.

### Admission and scheduling

`WorkHandler.resolveAdmission()` performs external discovery only after receipt lookup misses. The provider calls `resources()` and `policy()` once, validates their complete values, and persists them with the WorkItem. No WorkHandler method starts side effects before synchronous `start()` returns a `LiveAttempt`.

The local scheduler serializes durable mutations but performs admission resolution, preparation, and live execution outside that transaction. It counts global executions, each persisted resource claim, and active members of the WorkItem's Batch before claiming. Missing capacity, invalid units, an invalid policy, or an unavailable WorkKind fails admission or reports a stable blocked diagnostic; it never leaves work silently unclaimable.

Handler registration calls the scheduler after the registration becomes visible. Opening the store acquires Queue-root ownership before recovery. Recovery converts every persisted `starting` or `running` Attempt into `unknown` with one same-ChangeSet Attention before ordinary dispatch begins, because a crash between external start and the running append cannot prove whether side effects began.

Provider disposal closes admission and dispatch, commits `cancel/requested` for each active WorkItem that lacks it, aborts every active execution, requests `LiveAttempt.cancel()`, and awaits settlement through a configured shutdown bound. A settled outcome commits normally. A cancellation error or deadline commits unknown plus Attention before the store releases the Queue-root lock. The lock is never released while a live attempt remains unrepresented by a durable terminal or unknown record.

### Owner delivery and result collection

The generic Agent facade exposes pending Notifications and owner-fenced acknowledgement. The Agent Consumer adds stable trusted-reference messages only to accepted `agent/pre-step` input, without waking an idle Agent. It observes the matching durable `user/message`, flushes the owner Session, and then acknowledges the Notification by id and message id. A restart uses the Agent inbox projection helper to distinguish an already accepted message from a missing one and never duplicates the stable identity.

The stable message identifies the Work, Attempt, terminal outcome, and Result id and directs the Agent to `task_queue_result`. It never includes assistant text, stderr, prompts, paths, or artifact bytes. `task_queue_result` returns the owner-visible typed result or structured failure through the normal tool-result retention policy, so executor content is model-visible only after an explicit read and is logged as a tool result.

The pure Session-message receipt helper currently private to Agent Teams moves to the Agent inbox module, which owns `agent/inbox/spliced`. Agent Teams and Queue delivery share that helper; their durable mailbox and outbox state machines remain independent.

### Result storage

Queue core persists typed JSON results and does not provide a generic filesystem writer. The image bridge writes generated images through `ctx.attachments` and stores `ImageAttachmentRef` values in `ImageGenerateOutput`. This reuses content-addressed persistence, validation, replay, and authorized reads instead of publishing Queue-root host paths.

If a current consumer requires byte-exact non-image outputs or image originals that attachment normalization cannot preserve, that requirement must justify a separate Artifact Service Definition, Provider, retrieval Consumer, and authority model. A private Queue-local path writer is not the fallback.

### WorkKind Consumers

`tool-task-queue` owns generic list, status, result, cancel, retry, kinds, prompt guidance, and owner Notification delivery. It does not import a specific WorkKind package or register admission schemas.

`tool-agent-run-task-queue` owns single and Batch `agent.run@1` admission. `tool-image-generation-task-queue` owns single and Batch `image.generate@1` admission. The image Batch tool accepts completed visual prompts; prompt expertise runs once before Queue admission through an explicitly selected or pinned Skill. Queue workers never start one Agent per image merely to write prompts.

### Future continuation

Task success grants no authority to continue an owner Goal. A later optional bridge may consume Queue Notifications and a durable Goal-owned continuation grant, then request one bounded wakeup through an Agent or Session runner. Goal owns objective revision and Round budget; the Session runtime owns any multi-host lease. Queue remains the producer of terminal facts and does not become a Goal scheduler or Session coordinator.

## Alternatives considered

**Use Jobs as the Queue backend.** Rejected because `JobStart` captures callbacks and exact live Agent objects in one process. Adapting it would recreate durable identity, recovery, attempt, receipt, and ownership semantics inside a wrapper.

**Keep all admission in generic `tool-task-queue`.** Rejected because one Consumer would dictate WorkKind-specific schemas and dependencies. It already hardcodes `agent.run@1`, while the image path demonstrates that domain admission evolves independently.

**Keep Queue-owned `ArtifactWriter` for possible future files.** Rejected for the current scope because image generation is its only consumer and DSH already has a durable image store. A hypothetical generic file consumer does not justify a public path-based abstraction.

**Copy the Agent Teams mailbox into Queue delivery.** Rejected because the Session acceptance projection is the repeated invariant. Queue Notification and Team mailbox state remain domain-owned while the pure projection helper is shared.

**Acknowledge owner Notification when it enters an inbox.** Rejected because this proposal defines acknowledgement as durable consumption into `user/message` plus successful Session flush. Pending inbox data prevents duplication but does not prove that the accepted step recorded the message.

**Allow generic reconcile and operator-confirmed success.** Rejected until a WorkKind-specific reconciler can prove live ownership or validate a typed recovered result. Changing an unknown Attempt to running without a `LiveAttempt`, or accepting arbitrary browser JSON as success, invents evidence.

**Put automatic continuation in Queue core.** Rejected because task completion is a fact, while permission to spend another Agent Round belongs to Goal and Session policy.

## Verification

Focused deterministic coverage verifies recovery, shutdown ownership, atomic Batch admission, Batch and resource capacity, owner-fenced Notifications, Session flush before acknowledgement, restart deduplication, explicit typed result reads, Attachment-backed images, and restricted worker composition.

The real `agent.run@1` vertical completed as Work `21e5bb63-f4df-4601-b81a-0ae501606684` with a stable owner Notification and an explicit result containing `QUEUE-V2-OWNER-DELIVERY-OK`. The real ten-image Batch `2cd643c7-1a56-4877-8b1e-fb13215f81e5` completed ten Attachment-backed results with observed concurrency three and no task-worker process used for image generation.

- A clean restart dispatches recovered queued work after its Handler registers.
- Every recovered starting or running Attempt becomes unknown with one durable Attention before new dispatch.
- Graceful and bounded-failure shutdown release Queue ownership only after every active execution is durably terminal or unknown.
- Concurrent duplicate Batch admission produces one receipt and one Batch; `maxParallel`, resource capacity, and global capacity are all enforced.
- Invalid claims and policies fail visibly instead of starving queued work.
- Unknown resolution is limited to confirmed failure or authorized retry; resolution clears its Attention atomically.
- Every terminal owner outcome creates one same-ChangeSet Notification; owner Session flush precedes Notification acknowledgement; restart does not duplicate the stable message.
- The owner can explicitly retrieve the typed result with `task_queue_result`.
- DSH worker diagnostics use `TextRetainer`; image outputs use `ctx.attachments`; generic Queue core owns neither mechanism.
- One real restricted `agent.run@1` WorkItem and one ten-item `image.generate@1` Batch complete through the Queue and their typed handlers without recursive Queue or per-image Agent startup. Typed Consumer admission and final composition are verified deterministically.

## Consequences

Image output through `ctx.attachments` may normalize bytes that a future consumer expects to preserve exactly. Byte-exact original retention remains outside Queue until a current consumer justifies a separate Artifact capability.

The shared Session receipt helper increases the Agent package's public utility API. It remains a pure projection over Session events rather than a second mailbox or delivery service.

Shutdown cannot force an external provider to prove a final outcome. The bounded path therefore increases operator Attention rather than guessing success, failure, or safe retry.

Splitting WorkKind admission adds one package and Bundle row for `agent.run@1`; it removes a concrete cross-domain dependency and gives later WorkKinds an established composition pattern.
