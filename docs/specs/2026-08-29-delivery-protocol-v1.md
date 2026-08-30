# Personal Delivery Protocol V1

Status: PR-C0 authority-contract candidate; production providers remain unavailable

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

`SourceRef` identifies one GitHub Issue revision with repository owner/name, Issue number, canonical URL, GitHub `updatedAt`, title/body snapshot, and content digest. Its URL is exactly `https://github.com/{owner}/{repository}/issues/{issueNumber}` and must match those coordinates; credentials, ports, another host or protocol, query, fragment, trailing slash, encoding variants, and coordinate mismatches are invalid. GitHub owns the current Issue; this reference owns the exact snapshot adopted by one Contract revision. The body has exactly one authoritative marker plus YAML fence defined by `dsh-delivery-github-intake`; prose outside that fence remains stored in the snapshot but does not override parsed Contract fields.

### `ContractRevision`

`ContractRevision` contains `sourceRef`, outcome, context, allowed scope, forbidden scope, acceptance clauses, open decisions, base-selection rule, verification source, reference links, and creation time. Manual GitHub intake maps those fields without defaults from the strict `dsh-delivery-work-brief@1` block; the operator separately selects the required configured `repositoryId`, while the host derives source identity, prior revision, timestamps, ids, and idempotency. A non-null prior revision must name the same provider, repository owner/name, and Issue number; another Issue begins a separate lineage. It is ready only when the outcome, repository, scope, at least one acceptance clause, base-selection rule, and non-null verification source exist and `openDecisions` is empty. A Contract-field source contains at least one unique fixed-argv check; a Git-blob source must resolve to a document containing at least one such check before Packet creation.

### `WorkPacket`

`WorkPacket` contains `contractRevisionId`, configured `repositoryId`, full `baseCommit`, one bounded objective, allowed paths, forbidden paths, acceptance-clause ids, a `VerificationPlan`, stop conditions, and an executor preference. At least one allowed or forbidden rule is required. An `exact` rule matches only its path; a `subtree` rule includes its root and slash-delimited descendants. An empty allowlist permits every path not forbidden. Forbidden matching takes precedence over outside-allowlist matching, and one distinct changed path produces at most one finding. Overlapping rules are valid and deterministic under that precedence.

Packet creation asks the trusted repository provider to resolve the Contract's exact repository and base-selection rule. A `ref-head` is captured as the full commit observed at that instant; a commit rule is independently verified. The resulting proof, not a caller-provided commit, supplies the Packet base. A Packet is immutable after its first dispatch intent, and restart opens its persisted exact base revision instead of resolving the original rule again.

The `VerificationPlan` is a resolved immutable non-empty list of named checks. Each check stores an argv array, `.` or a normalized repository-relative working directory, a positive timeout, required/optional severity, and expected exit-code set. Its provenance is either the Contract revision's `verificationSource` field or a Git blob identified by the verified full base commit, repository-relative path, and blob object id; Packet and verification-admission records require those provenance coordinates to match their own Contract revision or base commit. For a blob source, Delivery asks a host-only resolver to integrity-read the exact blob with a 64 KiB complete-byte limit and checks repository/base/path identity. Every provider and Remote adapter then uses Protocol's exported `parseVerificationPlanDocument()` and `resolveVerificationPlan()`; the shared parser rejects a UTF-8 BOM, malformed UTF-8/JSON, extra fields, wrong format, empty checks, and duplicate check ids before deriving provenance and digest. Branch content, Agent-authored command substitution, generic shell strings, and shell command-string argv modes such as `sh -c`, `pwsh -Command`, or `cmd /C` are invalid; direct argv that names a trusted script file is valid. Before spawning a check, the verifier uses `lstat`/`realpath` to prove the physical cwd remains inside the active lease root and rejects symlink traversal outside it.

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

`accepted` requires a matching `passed` verdict. `waived` is the only explicit override and requires a human reason. The record operation accepts only Packet id, the selected change and verification binding ids, decision fields, and host-owned attribution/idempotency fields. Delivery validates that both bindings are bound to that Packet, asks a host-only resolver for the exact successful Queue Work/Attempt results, and derives the claim, verification intent, target, and verdict from those results. No Agent, executor, Queue handler, verifier, GitHub event, browser-provided target, or browser-provided verdict may create or satisfy this record on the user's behalf.

### `EvidenceRef`

`EvidenceRef` contains evidence id, media/type label, URI, byte length, SHA-256 digest, creation time, and provenance. Provenance identifies the Packet plus the producing Queue Work/Attempt or verification check. Evidence bytes are immutable after publication; changing bytes creates another reference.

P0 evidence types are bounded logs, Git diff metadata, patch, checkpoint metadata, verification output, and optional screenshot. Queue stores only typed references, not these bytes. Before acceptance, Delivery asks a host-only resolver to resolve and successfully read every exact evidence id named by the selected claim and verdict, then validates digest-bearing references and provenance against their producing Queue Work and exact Attempt or verification check. Missing, unreadable, mismatched, or unbound evidence denies acceptance.

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

The durable Queue intent contains target and plan identity, but the user/Remote request contains only Packet id and the selected change binding id. Before `beginDispatch`, enqueue, or any other Delivery/Queue mutation, the trusted Bridge resolves the Packet and bound `code.change@1` Work, requires its exact Queue Result and Attempt to be successful, schema-valid, and identity-matched, then derives `targetCommit` from the completed claim and `verificationPlanDigest` from the Packet. It independently inspects both commits and requires the target to descend from the persisted Packet base. Only those derived values are admitted.

The handler verifies in an isolated checkout, compares the complete Git-derived changed-path set against the persisted Packet rules with the Protocol's exported path helpers, captures bounded output, verifies required evidence, and returns a verdict. A check or scope failure is a successful verifier execution with `status: failed`; verifier infrastructure loss is a Queue failure or `unknown`.

## Host and browser authority boundary

Remote exposes explicit operations rather than generic Delivery, Queue, filesystem, or shell authority. A browser may select existing configured or durable references and provide human-authored fields, but it cannot allocate a new durable object id or provide an idempotency key, actor identity, verified repository/base proof, resolved verification plan, verification target, completion claim, or verdict. The host derives keys and attribution, resolves repository and Queue facts through trusted services, and supplies operation-local blob, Queue-result, and evidence-read capabilities that never cross the wire. In P0's single-user deployment, the Remote's trusted host configuration supplies `operatorId` (default `local-operator`) as the human actor seam; `actorId` is not a wire field.

Consequently, Packet creation accepts a Contract revision and bounded Packet draft but derives base and plan; verification start accepts a Packet and change binding but derives target and plan digest; decision recording accepts the Packet, both binding selections, and decision fields but derives target and verdict from the exact bound Queue results. Browser retries remain idempotent because the host reconstructs the same canonical identities.

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
- A restarted Packet opens and inspects its persisted full base commit. It never re-resolves the original `ref-head`, so later ref movement cannot change the authorized checkout, diff, ancestry proof, or verification plan provenance.
- Unknown resolution never confirms success from user-entered JSON. A WorkKind-specific reconciler may later prove a checkpoint/evidence result; P0 instead preserves the worktree and requires explicit failure or duplicate-risk retry handling.
- Verification failure creates review facts and may lead to a new Fix Packet or Resume Capsule. It never rewrites the original Packet, result, or verdict.
- Evidence write failure before publication prevents a successful claim or verdict. Missing evidence after publication blocks acceptance and requires operator attention.

## Gate outcomes and executable protocol

Gate A recorded ownerless operator admission and post-start cancellation safety without weakening current Queue authority. Gate B recorded the extracted parent-free Codex entry running in an explicit worktree with cancellation and process-tree quiescence. The [multi-PR plan](2026-08-29-personal-delivery-multi-pr-plan.md) retains the exact pass conditions and merge topology.

Both gate outcomes permit PR-C0 to publish the TypeScript authority interfaces and unavailable scaffolds. The completed evidence did not justify a Cordis executor registry: PR-C0 publishes no `ctx.codeExecutors` service and freezes the Gate-B-selected explicit-cwd Codex transport as the narrow `@deepseek-ai/dsh-subagent-codex/app-server-run` production subpath consumed by the runner, not as a package-root or browser authority.

PR-C0 local providers remain explicit unavailable boundaries: they perform no durable Delivery write, repository checkout or mutation, evidence publication, Codex run, verification command, intake fetch, host projection, Queue-handler registration, visible UI contribution, or bundle composition. C0 fakes and fixtures exercise the frozen authority contracts; they are not production implementations.
