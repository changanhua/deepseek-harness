# Domain Runtime

[English](domain-runtime.md) | 中文

[domain-runtime 组](../../packages/domain-runtime/README.zh.md) 拥有不可变工件引用与 provider 路由。领域载荷归 provider，本页定义共享语义，不定义中央存储。

## 身份与元数据

`DomainArtifactRef` 包含 `domain`、`kind`、不透明 `id` 与可选 SHA-256 `digest`。FC 引用始终携带 digest；生成 Plan 要求精确的持久 Reality digest。provider 响应必须匹配请求身份，提供的 digest 必须精确匹配。

`DomainArtifactHeader` 包含捕获时的时间戳、覆盖、新鲜度、直接父引用、源引用与有界问题。[schema](../../packages/domain-runtime/domain-runtime/src/schema.ts) 拥有精确类型、逐字段边界与完整 32,768 字节元数据封装上限。descriptor 的 capability 描述 read/plan 操作，不创建无类型调用入口。

## 注册表与生命周期

`ctx.domainArtifacts` 发现每个领域唯一的 provider，路由 header、artifact 与直接父引用读取。重复领域、未知领域、未知 kind 与返回引用不匹配均拒绝。注册随贡献方 Cordis fiber 存活；卸载移除发现与路由，并拒绝该次注册的在途读取结果。返回的元数据和 JSON 载荷与 provider 状态分离。

## FC Reality 与 Plan

`fc27/sbc-reality` 编译已有 MAIN-world read 或语义 probe 证据，本身不调用 MAIN-world 执行。显式字段投影排除未声明的凭据与原始 DOM。库存完整性要求可证明的遍历完成和有效稳定实例身份。现有读取合同不能证明未经筛选的全组遍历，组覆盖保持 partial/unknown。

`fc27/sbc-plan` 从精确的单个 Reality 引用派生，保留 solver 上限、搜索不完整性、临时候选与缺失报价阻塞。它通过 [FC 所有者](../../packages/domain-runtime/fc-sbc-domain/README.zh.md)复用已有纯 FC 算法。它不是 Planning 修改、Safety Approval Artifact 或执行授权。

## 新鲜度与持久化

工件 header 记录不可变的捕获时证据。缺少过期时间时新鲜度未知；`getStatus` 计算当前过期状态，不修改历史工件。FC 所有者在版本 1 的 Storage Domain `fc_sbc_artifacts` 中持久化载荷与幂等回执，验证冷读取，仅在所有者写入成功后发布。通用注册表没有载荷数据库。

## 集成边界

[类型化 FC 工具](../../packages/domain-runtime/tool-fc-sbc-domain/README.zh.md)返回引用与有界摘要。Planning/Thinking 消费方可按已有所有者合同保留外部引用，本组不修改其 schema 或 canonical 状态。报价 provider、批准、Safety 与执行均不在本实现内。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdomainartifacts--domainartifactregistry"></a>

### `ctx.domainArtifacts` — `DomainArtifactRegistry`

Effect-scoped provider registry; no central payload store or action executor.

```ts cordis-catalog
/**
 * Register one domain until its contributing fiber is disposed. Duplicate domains reject.
 * @param provider - Trusted owner that supplies metadata and immutable payload reads.
 * @returns Effect disposer; existing reads reject if this registration is unloaded.
 */
register(provider: DomainRuntimeProvider): () => void

/**
 * Return detached provider descriptions; no owner payload is loaded.
 * @returns The bounded registered domain catalog.
 */
discover(): DomainDescriptor[]

/**
 * Route a metadata-only read, reject mismatched identities, and return a detached header.
 * @param ref - Exact owner, kind and identity; a supplied digest must match.
 * @param signal - Optional lifetime checked before and after the provider read.
 * @returns Owner metadata, or undefined for a missing artifact; unavailable providers reject.
 */
async readHeader(ref: DomainArtifactRef, signal?: AbortSignal): Promise<DomainArtifactHeader | undefined>

/**
 * Route one exact artifact read; validate JSON but never interpret domain payload fields.
 * @param ref - Exact owner, kind and identity; a supplied digest must match.
 * @param signal - Optional lifetime forwarded to the provider.
 * @returns A detached header and payload, or undefined for a missing artifact.
 */
async readArtifact(ref: DomainArtifactRef, signal?: AbortSignal): Promise<DomainArtifactView | undefined>

/**
 * Return direct immutable parent references without recursively loading their payloads.
 * @param ref - Child artifact identity.
 * @param signal - Optional lifetime forwarded to the metadata read.
 * @returns Detached direct parent references, or undefined for a missing child.
 */
async parents(ref: DomainArtifactRef, signal?: AbortSignal): Promise<DomainArtifactRef[] | undefined>
```

Source: [`packages/domain-runtime/domain-runtime/src/index.ts`](../../packages/domain-runtime/domain-runtime/src/index.ts)

<a id="ctxfcsbcdomain--fcsbcdomain"></a>

### `ctx.fcSbcDomain` — `FcSbcDomain`

Typed offline FC capability. It accepts read observations, never external-write callbacks.

```ts cordis-catalog
/**
 * Persist an allowlisted existing read/probe observation and return its immutable reference.
 * @param input - Typed observations, provenance and idempotency request identity.
 * @param signal - Optional cancellation checked before durable publication.
 * @returns The committed immutable Reality reference; changed request reuse rejects.
 */
async captureReality(input: CaptureFcReality, signal?: AbortSignal): Promise<DomainArtifactRef>

/**
 * Freeze existing-solver candidates from an exact persisted Reality; never approve or execute.
 * @param input - Exact Reality reference including digest, request identity and bounded search options.
 * @param signal - Optional cancellation checked before durable publication.
 * @returns The committed immutable Plan reference; identical canonical input reuses the first artifact.
 */
async buildPlan(input: BuildFcPlan, signal?: AbortSignal): Promise<DomainArtifactRef>

/**
 * Read one exact detached owner payload; unknown identity returns undefined.
 * @param ref - Artifact owner, kind, id and optional digest to verify.
 * @param signal - Optional cancellation checked before reading.
 * @returns Detached FC payload and metadata, or undefined for a missing artifact.
 */
async readArtifact(ref: DomainArtifactRef, signal?: AbortSignal): Promise<FcArtifact | undefined>

/**
 * Bounded summary; freshness is evaluated at read time without editing historical artifacts.
 * @param ref - Exact artifact identity.
 * @param signal - Optional cancellation forwarded to the owner read.
 * @returns Bounded status and blockers, or undefined for a missing artifact.
 */
async getStatus(ref: DomainArtifactRef, signal?: AbortSignal): Promise<FcArtifactStatus | undefined>
```

Source: [`packages/domain-runtime/fc-sbc-domain/src/index.ts`](../../packages/domain-runtime/fc-sbc-domain/src/index.ts)
<!-- END GENERATED cordis-surface -->
