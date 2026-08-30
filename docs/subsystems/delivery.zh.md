# Personal Delivery

[English](delivery.md) | 中文

Personal Delivery 定义不可变需求、有界 Packet、repository proof、evidence reference、Queue binding、verification verdict 和人工决定。Delivery 拥有需求与决定 record；Queue 拥有 Work 与 Attempt lifecycle；Git 拥有 commit 与 blob fact；evidence storage 拥有不可变字节。本地 Windows bundle 组合具体 provider、Queue bridge、Remote 与浏览器 workbench。[`packages/delivery` map](../../packages/delivery/README.zh.md)记录每个包的职责，[架构提议](../../.agents/notes/proposed/architecture/2026-08-29-personal-delivery-above-queue.zh.md)则拥有边界理由。

## Public protocol

[`@deepseek-ai/dsh-delivery-protocol`](../../packages/delivery/delivery-protocol/README.zh.md) 是普通且 Queue 无关的 library。每个持久对象都携带 `schemaVersion: 1`；opaque id 保持字符串，Git commit 使用完整 object id，UTC timestamp 使用 RFC 3339，content digest 使用小写 `sha256:<64 hex>`。它的严格运行时 schema 会拒绝未知字段和非法 discriminated combination，而不是静默规范化另一种格式。

| Public type | 职责 |
|---|---|
| `SourceRef` | 精确记录已采纳 GitHub Issue 的 owner/name、number、URL、更新时间、title/body snapshot 和 content digest |
| `ContractRevision` | 不可变 outcome、repository 选择、scope、acceptance clause、open decision、base-selection rule、verification source 和 reference |
| `WorkPacket` | 绑定到一个 Contract revision、repository、完整 base commit、path rule、acceptance id、stop condition、executor preference 和 Delivery 派生 `VerificationPlan` 的有界 objective；plan 至少有一项 check |
| `DispatchBinding` | 跨 store Queue admission handshake 的持久 `submitting` 或 `bound` 一半 |
| `CompletionClaim` | change execution 产生的 `completed`、`blocked`、`needs-decision` 或 `needs-scope-change` 业务输出 |
| `VerificationVerdict` | 精确 base/target/plan identity、ancestry、check result、path finding、evidence finding 以及 `passed`、`failed` 或 `needs-human-review` status |
| `AcceptanceDecision` | 人工针对一个 target 与 verdict 编写的 `accepted`、`rejected` 或显式 `waived` 决定 |
| `EvidenceRef` | 不可变 byte length、digest、media/type label、URI，以及生成它的 Work/Attempt 或 verification-check provenance |
| `ResumeCapsuleContent` | 编译成 evidence 字节的派生交接内容；它不是另一条 lifecycle record |

Protocol 还导出 `code.change@1` 和 `code.verify@1` 的常量与持久 DTO：每个 kind 都有 intent、admission-resolved fact 和成功输出。它不导入 Task Queue、不声明 `WorkKindMap`、不定义 prepared live value，也不注册 handler。[`delivery-task-queue`](../../packages/delivery/delivery-task-queue/README.zh.md) 是唯一允许把这两个声明加入 Queue 并绑定到运行时 handler 的包。

## Service Definition

三个抽象 Cordis service 拥有 host capability。它们的 definition 不包含 local-storage、Git-process、evidence-medium、Queue、Codex、Remote 或 UI implementation。选定的本地 provider 实现具名 service，但不改变这些边界。

| ctx key | Service Definition | Definition package | 本地包状态 |
|---|---|---|---|
| `ctx.delivery` | `Delivery` | [`dsh-delivery`](../../packages/delivery/delivery/README.zh.md) | [`dsh-delivery-local`](../../packages/delivery/delivery-local/README.zh.md)：Storage Domain-backed |
| `ctx.repoWorkspace` | `RepositoryWorkspace` | [`dsh-repo-workspace`](../../packages/delivery/repo-workspace/README.zh.md) | [`dsh-repo-workspace-git-local`](../../packages/delivery/repo-workspace-git-local/README.zh.md)：本地 Git/Subprocess |
| `ctx.deliveryEvidence` | `DeliveryEvidence` | [`dsh-delivery-evidence`](../../packages/delivery/delivery-evidence/README.zh.md) | [`dsh-delivery-evidence-local`](../../packages/delivery/delivery-evidence-local/README.zh.md)：本地 content-addressed bytes |

`Delivery` 采纳 Contract revision、派生 Packet、开始并绑定 dispatch、记录人工决定、读取单条 Contract/Packet/binding record，并返回 detached snapshot。`createWorkPacket()` 接受由 `RepositoryWorkspace.resolveBase()` 铸造的 `VerifiedRepositoryBase`，不接受 caller 提供的 verification plan。Delivery 在 provider 内部派生 `contract-field` plan。对 `git-blob` source，Delivery 为 operation-local resolver 选择已验证 base、Contract 拥有的 path 与固定完整字节上限；它验证 `RepositoryWorkspace.readBlob()` 返回的 `VerifiedRepositoryBlob`、解析可信文档，并自行派生 plan provenance 与 digest。Delivery 不存储 Queue Attempt、retry state、Git checkout、evidence 字节或可写 UI lane。

`RepositoryWorkspace.resolveBase()` 证明不可变 Contract rule 选中的完整 commit，包括对 ref-head 的时点观测。`readBlob()` 证明该精确 base 上一个有界 path 与 Git blob id。`inspectRevision()` 重新建立已持久完整 commit 的证明，`inspectRange()` 派生 ancestry 与 changed path，两个 checkout method 则返回 Attempt 拥有且必须等待 cleanup 的 lease。repository 由配置的 `repositoryId` 选择，而不是持久绝对 host path。

`DeliveryEvidence.save()` 原子发布有界不可变字节，`resolve()` 把持久 `EvidenceId` 映射为新鲜 metadata，对缺失对象返回 `undefined`，`read()` 在返回 detached 字节前验证 identity、length 和 digest。Claim 与 Verdict 保留 evidence id；URI 或已解析 reference 绝不替代经完整性校验的读取。`bind()` 在 runner 获得 writer 前固定 Work/Attempt 或 verification-check provenance。

[`dsh-delivery-testkit`](../../packages/delivery/delivery-testkit/README.zh.md) 为三个 definition 提供可用的具体 fake。这些 fake 不导入本地 provider，便可覆盖 base/blob authority、Packet plan 派生、两条 binding 的验收解析、evidence 完整性与自有 checkout lifecycle。

## Queue 与执行边界

[`dsh-delivery-task-queue`](../../packages/delivery/delivery-task-queue/README.zh.md) 是唯一为 `code.change@1` 与 `code.verify@1` 扩展 `WorkKindMap` 的包。它的 `startCodeChange()` 与 `startVerification()` helper 派生规范 Queue intent 与 idempotency key，在 enqueue 前提交 Delivery `submitting` binding，再绑定返回的 Queue Work id。Verification admission 只接受 Packet 及其已绑定 change dispatch，它验证精确成功的 change Result 与 Attempt identity，独立证明 checkpoint 是 Packet base 的 descendant，并自行派生 target commit 与 plan digest，不从 caller 接收两者。Plugin activation 以 staged mode 注册两个 handler，协调持久 binding 后才允许 claim。

[`dsh-delivery-runner-codex`](../../packages/delivery/delivery-runner-codex/README.zh.md) 把类型化 factory 固定到受支持的 `@deepseek-ai/dsh-subagent-codex/app-server-run` 子路径，在 Attempt-owned worktree 中运行，等待完整 process-tree quiescence，并记录受治理的 checkpoint 与 evidence。Personal Delivery 不定义 `ctx.codeExecutors`、executor registry 或 public generic executor capability。

[`dsh-delivery-verifier`](../../packages/delivery/delivery-verifier/README.zh.md) 在独立 target checkout 中执行可信 fixed argv，检查精确 repository range 与 path rule，完整性读取必需 evidence，并生成有界 check evidence 与 Verdict。

GitHub intake 校验精确的公开 `github.com/{owner}/{repository}/issues/{number}` URL 语法，抓取一次显式 snapshot，要求一个带标记的 `dsh-delivery-work-brief@1` YAML fence，并幂等采纳不可变 revision。类型化 `delivery` Remote 提供 projection 以及 import、Packet creation、change start、verification start、evidence read 与人工 decision operation，但不授予浏览器 Queue authority。浏览器包渲染五个派生 lane，Personal Delivery bundle 则激活完整本地链路。

## Readiness 与验收

`contractReadiness()` 仅在 revision 包含 outcome、已配置 repository、非空 allowed 或 forbidden scope、至少一项 acceptance clause、base-selection rule、verification source 且没有 open decision 时报告 ready。Verification source 必须解析为至少含一项 check 的 plan。Packet creation 调用 `resolveBase()`，并在 dispatch 前持久其返回的完整 commit 与 Delivery 派生的不可变 plan。执行在重启后对 `packet.baseCommit` 调用 `inspectRevision()`；它绝不重新解析可能已移动的 Contract ref。

Dispatch 约定写入确定性 `submitting` binding、由 operator enqueue Queue work，然后有条件地把返回的 Work id 记录为 `bound`。重复同一 canonical input 会使用同一 key。已绑定 record 绝不更换 Queue Work identity。

验收从一个 Packet 加两个 Delivery 拥有的 bound binding id 开始：同一 Packet 的一个 change binding 和一个 verification binding。Delivery 把其存储的 Queue Work id 交给 host-only candidate resolver，交叉校验返回的成功 Attempt id、completed Claim、verification intent 和 Verdict，再自行派生普通 acceptance 必须通过第二个 host-only capability 解析并完整性读取的每个 evidence id。保留的浏览器 DTO 不能提供 Verdict、actor id 或 idempotency key；单用户 host 使用 `delivery-remote` 配置的 `operatorId`（默认 `local-operator`）作为 actor，并根据所选 target 与 decision nonce 派生 key。普通 acceptance 需要精确匹配、passed 且 evidence 完整的 Verdict。Rejection 与显式人工 waiver 仍是不同决定。

`DeliveryLane` view 把 Ready、Running、Review、Blocked 和 Accepted 命名为不可变 Delivery record 与 Queue view 上的 projection，而不是可写持久 state。Delivery workbench 渲染这些 projection，并且只调用狭窄 Remote operation。

## Failure 与 recovery 约定

Handler 会把可能已产生 side effect 却失去 ownership 的情况映射为带 Attention 的 Queue `unknown`，且绝不自动重试。Cancellation ownership 包括完整 process-tree quiescence 与等待 workspace disposition。Staged handler activation 与持久 binding reconciliation 会阻止恢复的 queued work 在 Delivery 与 Queue 达成一致前启动。

Evidence publication 先于成功 Claim 或 Verdict。缺失、无法解析或 digest 不匹配的 evidence 会阻止普通 acceptance。`ResumeCapsuleContent` 派生自权威 Contract、Packet、Git、Queue、decision 和 evidence fact；raw transcript 可作为 summary 输入，但不是 authority。

## Scope 与 limitation

这套约定仅覆盖显式 GitHub Issue URL 接入、已配置本地 repository identity、Codex change execution、fixed-command independent verification、不可变 evidence 和显式人工 acceptance。它排除 GitHub webhook synchronization 和 write-back、自动 PR 创建或 merge、quota-triggered launch、value scoring、精确 Codex thread resume、general artifact platform、Batch/DAG delivery、multi-host lease、team、RBAC 和 multi-tenancy。

本地 Windows bundle 提供完整 P0 composition。部署仍需把真实 Git toplevel 作为启动目录、使用现有 Codex authentication，并叠加 base Web profile；remote host、Linux 部署、webhook intake、自动 PR/merge 与 multi-user authority 仍不在本范围内。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
