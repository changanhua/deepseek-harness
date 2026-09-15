# @changanhua/dsh-task-queue

English | [中文](README.zh.md)

The durable typed-work Queue Service Definition (`ctx.taskQueue`). Concrete work kinds extend `WorkKindMap`; providers register a `WorkHandler` that resolves caller intent, derives retry policy, declares resource claims at admission, prepares dispatch, and synchronously starts a `LiveAttempt`.

Handler registration is immediate by default. A trusted composition may request a staged registration when recovery must use the handler for receipt lookup or admission before dispatch is safe. The returned callable owns that exact registration: `activate()` enables dispatch once, while disposal prevents later activation and removes only that registration.

## Domain model

`WorkItem` is immutable and keeps its title, admission-derived policy and resource claims, tags, optional Batch membership, canonical caller intent, SHA-256 digest, and resolved execution specification separate. `BatchItem` preserves each member's title and tags before the Batch is admitted. `WorkState`, `WorkAttempt`, `WorkResult`, `Batch`, `Attention`, `Notification`, and `Receipt` are independent durable records. `unknown` is non-terminal and blocks another attempt until an operator confirms failure or authorizes retry.

`WorkFailure` always reports `category`, `sideEffect`, `retriable`, and `message`. Automatic retry is permitted only when `retriable` is true and `sideEffect` is `not-started`.

## Durability and idempotency

`ChangeSet { seq, changeId, at, events }` is the only persistence unit. Its `DomainEvent` entries are logical facts committed together; callers cannot persist a lifecycle snapshot. The fold derives WorkState from admission, Attempt, cancellation, retry, and unknown-resolution events. It rejects sequence gaps, duplicate change ids, partial or heterogeneous Batch admission, invalid Attempt ownership or ordinals, mismatched Result ownership or kind, conflicting Receipt records, unsafe automatic retry, and invalid Attention or Notification acknowledgement CAS operations without partially updating the projection.

Callers canonicalize and digest intent before external resolution. A matching idempotency key and digest returns the original Work ids; the same key with another digest is a conflict. Agent receipts are scoped by owner Session. The trusted operator has one separate host namespace; its admissions persist `ownerSessionId: null`, use operator receipts, and never create Session Notifications.

## Authority

The provider verifies initiator identity and passes an opaque `VerifiedAgentAuthority` or `VerifiedOperatorAuthority` to `forAgent()` or `forOperator()`. The Service Definition neither accepts a caller-supplied session id nor exposes a public operator facade. `OperatorWorkQueue.enqueue()` and `enqueueBatch()` are therefore host capabilities, not model or browser authority. Acknowledging an Attention record does not resolve unknown work.

## Model Experience

Indirectly, through model-facing Queue consumers that own tool schemas and result rendering.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- This package defines and folds the domain. A provider owns persistence, resource capacity, scheduling, and crash recovery. Typed WorkKind results may reference bytes owned by another service, such as Attachments; Queue defines no generic path writer.
