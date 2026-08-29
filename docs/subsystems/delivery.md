# Personal Delivery

English | [中文](delivery.zh.md)

The available Personal Delivery foundation defines immutable requirements, bounded Packets, repository proofs, evidence references, Queue bindings, verification verdicts, and human decisions. Delivery owns requirement and decision records; Queue owns Work and Attempt lifecycle; Git owns commit and blob facts; evidence storage owns immutable bytes. The local providers and product integrations remain fail-closed or empty, so this surface does not currently provide an end-to-end workbench. The [`packages/delivery` map](../../packages/delivery/README.md) records each package's exact availability, while the [architecture proposal](../../.agents/notes/proposed/architecture/2026-08-29-personal-delivery-above-queue.md) owns the boundary rationale.

## Public protocol

[`@deepseek-ai/dsh-delivery-protocol`](../../packages/delivery/delivery-protocol/README.md) is a plain Queue-independent library. Every durable object carries `schemaVersion: 1`; opaque ids remain strings, Git commits use full object ids, UTC timestamps use RFC 3339, and content digests use lowercase `sha256:<64 hex>`. Its strict runtime schemas reject unknown fields and invalid discriminated combinations instead of silently normalizing another format.

| Public type | Responsibility |
|---|---|
| `SourceRef` | Exact adopted GitHub Issue owner/name, number, URL, update instant, title/body snapshot, and content digest |
| `ContractRevision` | Immutable outcome, repository choice, scope, acceptance clauses, open decisions, base-selection rule, verification source, and references |
| `WorkPacket` | One bounded objective pinned to a Contract revision, repository, full base commit, path rules, acceptance ids, stop conditions, executor preference, and Delivery-derived `VerificationPlan` with at least one check |
| `DispatchBinding` | Durable `submitting` or `bound` half of the cross-store Queue admission handshake |
| `CompletionClaim` | `completed`, `blocked`, `needs-decision`, or `needs-scope-change` business output from change execution |
| `VerificationVerdict` | Exact base/target/plan identity, ancestry, check results, path findings, evidence findings, and `passed`, `failed`, or `needs-human-review` status |
| `AcceptanceDecision` | Human-authored `accepted`, `rejected`, or explicit `waived` decision for one target and verdict |
| `EvidenceRef` | Immutable byte length, digest, media/type label, URI, and producing Work/Attempt or verification-check provenance |
| `ResumeCapsuleContent` | Derived handoff content compiled into evidence bytes; it is not another lifecycle record |

The protocol also exports the constants and durable DTOs for `code.change@1` and `code.verify@1`: each kind has an intent, admission-resolved facts, and a successful output. It does not import Task Queue, declare `WorkKindMap`, define prepared live values, or register a handler. [`delivery-task-queue`](../../packages/delivery/delivery-task-queue/README.md) is the only package allowed to add those two declarations to Queue and bind them to runtime handlers.

## Service Definitions

Three abstract Cordis services own the host capabilities. Their definitions contain no local-storage, Git-process, evidence-medium, Queue, Codex, Remote, or UI implementation. Each reserved local provider mounts the named service but rejects operations with an explicit unavailable classification.

| ctx key | Service Definition | Definition package | Local package status |
|---|---|---|---|
| `ctx.delivery` | `Delivery` | [`dsh-delivery`](../../packages/delivery/delivery/README.md) | [`dsh-delivery-local`](../../packages/delivery/delivery-local/README.md): unavailable |
| `ctx.repoWorkspace` | `RepositoryWorkspace` | [`dsh-repo-workspace`](../../packages/delivery/repo-workspace/README.md) | [`dsh-repo-workspace-git-local`](../../packages/delivery/repo-workspace-git-local/README.md): unavailable |
| `ctx.deliveryEvidence` | `DeliveryEvidence` | [`dsh-delivery-evidence`](../../packages/delivery/delivery-evidence/README.md) | [`dsh-delivery-evidence-local`](../../packages/delivery/delivery-evidence-local/README.md): unavailable |

`Delivery` adopts Contract revisions, derives Packets, begins and binds dispatches, records human decisions, reads individual Contract/Packet/binding records, and returns a detached snapshot. `createWorkPacket()` accepts a `VerifiedRepositoryBase` minted by `RepositoryWorkspace.resolveBase()` and no caller-supplied verification plan. Delivery derives a `contract-field` plan inside the provider. For a `git-blob` source, Delivery selects the verified base, Contract-owned path, and fixed complete-byte limit for an operation-local resolver; it validates the returned `VerifiedRepositoryBlob` from `RepositoryWorkspace.readBlob()`, parses the trusted document, and derives the plan provenance and digest. Delivery stores no Queue Attempt, retry state, Git checkout, evidence bytes, or writable UI lane.

`RepositoryWorkspace.resolveBase()` proves the full commit selected by the immutable Contract rule, including a point-in-time ref-head observation. `readBlob()` proves one bounded path and Git blob id at that exact base. `inspectRevision()` re-establishes an already persisted full commit, `inspectRange()` derives ancestry and changed paths, and the two checkout methods return Attempt-owned leases whose cleanup must be awaited. A configured `repositoryId`, not a durable absolute host path, selects the repository.

`DeliveryEvidence.save()` atomically publishes bounded immutable bytes, `resolve()` maps a durable `EvidenceId` to fresh metadata or returns `undefined` when absent, and `read()` validates identity, length, and digest before returning detached bytes. Claims and Verdicts retain evidence ids; a URI or resolved reference never replaces the integrity-checked read. `bind()` fixes Work/Attempt or verification-check provenance before a runner receives a writer.

[`dsh-delivery-testkit`](../../packages/delivery/delivery-testkit/README.md) provides available concrete fakes for all three definitions. The fakes exercise base and blob authority, Packet plan derivation, two-binding acceptance resolution, evidence integrity, and owned checkout lifecycle without importing a local provider.

## Queue and execution boundaries

[`dsh-delivery-task-queue`](../../packages/delivery/delivery-task-queue/README.md) is the only package that augments `WorkKindMap` for `code.change@1` and `code.verify@1`. Its pure `startCodeChange()` and `startVerification()` admission helpers are available: they derive canonical Queue intent and idempotency keys, commit the Delivery `submitting` binding before enqueue, and bind the returned Queue Work id. Verification admission accepts a Packet and its bound change dispatch, validates the exact successful change Result and Attempt identities, independently proves the claimed checkpoint descends from the Packet base, and derives the target commit and plan digest instead of accepting either from the caller. The plugin `apply()` remains unavailable and registers no WorkHandler.

[`dsh-delivery-runner-codex`](../../packages/delivery/delivery-runner-codex/README.md) fixes its typed factory to the supported `@deepseek-ai/dsh-subagent-codex/app-server-run` subpath, but its returned run rejects with the package's unavailable error before starting code work. Personal Delivery defines no `ctx.codeExecutors`, executor registry, or public generic executor capability.

[`dsh-delivery-verifier`](../../packages/delivery/delivery-verifier/README.md) reserves the typed operation-local inputs for fixed argv, exact range inspection, an independent target checkout, evidence resolution/reads, and check-bound evidence writers. Its returned run also rejects as unavailable; no check or Verdict is produced.

GitHub intake validates the exact public `github.com/{owner}/{repository}/issues/{number}` URL grammar. Its available parser requires one marked `dsh-delivery-work-brief@1` YAML fence and maps every explicitly authored Contract field without defaults; the published golden fixture is the template. Network snapshot import and adoption reject as unavailable. The six typed `delivery` Remote methods all reject as unavailable. The browser package registers no slot, locale, Remote call, subscription, or visible component, and the Personal Delivery bundle patch activates no row.

## Readiness and acceptance

`contractReadiness()` reports ready only when a revision has an outcome, configured repository, non-empty allowed or forbidden scope, at least one acceptance clause, a base-selection rule, a verification source, and no open decision. The verification source must resolve to a plan with at least one check. Packet creation calls `resolveBase()` and persists the resulting full commit plus the Delivery-derived immutable plan before dispatch. Execution after restart calls `inspectRevision()` on `packet.baseCommit`; it never re-resolves a Contract ref that may have moved.

The dispatch contract writes a deterministic `submitting` binding, operator-enqueues Queue work, and conditionally records the returned Work id as `bound`. Repeating the same canonical input uses the same key. A bound record never changes Queue Work identity.

Acceptance starts from one Packet plus two Delivery-owned bound binding ids: one change and one verification binding for that same Packet. Delivery passes their stored Queue Work ids to a host-only candidate resolver, cross-checks the returned successful Attempt ids, completed Claim, verification intent, and Verdict, then derives every evidence id that an ordinary acceptance must resolve and integrity-read through a second host-only capability. The reserved browser DTO cannot supply a Verdict, actor id, or idempotency key; the single-user host uses `delivery-remote`'s configured `operatorId` (default `local-operator`) as actor and derives the key from the selected target plus decision nonce. Ordinary acceptance requires the exact passed, evidence-complete Verdict. Rejection and explicit human waiver remain distinct decisions.

The reserved `DeliveryLane` view names Ready, Running, Review, Blocked, and Accepted as projections over immutable Delivery records and Queue views, not writable durable states. No current UI computes or renders them.

## Failure and recovery contracts

A concrete handler must map a possible side effect followed by lost ownership to Queue `unknown` with Attention and must not auto-retry it. Cancellation ownership includes complete process-tree quiescence and awaited workspace disposition. These contracts are represented by the Queue and workspace types, but the unavailable handlers and local workspace provider do not yet exercise them in a product composition.

Evidence publication precedes a successful Claim or Verdict. Missing, unresolved, or digest-mismatched evidence blocks ordinary acceptance. `ResumeCapsuleContent` derives from authoritative Contract, Packet, Git, Queue, decision, and evidence facts; raw transcript can be input to a summary but is not authority.

## Scope and limitations

The contract is limited to explicit GitHub Issue URL intake, configured local repository identity, Codex change execution, fixed-command independent verification, immutable evidence, and explicit human acceptance. It excludes GitHub webhook synchronization and write-back, automatic PR creation or merge, quota-triggered launch, value scoring, exact Codex thread resumption, a general artifact platform, Batch/DAG delivery, multi-host leases, teams, RBAC, and multi-tenancy.

Only the Protocol, Service Definitions, test fakes, Queue declarations, and pure admission helpers are usable here. A runnable product still lacks all three concrete local providers, Queue handlers, Codex execution, verification, Issue snapshot adoption, Remote projection and actions, visible client workbench, and non-empty bundle composition.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdelivery--delivery-abstract-seam"></a>

### `ctx.delivery` — `Delivery` (abstract seam)

Durable Personal Delivery records and their idempotent write operations. Providers allocate ids and timestamps, validate protocol objects at the storage boundary, and serialize writes. The service does not persist Queue lifecycle, executor handles, verification bytes, or UI lanes.

```ts cordis-catalog
/**
 * Adopt one exact source snapshot as an immutable Contract revision.
 * @param request - Source, interpreted revision, and deterministic idempotency key.
 * @returns the existing or newly committed revision.
 */
abstract adoptContractRevision(request: AdoptContractRevisionRequest): Promise<ContractRevision>

/**
 * Create one immutable Packet after the repository provider resolved the Contract base.
 * @param request - Ready Contract id, verified base, caller-selected Packet fields, and idempotency key.
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
