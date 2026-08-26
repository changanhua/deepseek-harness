# Agent Note: Task Queue Service Authorization

Status: implemented

English | [中文](2026-08-26-task-queue-service-authorization.zh.md)

## Problem

The task queue originally bound `ownerSessionId` and checked cancel/retry/dismiss ownership only in `dsh-tool-task-queue`. Direct Service consumers could read or mutate any task, model-facing list/status/stats exposed cross-session data, notification acknowledgement accepted any known id, and one global tool idempotency receipt could return another session's task id. Adding checks to individual tools could not make ownership an invariant shared by future consumers.

## Decision

`@deepseek-ai/dsh-task-queue` owns a closed `TaskQueueAccess` union. `taskQueueAgentAccess(sessionId)` mints an opaque Agent grant for one exact session; `TASK_QUEUE_HOST_ACCESS` is the singleton whole-queue grant used by trusted host-plane plugins. Runtime validation accepts only the exact object identities registered when these grants are minted, so copying a grant's enumerable fields does not create another valid grant. Every public operation that admits, reads, counts, notifies, or controls task data requires one of these grants. Executor registration and discovery remain unscoped because they expose deployment capability, not task records.

`LocalTaskQueue` enforces the grant before returning a task or notification and again inside serialized mutations. An Agent grant can see only records whose `ownerSessionId` matches its session; ownerless records require host access. Missing and unauthorized task ids both throw `unknown task <id>`, and missing and unauthorized notification ids both throw `unknown notification <id>`, so an Agent cannot use errors as an existence oracle. List visibility is applied before status/executor/tag filters and `limit`; stats retain global service health but count only visible tasks. Pause and resume require the host grant.

Agent admission overwrites any caller-supplied `ownerSessionId` with the authenticated session. Host admission may preserve an explicit owner or admit an ownerless task. A supplied idempotency key is namespaced by Agent session or host before receipt lookup, so deduplication is stable within one actor but cannot return another actor's task id.

`dsh-tool-task-queue` derives Agent access only from `ToolRunContext.agent.session.id`; a dispatch without an Agent uses host access. Its local ownership check and manual owner injection are removed. `dsh-command-task-queue` and `dsh-task-queue-remote` are explicit trusted host-operator consumers and pass the singleton host grant on every Service call. This decision supersedes the tool-layer-only authorization placement recorded in [the P0 business-closure note](../bug-fix/2026-08-26-task-queue-p0-business-closure.md).

## Alternatives considered

**Keep authorization in the model-facing wrapper.** Rejected because it leaves Service calls, future consumers, read projections, stats, notifications, and idempotency lookup outside the ownership rule. The Service owns task identity and is the first layer that can enforce one rule for all consumers.

**Pass a raw session id to each Service method.** Rejected because a string does not distinguish authenticated Agent authority from host operation and encourages callers to synthesize an owner. The closed grant makes the authority kind explicit and keeps host-only pause/resume visible in the type signature.

**Return a distinct forbidden error.** Rejected because it reveals that the supplied task or notification id exists under another owner. An indistinguishable unknown-record error preserves the same behavior for absent and inaccessible records.

**Use one global idempotency namespace.** Rejected because equal model-supplied keys from different sessions would collide before ownership checks and could disclose a foreign task id. Actor-scoped receipts preserve same-session retry semantics without cross-session aliasing.

## Consequences

- Agent tools list, inspect, count, notify, retry, cancel, dismiss, and undismiss only their own tasks; ownerless and foreign tasks are invisible.
- Trusted command and browser Remote surfaces retain whole-queue operator behavior through an explicit imported grant.
- Direct Service consumers must choose and propagate an access grant. This is an intentional pre-release API break with no compatibility overload.
- Host access is an in-process trust decision, not a user authentication mechanism. Plugins that import the host grant are part of the trusted host plane.
- Authorization tests use the real local backend to cover binding, idempotency isolation, filter-before-limit ordering, read/mutation concealment, scoped stats, notification CAS ownership, and host-only controls. The complete task-queue package test set and repository typecheck cover all migrated consumers.
