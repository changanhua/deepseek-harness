# 跨会话持久任务队列

[English](task-queue.md) | 中文

host 平面的 typed work queue（`ctx.taskQueue`）。契约包是 [`dsh-task-queue`](../../packages/task-queue/task-queue/README.zh.md)，持久 Provider 是 [`dsh-task-queue-local`](../../packages/task-queue/task-queue-local/README.zh.md)，通用模型工具集是 [`dsh-tool-task-queue`](../../packages/task-queue/tool-task-queue/README.zh.md)。

## Service

`ctx.taskQueue` 是由 `LocalTaskQueue`（`@deepseek-ai/dsh-task-queue-local`）实现的抽象 `TaskQueue` seam。Agent 与 operator facade 需要 verified authority。`WorkHandler` 解析不可变 admission facts、推导重试 policy、声明资源、准备 dispatch，并同步返回 `LiveAttempt`；Provider 持久化准入时的 policy 和 claims，再持有持久 scheduling 与 attempt settlement。

## Work 模型与状态机

`WorkItem` 存储 caller intent 与 resolved facts。`WorkState` 从原子 `ChangeSet` event-derived：`queued`、`starting`、`running`、`unknown`、`succeeded`、`failed` 或 `canceled`。handler 可开始 side effect 前必须先持久化 `attempt/started`；crash 后无法证明的 outcome 变为 `unknown`。operator 可以确认失败或授权另一次 Attempt，但不能确认未经验证的成功。

## 持久 store

schema-v3 root 包含 `manifest.json`、append-only `active.jsonl`、digest-checked `snapshot.json` 与独占 owner lock。Provider 会拒绝其他 schema 版本。启动时会在派发前把每个 stranded `starting` 或 `running` Attempt 记录为带 pending Attention 的 `unknown`；关闭时会持有 root lock，直到 active execution 已结算或记录为 unknown。`ChangeSet` folding 是 fail-closed。Queue 持久化 typed JSON result；字节存储属于 `ctx.attachments` 等服务，而不是 Queue 本地路径写入器。

## 调度

Handler 声明 `ResourceClaim`，准入会针对部署 `resourceCapacity` 校验并记录到每个 WorkItem。全局 `maxConcurrent`、持久化 claims 与 Batch `maxParallel` 限制派发。`pause()` 只影响新派发。shipped image handler 是 `image.generate@1`；`agent.run@1` 是受限 DSH worker handler；`operation.run@1` 占用 `operation-run` capacity。

## Host operation

`operation.run@1` 将一个 host-configured operation definition bridge 为持久 work。准入只接收 `operationId`；Bridge 解析封闭的 host allowlist，并将 operation id、revision、argv、working directory、resource claim、retry policy、output limits 与 timing limits 持久化为 immutable facts。它通过 `ctx.subprocess` 启动已解析的 argv，保留有界 output，并且只会在 subprocess tree quiescence 后结算；cancellation 与 timeout 都会终止该树。

Operation definition 是受信任的部署配置，且必须无秘密。Bridge 会把 credential-shaped 字段和常见 argv carrier 结构作为纵深防御予以拒绝；有限 host allowlist 仍负责评审不透明位置文本，需要凭据的工作属于 domain-specific WorkKind。

`dsh-tool-operation-run-task-queue` 向实时 Agent Session 提供 `operation_run_enqueue` 与 `operation_run_enqueue_batch`，只返回持久 Work id。通用 Queue tools 仍持有 result 读取与 owner Notification 投递，因此 execution output 仅经由通用 result path 抵达 owner。Bridge 和 Consumer 是 CLI 可解析的 package，但 base bundle 默认不挂载二者。

operation work 是 host allowlisted subprocess bridge，不是 `agent.run@1` 的受限 DSH executor、Skill invocation 或 Workflow orchestration；这些机制保留各自的 configuration 与 lifecycle。

## 模型工具与投递

WorkKind 专属 Consumer 持有准入 schema：`dsh-tool-agent-run-task-queue` 准入 `agent.run@1`，`dsh-tool-image-generation-task-queue` 准入 `image.generate@1`，`dsh-tool-operation-run-task-queue` 准入 `operation.run@1`。通用 `dsh-tool-task-queue` 保持 WorkKind 无关，并持有列表、取消、显式 typed result 读取与 replay-safe owner Notification 投递。terminal Notification 只包含稳定 metadata 与 Result id，绝不包含 executor 输出。owner Session 仅在消息持久 flush 后确认它。

图片 result 包含通过 `ctx.attachments` 生成的 Attachment reference；Queue 不复制或重新解释图片字节。当前实现不提供自动 Goal continuation、byte-exact 通用 artifact 存储、operator 确认 unknown work 成功或多宿主调度。

## 事件

`task-queue/changed` 只在完整 `ChangeSet` 持久化并 folding 后发布。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctximagegeneration--imagegeneration"></a>

### `ctx.imageGeneration` — `ImageGeneration`

Shared provider registry and two-phase image generation dispatcher.

```ts cordis-catalog
/**
 * Register one provider for the calling fiber's lifetime.
 * Throws {@link ImageGenerationError} with
 * `IMAGE_GENERATION_PROVIDER_DUPLICATE` when the id is already registered.
 * @param provider - provider keyed by its stable id.
 * @returns disposer that removes this exact registration.
 */
registerProvider(provider: ImageGenerationProvider): () => void

/**
 * Select a provider and resolve all execution facts before generation starts.
 * Rejects with {@link ImageGenerationError} for blank sizes, a missing
 * explicit provider, no providers, or ambiguous automatic selection.
 * Provider validation failures and cancellation rejections pass through
 * unchanged; providers must honor `context.signal`.
 * @param request - provider/model/format requirements without a prompt.
 * @param context - cancellation context forwarded unchanged to the provider.
 * @returns fully resolved facts stamped with the selected provider id.
 */
async resolve( request: ImageGenerationRequest, context: ImageGenerationContext, ): Promise<ResolvedImageGenerationSpec>

/**
 * Generate images through the provider recorded in a resolved input.
 * Throws {@link ImageGenerationError} with
 * `IMAGE_GENERATION_PROVIDER_MISSING` when the resolved provider has been
 * disposed. Provider failures and cancellation rejections pass through
 * unchanged; providers must honor `context.signal`.
 * @param input - prompt and spec returned by {@link resolve}.
 * @param context - cancellation context forwarded unchanged to the provider.
 * @returns provider result with provider/model attribution and encoded images.
 */
generate(input: ImageGenerationInput, context: ImageGenerationContext): Promise<ImageGenerationResult>
```

Source: [`packages/image/image-generation/src/index.ts`](../../packages/image/image-generation/src/index.ts)

<a id="ctxtaskqueue--taskqueue-abstract-seam"></a>

### `ctx.taskQueue` — `TaskQueue` (abstract seam)

Durable typed work queue whose provider verifies authority before facade creation.

```ts cordis-catalog
/**
 * Bind queue operations to verified Agent authority.
 * @param authority - Opaque capability verified by the provider.
 * @returns Agent-scoped operations.
 */
abstract forAgent(authority: VerifiedAgentAuthority): AgentWorkQueue

/**
 * Bind queue operations to verified operator authority.
 * @param authority - Opaque operator capability verified by the provider.
 * @returns Operator-only operations.
 */
abstract forOperator(authority: VerifiedOperatorAuthority): OperatorWorkQueue

/**
 * Register one typed WorkHandler.
 * @param handler - Typed handler to register.
 * @returns A disposer for exactly this registration.
 */
abstract registerHandler<K extends WorkKind>(handler: WorkHandler<K>): () => void

/**
 * List registered WorkKinds.
 * @returns Registered WorkKinds in stable order.
 */
abstract listKinds(): readonly WorkKind[]
```

Source: [`packages/task-queue/task-queue/src/index.ts`](../../packages/task-queue/task-queue/src/index.ts)

<a id="task-queue-events"></a>

### `task-queue/*` events

<a id="task-queuechanged--emit"></a>

#### `task-queue/changed` — emit

Emitted after one complete ChangeSet is durable and folded.

```ts cordis-catalog
/**
 * Emitted after one complete ChangeSet is durable and folded.
 * @param payload - Durable ChangeSet identity.
 * @mode emit
 */
'task-queue/changed'(payload: { seq: number; changeId: string }): void
```

Source: [`packages/task-queue/task-queue/src/index.ts`](../../packages/task-queue/task-queue/src/index.ts)
<!-- END GENERATED cordis-surface -->
