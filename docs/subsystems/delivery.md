# Personal Delivery

English | [中文](delivery.zh.md)

Personal Delivery defines immutable requirements, bounded Packets, repository proofs, evidence references, Queue bindings, verification verdicts, and human decisions. Delivery owns requirement and decision records; Queue owns Work and Attempt lifecycle; Git owns commit and blob facts; evidence storage owns immutable bytes. The local Windows bundle composes the concrete providers, Queue bridge, Remote, and browser workbench. The [`packages/delivery` map](../../packages/delivery/README.md) records each package's responsibility, while the [architecture proposal](../../.agents/notes/proposed/architecture/2026-08-29-personal-delivery-above-queue.md) owns the boundary rationale.

## Public protocol

[`@changanhua/dsh-delivery-protocol`](../../packages/delivery/delivery-protocol/README.md) is a plain Queue-independent library. Every durable object carries `schemaVersion: 2`; opaque ids remain strings, Git commits use full object ids, UTC timestamps use RFC 3339, and content digests use lowercase `sha256:<64 hex>`. Its strict runtime schemas reject unknown fields and invalid discriminated combinations instead of silently normalizing another format.

| Public type | Responsibility |
|---|---|
| `DeliveryCase` | Durable repository-bound requirement identity whose head advances through expected-head compare-and-set revisions |
| `ContractRevision` | Immutable title, human or GitHub-import origin, outcome, repository choice, scope, acceptance clauses, open decisions, base-selection rule, verification source, and references |
| `RequirementDecision` | One human `approved`, `rejected`, or `deferred` authority decision for an exact Case revision |
| `IssuePublication` | Durable prepared, publishing, failed, unknown, or published GitHub Issue side-effect record for one revision |
| `WorkPacket` | One bounded objective pinned to a Contract revision, repository, full base commit, path rules, acceptance ids, stop conditions, executor preference, and Delivery-derived `VerificationPlan` with at least one check |
| `DispatchBinding` | Durable `submitting` or `bound` half of the cross-store Queue admission handshake |
| `CompletionClaim` | `completed`, `blocked`, `needs-decision`, or `needs-scope-change` business output from change execution |
| `VerificationVerdict` | Exact base/target/plan identity, ancestry, check results, path findings, evidence findings, and `passed`, `failed`, or `needs-human-review` status |
| `AcceptanceDecision` | Human-authored `accepted`, `rejected`, or explicit `waived` decision for one target and verdict |
| `EvidenceRef` | Immutable byte length, digest, media/type label, URI, and producing Work/Attempt or verification-check provenance |
| `ResumeCapsuleContent` | Derived handoff content compiled into evidence bytes; it is not another lifecycle record |

The protocol also exports the constants and durable DTOs for `code.change@1` and `code.verify@1`: each kind has an intent, admission-resolved facts, and a successful output. It does not import Task Queue, declare `WorkKindMap`, define prepared live values, or register a handler. [`delivery-task-queue`](../../packages/delivery/delivery-task-queue/README.md) is the only package allowed to add those two declarations to Queue and bind them to runtime handlers.

## Service Definitions

Three abstract Cordis services own the host capabilities. Their definitions contain no local-storage, Git-process, evidence-medium, Queue, Codex, Remote, or UI implementation. The selected local providers implement the named services without changing those boundaries.

| ctx key | Service Definition | Definition package | Local package status |
|---|---|---|---|
| `ctx.delivery` | `Delivery` | [`dsh-delivery`](../../packages/delivery/delivery/README.md) | [`dsh-delivery-local`](../../packages/delivery/delivery-local/README.md): Storage Domain-backed |
| `ctx.repoWorkspace` | `RepositoryWorkspace` | [`dsh-repo-workspace`](../../packages/delivery/repo-workspace/README.md) | [`dsh-repo-workspace-git-local`](../../packages/delivery/repo-workspace-git-local/README.md): local Git/Subprocess |
| `ctx.deliveryEvidence` | `DeliveryEvidence` | [`dsh-delivery-evidence`](../../packages/delivery/delivery-evidence/README.md) | [`dsh-delivery-evidence-local`](../../packages/delivery/delivery-evidence-local/README.md): local content-addressed bytes |

`Delivery` creates and revises Cases, records requirement authority and publication state, derives Packets, begins and binds dispatches, records acceptance decisions, reads individual records, and returns a detached snapshot. `createWorkPacket()` accepts a `VerifiedRepositoryBase` minted by `RepositoryWorkspace.resolveBase()` and no caller-supplied verification plan. Delivery derives a `contract-field` plan inside the provider. For a `git-blob` source, Delivery selects the verified base, Contract-owned path, and fixed complete-byte limit for an operation-local resolver; it validates the returned `VerifiedRepositoryBlob` from `RepositoryWorkspace.readBlob()`, parses the trusted document, and derives the plan provenance and digest. Delivery stores no Queue Attempt, retry state, Git checkout, evidence bytes, or writable UI lane.

`RepositoryWorkspace.resolveBase()` proves the full commit selected by the immutable Contract rule, including a point-in-time ref-head observation. `readBlob()` proves one bounded path and Git blob id at that exact base. `inspectRevision()` re-establishes an already persisted full commit, `inspectRange()` derives ancestry and changed paths, and the two checkout methods return Attempt-owned leases whose cleanup must be awaited. A configured `repositoryId`, not a durable absolute host path, selects the repository.

`DeliveryEvidence.save()` atomically publishes bounded immutable bytes, `resolve()` maps a durable `EvidenceId` to fresh metadata or returns `undefined` when absent, and `read()` validates identity, length, and digest before returning detached bytes. Claims and Verdicts retain evidence ids; a URI or resolved reference never replaces the integrity-checked read. `bind()` fixes Work/Attempt or verification-check provenance before a runner receives a writer.

[`dsh-delivery-testkit`](../../packages/delivery/delivery-testkit/README.md) provides available concrete fakes for all three definitions. The fakes exercise base and blob authority, Packet plan derivation, two-binding acceptance resolution, evidence integrity, and owned checkout lifecycle without importing a local provider.

## Queue and execution boundaries

[`dsh-delivery-task-queue`](../../packages/delivery/delivery-task-queue/README.md) is the only package that augments `WorkKindMap` for `code.change@1` and `code.verify@1`. Its `startCodeChange()` and `startVerification()` helpers derive canonical Queue intent and idempotency keys, commit the Delivery `submitting` binding before enqueue, and bind the returned Queue Work id. Verification admission accepts a Packet and its bound change dispatch, validates the exact successful change Result and Attempt identities, independently proves the checkpoint descends from the Packet base, and derives the target commit and plan digest instead of accepting either from the caller. Plugin activation registers both handlers in staged mode, reconciles durable bindings, then enables claims.

[`dsh-delivery-runner-codex`](../../packages/delivery/delivery-runner-codex/README.md) fixes its typed factory to the supported `@deepseek-ai/dsh-subagent-codex/app-server-run` subpath, runs in an Attempt-owned worktree, reaches process-tree quiescence, and records a governed checkpoint plus evidence. Personal Delivery defines no `ctx.codeExecutors`, executor registry, or public generic executor capability.

[`dsh-delivery-verifier`](../../packages/delivery/delivery-verifier/README.md) executes trusted fixed argv in an independent target checkout, checks the exact repository range and path rules, integrity-reads required evidence, and produces the bounded check evidence and Verdict.

GitHub intake validates the exact public `github.com/{owner}/{repository}/issues/{number}` URL grammar, fetches one explicit snapshot, requires one marked `dsh-delivery-work-brief@1` YAML fence, and idempotently creates or revises a Case without approving it. The Host-only publisher renders one approved ready revision, persists publication intent before its bounded GitHub POST, and never retries an unknown side effect automatically. The typed `delivery` Remote exposes Case shaping, requirement decisions, publication, reconciliation, Packet execution, evidence, and acceptance without browser Queue or credential authority. The browser package uses Cases as its primary records and keeps Issue import and Packet evidence as secondary actions.

## Readiness and acceptance

`contractReadiness()` reports ready only when a revision has an outcome, configured repository, non-empty allowed or forbidden scope, at least one acceptance clause, a base-selection rule, a verification source, and no open decision. The verification source must resolve to a plan with at least one check. Packet creation calls `resolveBase()` and persists the resulting full commit plus the Delivery-derived immutable plan before dispatch. Execution after restart calls `inspectRevision()` on `packet.baseCommit`; it never re-resolves a Contract ref that may have moved.

The dispatch contract writes a deterministic `submitting` binding, operator-enqueues Queue work, and conditionally records the returned Work id as `bound`. Repeating the same canonical input uses the same key. A bound record never changes Queue Work identity.

Acceptance starts from one Packet plus two Delivery-owned bound binding ids: one change and one verification binding for that same Packet. Delivery passes their stored Queue Work ids to a host-only candidate resolver, cross-checks the returned successful Attempt ids, completed Claim, verification intent, and Verdict, then derives every evidence id that an ordinary acceptance must resolve and integrity-read through a second host-only capability. The reserved browser DTO cannot supply a Verdict, actor id, or idempotency key; the single-user host uses `delivery-remote`'s configured `operatorId` (default `local-operator`) as actor and derives requirement-decision identity from bounded content while acceptance retains its explicit decision nonce. Ordinary acceptance requires the exact passed, evidence-complete Verdict. Rejection and explicit human waiver remain distinct decisions.

The `DeliveryCaseLane` view names Shaping, Ready, Running, Review, Blocked, and Accepted as projections over the current Case head, requirement authority, publication state, downstream Packets, and Queue views. Packet lanes and publication phases remain separate derived axes rather than writable durable Case status.

## Failure and recovery contracts

A handler maps a possible side effect followed by lost ownership to Queue `unknown` with Attention and never auto-retries it. Cancellation ownership includes complete process-tree quiescence and awaited workspace disposition. Staged handler activation and durable binding reconciliation prevent recovered queued work from starting before Delivery and Queue agree.

Evidence publication precedes a successful Claim or Verdict. Missing, unresolved, or digest-mismatched evidence blocks ordinary acceptance. `ResumeCapsuleContent` derives from authoritative Contract, Packet, Git, Queue, decision, and evidence facts; raw transcript can be input to a summary but is not authority.

## Scope and limitations

The contract is limited to human or explicit GitHub Issue requirement intake, configured local repository identity, one Host-authorized GitHub Issue publication, Codex change execution, fixed-command independent verification, immutable evidence, and explicit human acceptance. It excludes webhook synchronization, editing an existing Issue after publication, automatic PR creation or merge, quota-triggered launch, value scoring, exact Codex thread resumption, a general artifact platform, Batch/DAG delivery, multi-host leases, teams, RBAC, and multi-tenancy.

The local Windows bundle supplies the complete local composition with repository id `workspace`; GitHub publication stays disabled until Host configuration maps that id to owner/name and a credential reference. Deployments still provide a real Git toplevel as the launch directory, existing Codex authentication, and the base Web profile; remote hosts, Linux deployment, webhook intake, automatic PR/merge, and multi-user authority remain outside this scope.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdelivery--delivery-abstract-seam"></a>

### `ctx.delivery` — `Delivery` (abstract seam)

Durable Personal Delivery records and their idempotent write operations. Providers allocate ids and timestamps, validate protocol objects at the storage boundary, and serialize writes. The service does not persist Queue lifecycle, executor handles, verification bytes, or UI lanes.

Authority boundaries fixed by the version-2 contract: model-facing callers may create and revise Cases and propose Packets, but only human actors record requirement decisions, resolve uncertain publications, and accept delivery outcomes. Every revision must be ready and explicitly approved before Packet creation or Issue publication.

```ts cordis-catalog
/**
 * Atomically create one Delivery Case and its root requirement revision.
 * The root revision carries a `null` `previousRevisionId`, the request's
 * origin and title, and the Case's repository binding.
 * @param request - Repository, origin, title, requirement content, and deterministic idempotency key.
 * @returns the existing pair for a repeated identical request, or the newly committed pair.
 */
abstract createCase(request: CreateDeliveryCaseRequest): Promise<{ case: DeliveryCase; revision: ContractRevision }>

/**
 * Create one child revision and move the Case head atomically under an
 * expected-head compare-and-set. The write fails with `conflict` when the
 * Case head no longer equals `expectedHeadRevisionId`, so concurrent
 * revisions cannot silently branch one Case. A `github-import` child origin
 * must name the same repository and Issue number as its `github-import`
 * parent; `human` origins carry no lineage constraint.
 * @param request - Case, observed head, origin, title, requirement content, and idempotency key.
 * @returns the Case with its advanced head plus the newly committed child revision.
 */
abstract reviseCase(request: ReviseDeliveryCaseRequest): Promise<{ case: DeliveryCase; revision: ContractRevision }>

/**
 * Record the one human requirement decision for an exact Case revision.
 * Repeating identical decision content returns the existing record;
 * different content under the same revision fails closed with
 * `idempotency-conflict`.
 * @param request - Case and revision references, human decision fields, and idempotency key.
 * @returns the existing or newly committed decision.
 */
abstract recordRequirementDecision(request: RecordRequirementDecisionRequest): Promise<RequirementDecision>

/**
 * Create one immutable Packet after the repository provider resolved the Contract base.
 * The revision must belong to a Case, be ready, and carry an `approved`
 * requirement decision; missing approval fails with `approval-required`.
 * @param request - Approved ready revision id, verified base, caller-selected Packet fields, and idempotency key.
 * @param resolveVerificationSource - Host-only Git blob resolver used when the Contract names a blob source.
 * @returns the existing or newly committed Packet.
 */
abstract createWorkPacket( request: CreateWorkPacketRequest, resolveVerificationSource?: VerificationSourceResolver, ): Promise<WorkPacket>

/**
 * Commit the submitting side of one Delivery-to-Queue admission handshake.
 * @param request - Packet, WorkKind, canonical Queue input digest, and idempotency identity.
 * @returns the existing or newly committed submitting binding.
 */
abstract beginDispatch(request: BeginDispatchRequest): Promise<DispatchBinding>

/**
 * Bind a submitting handshake to the one Queue Work id returned for it.
 * @param request - Binding id and returned Queue Work identity.
 * @returns the bound record; repeating the same work id is idempotent.
 */
abstract bindDispatch(request: BindDispatchRequest): Promise<DispatchBinding & { readonly phase: 'bound' }>

/**
 * Record a human decision after resolving Queue facts for two bound dispatches.
 * @param request - Human fields and Delivery-owned change/verification binding ids.
 * @param resolveCandidate - Host-only resolver invoked with the two validated Queue Work ids.
 * @param resolveEvidence - Host-only resolve-and-integrity-read capability invoked for exact evidence ids.
 * @returns the existing or newly committed decision.
 */
abstract recordAcceptanceDecision( request: RecordAcceptanceDecisionRequest, resolveCandidate: AcceptanceCandidateResolver, resolveEvidence: AcceptanceEvidenceResolver, ): Promise<AcceptanceDecision>

/**
 * Commit the first durable publication intent for an approved ready Case
 * revision. A revision owns at most one publication: repeated preparation
 * returns the existing record, a `failed` record is reset to `prepared`
 * under its existing id for a new attempt, and an `unknown` record refuses
 * preparation until human resolution.
 * @param request - Case and revision references, target repository, rendered digest, marker, and idempotency key.
 * @returns the existing, reset, or newly committed publication in phase `prepared`.
 */
abstract prepareIssuePublication(request: PrepareIssuePublicationRequest): Promise<IssuePublication>

/**
 * Move a `prepared` publication to `publishing` before any external
 * request crosses the side-effect boundary. Any other current phase fails
 * closed with `invalid-transition`, so a repeated start can never mask a
 * concurrent attempt.
 * @param publicationId - Durable publication identity.
 * @returns the publication in phase `publishing`.
 */
abstract markIssuePublicationStarted(publicationId: IssuePublicationId): Promise<IssuePublication & { phase: 'publishing' }>

/**
 * Commit the verified GitHub Issue onto a `publishing` record. The
 * transition fails closed unless the record is still `publishing`.
 * @param request - Publication id, expected `publishing` phase, and the validated exact Issue reference.
 * @returns the publication in phase `published` with its Issue binding.
 */
abstract completeIssuePublication(request: CompleteIssuePublicationRequest): Promise<IssuePublication & { phase: 'published' }>

/**
 * Record a truthful failure for a `publishing` record. A `not-started`
 * side effect lands in phase `failed`; an `unknown` side effect lands in
 * phase `unknown` for human resolution and is never retried automatically.
 * @param request - Publication id, expected `publishing` phase, and the classified failure.
 * @returns the publication in phase `failed` or `unknown`.
 */
abstract failIssuePublication(request: FailIssuePublicationRequest): Promise<IssuePublication & { phase: 'failed' | 'unknown' }>

/**
 * Apply a human-authorized resolution to an unresolved publication.
 * `confirm-published` requires the verified exact Issue reference and
 * moves `unknown` or stalled `publishing` records to `published`;
 * `confirm-not-created` requires an explicit verification basis and returns
 * such records to `prepared`. Any other current phase fails closed.
 * @param request - Resolution kind, publication id, and resolution evidence.
 * @returns the resolved publication.
 */
abstract resolveIssuePublication(request: ResolveIssuePublicationRequest): Promise<IssuePublication>

/**
 * Read one durable Delivery Case.
 * @param id - Durable Case identity.
 * @returns the Case or `undefined` when absent.
 */
abstract getCase(id: DeliveryCaseId): DeliveryCase | undefined

/**
 * Read one human requirement decision.
 * @param id - Durable decision identity.
 * @returns the decision or `undefined` when absent.
 */
abstract getRequirementDecision(id: RequirementDecisionId): RequirementDecision | undefined

/**
 * Read one Issue publication.
 * @param id - Durable publication identity.
 * @returns the current publication projection or `undefined` when absent.
 */
abstract getIssuePublication(id: IssuePublicationId): IssuePublication | undefined

/**
 * Read one adopted Contract revision.
 * @param id - Durable revision identity.
 * @returns the revision or `undefined` when absent.
 */
abstract getContractRevision(id: ContractRevisionId): ContractRevision | undefined

/**
 * Read one immutable Packet.
 * @param id - Durable Packet identity.
 * @returns the Packet or `undefined` when absent.
 */
abstract getWorkPacket(id: WorkPacketId): WorkPacket | undefined

/**
 * Read one dispatch handshake.
 * @param id - Durable binding identity.
 * @returns the current binding projection or `undefined` when absent.
 */
abstract getDispatchBinding(id: DispatchBindingId): DispatchBinding | undefined

/**
 * Read a stable fresh snapshot of every Delivery-owned record.
 * @returns committed records in provider-defined stable order.
 */
abstract snapshot(): DeliverySnapshot
```

Source: [`packages/delivery/delivery/src/index.ts`](../../packages/delivery/delivery/src/index.ts)

<a id="ctxdeliveryevidence--deliveryevidence-abstract-seam"></a>

### `ctx.deliveryEvidence` — `DeliveryEvidence` (abstract seam)

Immutable evidence publication and verified reads. Providers derive id, URI, byte length, digest, and creation time; callers supply none of them.

```ts cordis-catalog
/**
 * Publish one immutable byte object atomically.
 * @param input - Kind, media type, bytes, and owning execution provenance.
 * @param signal - Optional cancellation for provider work.
 * @returns the durable reference after the bytes are committed.
 */
abstract save(input: SaveDeliveryEvidence, signal?: AbortSignal): Promise<EvidenceRef>

/**
 * Resolve durable metadata from an Evidence id retained by a Claim, Verdict, or Resume Capsule.
 * @param id - Durable evidence identity.
 * @param signal - Optional cancellation for provider index work.
 * @returns detached immutable metadata, or `undefined` when the object is absent.
 */
abstract resolve(id: EvidenceId, signal?: AbortSignal): Promise<EvidenceRef | undefined>

/**
 * Read one object and verify its identity, length, and digest against the reference.
 * @param ref - Durable reference to verify and read.
 * @param signal - Optional cancellation for provider work.
 * @returns a detached byte copy and the validated reference.
 */
abstract read(ref: EvidenceRef, signal?: AbortSignal): Promise<StoredDeliveryEvidence>

/**
 * Bind one immutable provenance before handing a writer to a runner or verifier.
 * @param provenance - Work/Attempt or verification-check provenance.
* @returns a writer that cannot replace or omit that provenance.
*/
bind(provenance: EvidenceRef['provenance']): BoundDeliveryEvidenceWriter
```

Source: [`packages/delivery/delivery-evidence/src/index.ts`](../../packages/delivery/delivery-evidence/src/index.ts)

<a id="ctxrepoworkspace--repositoryworkspace-abstract-seam"></a>

### `ctx.repoWorkspace` — `RepositoryWorkspace` (abstract seam)

Configured repository resolver and Attempt-owned isolated checkout factory. Inspection performs no checkout or process side effect. Opened leases expose an operation-local absolute cwd and retain ownership until awaited close.

```ts cordis-catalog
/**
 * Resolve a Contract base-selection rule and prove its point-in-time full commit.
 * A `ref-head` result captures the ref value observed by this operation; later
 * ref movement cannot alter the returned proof.
 * @param request - Configured repository, exact Contract rule, and cancellation.
 * @returns a provider-minted immutable base proof.
 */
abstract resolveBase(request: ResolveRepositoryBaseRequest): Promise<VerifiedRepositoryBase>

/**
 * Resolve a configured repository and prove that it contains one full commit.
 * @param request - Stable repository id, full commit, and optional cancellation.
 * @returns an opaque proof safe to pass to Delivery and checkout operations.
 */
abstract inspectRevision(request: InspectRepositoryRevisionRequest): Promise<VerifiedRepositoryRevision>

/**
 * Read and prove one complete bounded blob from an exact verified base tree.
 * Providers resolve `base.commit:path` through Git object storage; a checkout
 * cwd or ambient filesystem path is never authoritative.
 * @param request - Verified base, normalized path, explicit byte limit, and cancellation.
 * @returns exact Git metadata plus fresh detached bytes.
 */
abstract readBlob(request: ReadRepositoryBlobRequest): Promise<VerifiedRepositoryBlob>

/**
 * Derive ancestry and the complete changed-path set for two verified revisions.
 * @param request - Verified base and target in the same repository.
 * @returns ancestry and changed-path facts; non-ancestry resolves as `false`.
 */
abstract inspectRange(request: InspectRepositoryRangeRequest): Promise<RepositoryRangeFacts>

/**
 * Open the writable checkout owned by one change Attempt.
 * @param request - Attempt identity and verified base revision.
 * @returns an idempotently recovered or newly created change lease.
 */
abstract openChange(request: OpenChangeWorkspaceRequest): Promise<ChangeWorkspaceLease>

/**
 * Open an isolated checkout pinned to one verification target.
 * @param request - Attempt identity plus verified base and target revisions.
 * @returns an idempotently recovered or newly created verification lease.
 */
abstract openVerification(request: OpenVerificationWorkspaceRequest): Promise<VerificationWorkspaceLease>
```

Source: [`packages/delivery/repo-workspace/src/index.ts`](../../packages/delivery/repo-workspace/src/index.ts)
<!-- END GENERATED cordis-surface -->
