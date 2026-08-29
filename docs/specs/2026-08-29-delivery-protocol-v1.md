# Personal Delivery Protocol V1

Status: proposed durable semantics; TypeScript API follows Gate A and Gate B

Baseline: `80719bfbb8d8409b1b0b812843ec686fac62f907`

## Scope

This specification freezes the durable meanings shared by Delivery, Queue bridges, Git workspace ownership, verification, GitHub intake, and UI projection. It does not freeze a Cordis executor service or implementation package API. The later protocol package must encode these meanings with runtime schemas, TypeScript types, golden fixtures, and JSON round-trip tests before parallel implementation begins.

The user flow and exclusions are defined by the [MVP contract](2026-08-29-personal-delivery-mvp.md). The [Agent Note](../../.agents/notes/proposed/architecture/2026-08-29-personal-delivery-above-queue.md) owns the architectural rationale.

## Identity and version rules

- Every durable object has an opaque, globally unique id and `schemaVersion: 1`.
- Every timestamp is an RFC 3339 UTC instant.
- Every Git commit is a full object id; abbreviated commits are presentation only.
- Every content digest is lowercase `sha256:<64 hex>` over canonical bytes.
- Durable JSON contains no secret, process handle, host object, Session object, or mutable filesystem path used as authority.
- A reference names an immutable object. Updating GitHub, a plan, or a Packet creates a new revision or object rather than editing a referenced one.
- A configured `repositoryId` locates one local Git repository. The provider resolves its current path and verifies its Git identity; a stored host path never substitutes for that identity.

## Durable objects

### `SourceRef`

`SourceRef` identifies one GitHub Issue revision with repository owner/name, Issue number, canonical URL, GitHub `updatedAt`, title/body snapshot, and content digest. GitHub owns the current Issue; this reference owns the exact snapshot adopted by one Contract revision.

### `ContractRevision`

`ContractRevision` contains `sourceRef`, outcome, context, allowed scope, forbidden scope, acceptance clauses, open decisions, reference links, and creation time. It is ready only when the outcome, repository, scope, at least one acceptance clause, and base-selection rule exist and `openDecisions` is empty.

### `WorkPacket`

`WorkPacket` contains `contractRevisionId`, configured `repositoryId`, full `baseCommit`, one bounded objective, allowed paths, forbidden paths, acceptance-clause ids, a `VerificationPlan`, stop conditions, and an executor preference. Packet creation verifies that the repository contains the base commit. A Packet is immutable after its first dispatch intent.

The `VerificationPlan` is a resolved immutable list of named checks. Each check stores an argv array, a repository-relative working directory, a positive timeout, required/optional severity, and expected exit-code set. Its provenance is either a named Contract revision field or a Git blob identified by full base commit, repository-relative path, and blob object id. The Packet stores the resolved plan, provenance, and plan digest. Shell strings, later branch content, and Agent-authored command substitutions are invalid.

### `DispatchBinding`

`DispatchBinding` owns the cross-store admission handshake for one `code.change@1` or `code.verify@1` submission. It stores Packet id, WorkKind, canonical input digest, deterministic idempotency key, phase (`submitting` or `bound`), nullable Queue Work id, selected executor id when applicable, and timestamps. It stores no duplicate Queue lifecycle state.

Delivery first commits a `submitting` binding, then calls trusted operator enqueue, then conditionally records the returned Work id as `bound`. On activation it retries every `submitting` binding with the same key and input; Queue idempotency returns the original Work id whether the earlier call did not commit or committed before Delivery crashed. A `bound` record resolves its Work directly through Queue `get()`. A missing bound Work is corruption/operator attention and never causes admission under another key. Recovery requires no public Receipt query and no atomic transaction across stores.

### `CompletionClaim`

`CompletionClaim` is the successful business output of `code.change@1`. It contains one disposition, a summary, completed and remaining work, full nullable `checkpointCommit`, changed paths, evidence references, and an optional Resume Capsule reference. The governed runner, not Agent prose, records the commit after executor quiescence, requires a clean checkpoint worktree, derives changed paths from base-to-checkpoint Git facts, and binds commit provenance to the producing Queue Work and Attempt.

Allowed dispositions are:

- `completed`: requires a full checkpoint commit, proof that it descends from the Packet base commit, and at least one matching Git evidence reference;
- `blocked`: requires a blocker and next smallest action;
- `needs-decision`: requires one explicit human question;
- `needs-scope-change`: requires the proposed scope delta and reason.

Only `completed` may start verification. The claim never contains `verified` or `accepted`.

### `VerificationVerdict`

`VerificationVerdict` contains Packet id, target commit, base commit, plan digest, status, ancestry result, per-check command identity and exit result, changed-path findings, evidence-integrity findings, evidence references, verifier version, and completion time. Status is `passed`, `failed`, or `needs-human-review`.

The target commit and plan digest are immutable inputs. `passed` requires target equality with the bound completed claim, base-to-target ancestry, every required check in its expected exit set, no forbidden-path finding, and verified required evidence. Optional-check uncertainty may produce `needs-human-review`; a verdict for another commit or plan cannot satisfy acceptance.

### `AcceptanceDecision`

`AcceptanceDecision` contains Packet id, target commit, verdict id, decision, reason, actor, and time. Decision is `accepted`, `rejected`, or `waived`.

`accepted` requires a matching `passed` verdict. `waived` is the only explicit override and requires a human reason. No Agent, executor, Queue handler, verifier, or GitHub event may create this record on the user's behalf.

### `EvidenceRef`

`EvidenceRef` contains evidence id, media/type label, URI, byte length, SHA-256 digest, creation time, and provenance. Provenance identifies the Packet plus the producing Queue Work/Attempt or verification check. Evidence bytes are immutable after publication; changing bytes creates another reference.

P0 evidence types are bounded logs, Git diff metadata, patch, checkpoint metadata, verification output, and optional screenshot. Queue stores only typed references, not these bytes.

### `ResumeCapsule`

`ResumeCapsule` is a derived evidence object, not another state machine. Its compiled content contains Contract revision, Packet objective, base and checkpoint commits, completed changes, latest Queue Attempt facts, failing checks, decisions, rejected approaches, open questions, known risks, next smallest action, relevant files, and evidence references. Raw transcript is optional input and never the capsule's authority.

## Queue WorkKind drafts

These shapes freeze durable meaning. Gate B uses the existing explicit-cwd app-server transport through a parent-free internal entry; it may not add Session identity to the durable contract merely to satisfy the provider adapter. PR-C0 decides whether that entry remains runner-private or justifies a public capability.

### `code.change@1`

```yaml
intent:
  packetId: opaque-id
resolved:
  packetId: opaque-id
  contractRevisionId: opaque-id
  repositoryId: stable-local-repository-id
  baseCommit: full-git-object-id
  executorId: selected-provider-id
  policyDigest: sha256:...
output:
  completionClaim: CompletionClaim
```

Admission resolves the immutable Contract revision, Packet, repository, base commit, selected executor, resource claim, and effective permission policy. `prepare()` may validate availability and materialize in-memory data but performs no Git or process side effect. `start()` synchronously publishes live ownership; its asynchronous work then creates the Attempt worktree, starts the executor, reaches process-tree quiescence, creates the checkpoint commit when possible, writes evidence, and settles the claim.

Queue `succeeded` means the typed `CompletionClaim` was persisted. Executor infrastructure failure uses Queue failure/unknown semantics instead of manufacturing a business claim.

### `code.verify@1`

```yaml
intent:
  packetId: opaque-id
  targetCommit: full-git-object-id
  verificationPlanDigest: sha256:...
resolved:
  packetId: opaque-id
  contractRevisionId: opaque-id
  repositoryId: stable-local-repository-id
  targetCommit: full-git-object-id
  trustedPlan: resolved-fixed-argv-checks
output:
  verificationVerdict: VerificationVerdict
```

Admission rejects a target commit that differs from `checkpointCommit` in the bound successful `code.change@1` Result and rejects a plan digest that does not match the Packet's resolved trusted plan. It also requires the target to descend from the Packet base commit. The handler verifies in an isolated checkout, compares changed paths against the base commit, captures bounded output, verifies required evidence, and returns a verdict. A check or scope failure is a successful verifier execution with `status: failed`; verifier infrastructure loss is a Queue failure or `unknown`.

## Idempotency

| Operation | Deterministic identity |
| --- | --- |
| Import Issue revision | `github:<owner>/<repo>:issue:<number>:<updatedAt>:<contentDigest>` |
| Create Packet | `delivery:<contractRevisionId>:packet:<packetDigest>` |
| Start code change | `delivery:<packetId>:code.change@1` |
| Verify commit | `delivery:<packetId>:code.verify@1:<targetCommit>:<planDigest>` |
| Record decision | `delivery:<packetId>:decision:<targetCommit>:<decisionNonce>` |

The same identity and canonical input return the prior object or Queue receipt. The same identity with different canonical input fails as an idempotency conflict. Browser double-clicks, transport retries, repeated imports, duplicate webhooks, and a crash between Queue admission and binding may not create duplicate logical work.

## Projection rules

Delivery UI derives lanes instead of persisting a mutable `status`:

| Lane | Derivation |
| --- | --- |
| Ready | Ready Packet exists and no change Work is bound. |
| Running | A binding is `submitting`, or its change/verification Work is `queued`, `starting`, or `running`. |
| Review | A completed claim exists and verification or human decision is pending. |
| Blocked | Claim requests input/scope, Queue is `unknown`/failed, or verification is not passed. |
| Accepted | Latest matching human decision is `accepted` or `waived`. |

A later Contract revision does not silently move or invalidate a running Packet. The UI shows the revision difference and asks the user to keep, supersede, or create another Packet.

## Failure, cancellation, and recovery

- `not-started` failures may use the persisted Queue retry policy; failures with `started` or `unknown` side effects do not auto-retry.
- Cancellation requests propagate to the worktree/executor owner and wait for whole-tree quiescence. Timeout or cancellation uncertainty settles as Queue `unknown` with Attention.
- A restart converts stranded Queue `starting` or `running` Attempts to `unknown`. Delivery rebuilds its projection from persisted bindings and Queue views; it does not replay missed events as authority.
- A restart resumes each `submitting` binding by repeating operator enqueue with its stored key and digest, then records the returned Work id. A `bound` binding never submits again merely because an event was missed.
- Unknown resolution never confirms success from user-entered JSON. A WorkKind-specific reconciler may later prove a checkpoint/evidence result; P0 instead preserves the worktree and requires explicit failure or duplicate-risk retry handling.
- Verification failure creates review facts and may lead to a new Fix Packet or Resume Capsule. It never rewrites the original Packet, result, or verdict.
- Evidence write failure before publication prevents a successful claim or verdict. Missing evidence after publication blocks acceptance and requires operator attention.

## Gates before executable protocol

Gate A must prove ownerless operator admission and post-start cancellation safety without weakening current Queue authority. Gate B has confirmed that `CodexRunSpec` already accepts explicit cwd and that Parent Agent coupling belongs to the provider adapter; it must still prove the extracted parent-free entry in an explicit worktree with cancellation and process-tree quiescence. The [multi-PR plan](2026-08-29-personal-delivery-multi-pr-plan.md) defines the exact pass conditions.

Only after both gates pass may the contract/scaffold PR publish TypeScript interfaces. PR-C0 publishes a Cordis executor capability only if the completed evidence and another concrete consumer/provider justify it; otherwise the extracted Codex entry remains an internal runner dependency.
