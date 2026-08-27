# Queue v2 持久内核、Owner Delivery 与 Typed Adoption 实施计划

[English](2026-08-27-queue-v2-owner-delivery-worker-closure.md) | 中文

> **面向 agent worker：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，逐项实施本计划。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 闭合 Queue v2 从持久 admission、recovery-safe execution、typed result collection、replay-safe owner delivery，到一个真实 restricted DSH worker 和一个不启动 per-image Agent 的十图 typed Batch。

**架构：** `LocalTaskQueue` 继续独占 WorkItem、Batch、Attempt、Result、Receipt、Attention、Notification、调度和 Queue root ownership。WorkKind Bridge 复用 Subprocess、ImageGeneration、Attachment、Agent inbox、Session persistence 和 output-retention 能力；generic Queue Consumer 不导入 WorkKind。Automatic Goal continuation 和 multi-host Session ownership 不在本计划内。

**技术栈：** TypeScript、Cordis、Queue v2 ChangeSet JSONL、DSH Agent 和 Session event、`TextRetainer`、AttachmentStore、managed subprocess、Vitest、Loader composition test、ArkCLI Agent Plan，以及 Windows 上真实 `task-worker` 和 Web profile。

**依赖：** 当前 checkout 含有未提交的 Queue v2、image、operator UI、文档和无关 WIP，必须全部保留。Queue v2 store 使用 manifest schema version `3`；不增加早期版本 decoder 或 compatibility shim。真实 DSH worker 需要已有的 model 和 credential path；真实 image Batch 需要已有的 ArkCLI Agent Plan image resource。

**真实验收路径：** deterministic durability 和 delivery test 通过后，运行一个直接 restricted worker，从 live owner Session enqueue 一个真实 `agent.run@1` WorkItem，显式收集 typed result，并证明 Session flush 先于 Notification acknowledgement。随后把十个 `image.generate@1` WorkItem 作为一个 Batch enqueue，证明 Batch 和 resource concurrency 限制，持久化 `ImageAttachmentRef`，并证明 prompt 编写和 image generation 都没有启动 DSH worker process。

**宽验证预算：** Task 1-6 期间只运行具名 test 和 static check。两条真实链路成功且代码冻结后，Queue、Agent inbox、Attachment/image、host composition 和 Queue UI focused suite 各运行一次；然后分别运行一次 `pnpm run build:lib:host`、`pnpm run build:lib:client`、`pnpm run lint`、`pnpm run doc-sync` 和 `git diff --check`。预算 25-40 分钟。只有修改了失败命名的路径后才重跑 broad command；无关失败立即与 dirty-checkout 初始 baseline 对比并保留原样。

## Global Constraints

- 在当前 checkout 工作；不得 reset、clean、切换分支、删除 Queue 或 Session data、停止无关进程或吸收无关 WIP。
- 修改 recovery、subprocess、cancellation 或 teardown 前先读 `docs/defensive-patterns.md`。
- `ChangeSet` 是 Queue 唯一 append 单位。一个逻辑 transition 需要的 sibling fact 必须一起提交。
- recovery 前取得 Queue root ownership；每个 admitted execution 都持久 terminal 或 unknown 后才能释放。
- 外部发现留在 `resolveAdmission()`，无副作用准备留在 `prepare()`，副作用只能在同步 `start()` 返回 `LiveAttempt` 时开始。
- admission 时持久化已验证的 resource claim 和 retry policy。dispatch recovered work 时不得重新计算 deployment-sensitive claim。
- Automatic retry 要求 `retriable: true`、`sideEffect: 'not-started'` 且尚有剩余 attempt。
- 本计划的 unknown resolution 只支持 `confirm-failed` 和 `authorize-retry`。不得暴露 reconcile 或 operator-confirmed success。
- Terminal owner message 只含可信状态和 immutable id。Executor text、stderr、prompt、path 和 artifact bytes 必须显式读取 result。
- 只有稳定消息成为持久 `user/message` 且 `ctx.sessions.flush(session)` 成功后，才能 acknowledgement Notification。
- Queue core 不依赖 Jobs、Goal、Workflow、Subagent、Schedule、Agent Teams、ImageGeneration、Attachment provider 或 WorkKind-specific tool。
- Image output 使用 `ctx.attachments`；删除 Queue root artifact path。如果真实证据证明需要 byte-exact original 且 Attachment normalization 会改变它，停止并请求产品决定。
- Prompt 专业知识在 image Batch admission 前执行一次。不得为每张图启动一个 DSH Agent 编写 prompt。
- 不得把 operator authority 暴露到现有 loopback-only Remote 和 trusted host command 之外。
- 不得打印、持久化或复制 credential value。Readiness 证据只能命名 credential 或 managed resource 以及是否可用。
- 每个 Task 保持 Markdown 每段一条物理行，成对文档同时更新，并在配对复核后记录具名 translation pair。

## Frozen API and Record Changes

设计依据是 implemented [Queue v2 职责与复用边界 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-27-queue-v2-reuse-boundaries.zh.md)。实施使用以下精确 public change。

```ts ignore-check
export interface WorkItem<K extends WorkKind = WorkKind> {
  readonly id: WorkId
  readonly kind: K
  readonly title: string
  readonly intent: WorkInput<K>
  readonly intentDigest: string
  readonly resolved: ResolvedWork<K>
  readonly policy: WorkPolicy
  readonly resources: readonly ResourceClaim[]
  readonly tags: readonly string[]
  readonly batchId: BatchId | null
  readonly ownerSessionId: string | null
  readonly createdAt: string
}

export interface BatchItem<K extends WorkKind> {
  readonly title: string
  readonly input: WorkInput<K>
  readonly tags?: readonly string[]
}

export interface BatchRequest<K extends WorkKind> {
  readonly kind: K
  readonly items: readonly BatchItem<K>[]
  readonly sharedPayload: JsonValue
  readonly idempotencyKey: string
  readonly maxParallel: number
}

export interface WorkHandler<K extends WorkKind> {
  readonly kind: K
  resolveAdmission(input: WorkInput<K>, context: AdmissionContext): Promise<ResolvedWork<K>>
  resources(resolved: ResolvedWork<K>): readonly ResourceClaim[]
  policy(resolved: ResolvedWork<K>): WorkPolicy
  prepare(resolved: ResolvedWork<K>, context: PrepareContext): Promise<PreparedWork<K>>
  start(prepared: PreparedWork<K>, context: StartContext): LiveAttempt<K>
}

export interface StartContext {
  readonly attemptId: AttemptId
  readonly signal: AbortSignal
}

export type UnknownResolution =
  | { readonly kind: 'confirm-failed'; readonly failure: WorkFailure }
  | { readonly kind: 'authorize-retry' }

export interface AgentWorkQueue {
  enqueue<K extends WorkKind>(request: EnqueueRequest<K>): Promise<WorkId>
  enqueueBatch<K extends WorkKind>(request: BatchRequest<K>): Promise<BatchId>
  list(): readonly WorkView[]
  get(id: WorkId): WorkView
  cancel(id: WorkId): Promise<void>
  retry(id: WorkId): Promise<void>
  pendingNotifications(): readonly Notification[]
  acknowledgeNotification(id: NotificationId, messageId: string): Promise<void>
}

export interface OperatorWorkQueue {
  list(): readonly WorkView[]
  get(id: WorkId): WorkView
  cancel(id: WorkId): Promise<void>
  retry(id: WorkId): Promise<void>
  pause(): void
  resume(): void
  resolveUnknown(workId: WorkId, resolution: UnknownResolution): Promise<void>
  pendingAttentions(): readonly Attention[]
}
```

`Attention.status` 为 `pending | resolved`，并带有 `resolvedAt`；`attention/resolved` 必须与 `unknown/resolved` 是 sibling。`Notification.attemptId` 只在 queued cancellation 时可为 null。稳定 Notification `messageId` 为 `task-queue-notification:<notificationId>`。

Owner message text 固定为：

```text
Background work reached a terminal outcome.
Work: <title> (<workId>)
Attempt: <attemptId|none>
Outcome: <succeeded|failed|canceled>
Result: <resultId|none>
Inspect the durable result with task_queue_result.
```

## File Map

| 区域 | 文件 | 职责 |
| --- | --- | --- |
| Queue domain | `packages/task-queue/task-queue/src/types.ts`、`fold.ts`、`artifact.ts`、tests | 持久 claim/policy、Batch item、受限 unknown resolution、Attention/Notification invariant、删除 generic artifact API |
| Local Provider | `packages/task-queue/task-queue-local/src/index.ts`、`v2-store.ts`、`v2-artifacts.ts`、tests | Atomic admission、调度、recovery、shutdown、terminal outbox |
| Agent inbox 复用 | `packages/core/agent/src/inbox.ts`、`index.ts`、tests；Agent Teams mailbox 文件 | 共享 Session message acceptance projection |
| Generic Agent Consumer | `packages/task-queue/tool-task-queue` | Generic control、`task_queue_result`、可信 owner delivery |
| DSH admission Consumer | 新建 `packages/task-queue/tool-agent-run-task-queue` | 仅负责单项和 Batch `agent.run@1` admission |
| DSH WorkKind Bridge | `packages/task-queue/task-queue-executor-dsh` | Restricted worker Handler 和 bounded diagnostic |
| Image Bridge 与 Consumer | `packages/image/image-generation-task-queue`、`tool-image-generation-task-queue` | Attachment-backed result 和单项／Batch image admission |
| Composition | base/web bundle、standard preset、aggregate tsconfig | Provider、Handler、capacity 和 scoped Consumer selection |
| 产品验证 | Queue Remote/UI test 和 `outputs/task-queue-v2-owner-delivery/` 下的 evidence | Operator compatibility 和真实 vertical fact |
| 持久理由 | proposed/implemented Agent Note、package README、task-queue subsystem doc | 当前约定和最终 shipped decision |

---

### Task 1: 持久化 admission policy 并执行 atomic Batch scheduling

**依赖：**
- 无。

**文件：**
- 修改：`packages/task-queue/task-queue/src/types.ts`
- 修改：`packages/task-queue/task-queue/src/fold.ts`
- 修改：`packages/task-queue/task-queue/tests/fixtures.ts`
- 修改：`packages/task-queue/task-queue/tests/fold.spec.ts`
- 修改：`packages/task-queue/task-queue/tests/validation.spec.ts`
- 修改：`packages/task-queue/task-queue/tests/public-api.typecheck.ts`
- 修改：`packages/task-queue/task-queue-local/src/index.ts`
- 修改：`packages/task-queue/task-queue-local/tests/v2-scheduler.spec.ts`
- 修改：`packages/task-queue/task-queue-local/tests/v2-store.spec.ts`
- 只修改 compiler 明确指出的 Queue caller 和 fake。

**接口：**
- 消费：Frozen API and Record Changes 章节。
- 产出：持久 `resources` 和 Handler-derived `policy` 的 WorkItem；`BatchRequest.items`；transaction-safe idempotent Batch admission；scheduler 对 global、resource 和 Batch capacity 的执行。

**测试策略：**
- 变更类型：persistence、idempotency、concurrency 和 public-contract change。
- 风险级别：boundary。
- 证据：RED fold 和 scheduler test、public API typecheck、reopened-store assertion。
- 扩大条件：只有 compiler error 命名其他 caller 时才运行。

**验收贡献：**
- 防止 admitted work 在重启后改变资源语义，并让 Batch 成为真实 scheduling constraint，而不只是 metadata。

- [x] **Step 1: 添加 RED domain 和 API test**

增加 fixture，证明 Work admission 会拒绝缺失、重复、空名称、非正数、分数或未声明的 resource claim，以及非法 `maxAttempts`。把 Batch `title + inputs` fixture 替换成有序 `items`，保留每项 title 和 tag。删除对 `ArtifactWriter`、`ArtifactRef`、`ArtifactWrite` 和 `StartContext.artifacts` 的 compile-time reference。

- [x] **Step 2: 添加 RED Batch Provider test**

在 `v2-scheduler.spec.ts` 中，以同一 owner、key 和 digest 同时启动两个 admission，reopen 后断言只有一个 Batch、一张 receipt 和一组 WorkItem。增加 conflicting-digest case。在更大的 global/resource capacity 下启动 `maxParallel` 为 `2` 的 Batch，并证明一个成员 settlement 前只有两个成员进入 `start()`。增加另一个 Batch，证明它可以使用未占用的 host capacity。

- [x] **Step 3: 运行 RED**

```powershell
pnpm vitest run packages/task-queue/task-queue/tests/fold.spec.ts packages/task-queue/task-queue/tests/validation.spec.ts packages/task-queue/task-queue-local/tests/v2-scheduler.spec.ts
```

预期：失败分别指出旧 Batch field、缺失 persisted claim、重复 admission 和被忽略的 `maxParallel`。

- [x] **Step 4: 实现最小 domain 和 admission change**

增加 `WorkHandler.policy()`、`WorkItem.resources` 和 `BatchItem`。在 store transaction 外 resolve 每个 item；各派生并验证一次 policy 和 claim；然后在 `store.transaction()` 内重新检查 receipt 并 append 完整 admission。single 和 Batch request 共用一张按 owner、source 和 idempotency key 键控的 in-flight admission map。外部 resolution 不得在 mutation tail 后串行执行。

- [x] **Step 5: 执行 persisted capacity**

claim selection 改用 `work.resources`。按 global、每项 resource 和非 null `batchId` 统计 `executing` entry。admission 时拒绝缺失的 configured capacity。Handler registration 可见后调用 `pump()`，让 recovered queued work 取得资格。

- [x] **Step 6: 运行 focused PASS 和 typecheck**

```powershell
pnpm vitest run packages/task-queue/task-queue/tests packages/task-queue/task-queue-local/tests/v2-store.spec.ts packages/task-queue/task-queue-local/tests/v2-scheduler.spec.ts
pnpm exec tsc -p packages/task-queue/task-queue/tsconfig.types.json --noEmit
```

预期：所有具名 test 通过；public typecheck 不包含 compatibility overload。

- [x] **Step 7: 不 stage，记录完整 checkpoint**

```powershell
git diff --check -- packages/task-queue/task-queue packages/task-queue/task-queue-local
git status --short -- packages/task-queue/task-queue packages/task-queue/task-queue-local
```

---

### Task 2: 恢复遗留 Attempt 并在 shutdown 期间保持 Queue ownership

**依赖：**
- Task 1。

**文件：**
- 修改：`packages/task-queue/task-queue-local/src/index.ts`
- 修改：`packages/task-queue/task-queue-local/src/v2-store.ts`
- 修改：`packages/task-queue/task-queue-local/tests/v2-scheduler.spec.ts`
- 修改：`packages/task-queue/task-queue-local/tests/lock.spec.ts`
- 修改：`packages/task-queue/task-queue/src/fold.ts`
- 修改：`packages/task-queue/task-queue/tests/fold.spec.ts`

**接口：**
- 消费：persisted Work resource 和现有 Queue root ownership handle。
- 产出：每个 stranded Attempt 的 recovery ChangeSet；`shutdownTimeoutMs` 配置；释放 ownership 前结算或标记每个 admitted execution 为 unknown 的 teardown。

**测试策略：**
- 变更类型：crash recovery、cancellation、teardown 和 cross-process ownership。
- 风险级别：boundary。
- 证据：reopened JSONL state，以及可控的 settle、cancel throw 或超过 shutdown deadline 的 live handle。
- 扩大条件：只有 owned handle contract 与预期不同时，才检查 `docs/defensive-patterns.md` 并运行 subprocess test。

**验收贡献：**
- 让 Queue root single-writer ownership 对 live execution 成立，而不只对 JSONL file 成立。

- [x] **Step 1: 添加 RED restart test**

持久化一个 queued、一个 starting 和一个 running WorkItem，只关闭 raw test store 模拟 crashed owner，再通过 `LocalTaskQueue` reopen。断言 queued work 在 Handler 注册前等待，注册后 start。断言 starting 和 running Attempt 在任何新 Attempt 开始前，以 `host-restart` failure 转为 unknown，并各自创建一个 same-ChangeSet pending Attention。

- [x] **Step 2: 添加 RED shutdown test**

使用三个 fake `LiveAttempt` handle：一个 cancel 后返回 canceled，一个 `cancel()` throw，一个永不 settle。dispose Provider。断言第一个提交 canceled，另外两个提交 unknown 加 Attention，所有 transaction drain，并且第二个 store 在这些持久 transition 完成前无法取得 root。

- [x] **Step 3: 运行 RED**

```powershell
pnpm vitest run packages/task-queue/task-queue-local/tests/v2-scheduler.spec.ts packages/task-queue/task-queue-local/tests/lock.spec.ts
```

预期：recovered Attempt 仍为 starting/running，并且 execution settlement 前释放 root lock。

- [x] **Step 4: 在 dispatch 前实现 recovery**

`WorkQueueStore.open()` 取得 ownership 并 fold log 后，append 一个 recovery ChangeSet，包含每个 starting 或 running Attempt 的 `attempt/unknown` 和 `attention/created` sibling。两种 persisted state 都使用 `sideEffect: 'unknown'`，因为 `start()` 可能在 `attempt/running` 持久化前已跨过外部边界。recovery 完成前不得 pump。

- [x] **Step 5: 实现 bounded quiescent disposal**

增加 required resolved `shutdownTimeoutMs` 配置。关闭新 admission 和 dispatch，为尚无记录的 active WorkItem 提交 `cancel/requested`，abort active controller，每个 live cancel 只调用一次，在 bound 内等待 execution settlement，并在 `store.close()` 前把所有未解决 execution 转成 unknown。contain 每项 cancellation error，同时将其保留在 unknown failure message 中。释放 lock 前 await store mutation tail。

- [x] **Step 6: 运行 focused PASS**

```powershell
pnpm vitest run packages/task-queue/task-queue-local/tests/v2-store.spec.ts packages/task-queue/task-queue-local/tests/v2-scheduler.spec.ts packages/task-queue/task-queue-local/tests/lock.spec.ts
```

预期：所有 recovery 和 shutdown case 通过，测试 sleep 不超过 configured test bound。

- [x] **Step 7: 不 stage，记录完整 checkpoint**

```powershell
git diff --check -- packages/task-queue/task-queue-local packages/task-queue/task-queue
git status --short -- packages/task-queue/task-queue-local packages/task-queue/task-queue
```

---

### Task 3: 复用 Agent inbox、Attachment 和 output-retention 能力

**依赖：**
- Task 1。

**文件：**
- 修改：`packages/core/agent/src/inbox.ts`
- 修改：`packages/core/agent/src/index.ts`
- 修改：`packages/core/agent/tests/agent.spec.ts`
- 在两个 consumer 都使用 Agent-owned acceptance projection 后，移除过时的 Agent Team session-message helper。
- 修改：`packages/experimental/agent-team/src/mailbox.ts`
- 修改：`packages/experimental/agent-team/tests/persistence.spec.ts`
- 移除过时的 Queue ArtifactWriter contract 与本地实现。
- 修改：`packages/image/image-generation-task-queue/src/index.ts`
- 修改：`packages/image/image-generation-task-queue/tests/index.spec.ts`
- 修改：`packages/task-queue/task-queue-local/tests/image-v2-vertical.spec.ts`
- 修改：`packages/task-queue/task-queue-executor-dsh/src/index.ts`
- 修改：`packages/task-queue/task-queue-executor-dsh/package.json`
- 修改：`packages/task-queue/task-queue-executor-dsh/tests/v2-handler.spec.ts`

**接口：**
- 消费：`agent/inbox/spliced`、`user/message`、`ctx.attachments.saveImages()` 和 `TextRetainer`。
- 产出：Agent package 导出的 `messageAccepted(events, predicate)`；`ImageGenerateOutput.attachments: readonly ImageAttachmentRef[]`；不使用本地 UTF-8 slicing 的 bounded stdout head 和 stderr tail。

**测试策略：**
- 变更类型：behavior-preserving extraction 加 result-storage contract change。
- 风险级别：boundary。
- 证据：shared projection test、Agent Teams regression test、使用真实 Attachment Provider 的 image Bridge test，以及 DSH Handler multibyte bound。
- 扩大条件：如果真实 generated image 需要 Attachment normalization 会改变的字节，停止并取得 design Note 要求的产品决定。

**验收贡献：**
- 在 owner delivery 和 image adoption 依赖它们前，删除三个重复机制。

- [x] **Step 1: 建立 focused baseline**

```powershell
pnpm vitest run packages/core/agent/tests/agent.spec.ts packages/experimental/agent-team/tests/persistence.spec.ts packages/image/image-generation-task-queue/tests/index.spec.ts packages/task-queue/task-queue-local/tests/image-v2-vertical.spec.ts packages/task-queue/task-queue-executor-dsh/tests/v2-handler.spec.ts
```

预期：refactor 前当前 focused test 通过。

- [x] **Step 2: 移动 pure message acceptance projection**

把现有 `agent/inbox/spliced` 加 `user/message` fold 从 `@deepseek-ai/dsh-agent` 导出为 `messageAccepted(events, predicate)`。增加 pending next-turn、pending next-step、claimed message、removed message、由 caller slice 排除 inherited seed 和 stable-id predicate 的精确 test。用 shared export 替换 Agent Teams 私有实现；不增加 service 或 registry。

- [x] **Step 3: 用 Attachment reference 替换 Queue artifact**

删除 Queue artifact type 和 `StartContext.artifacts`。把 `createImageGenerateHandler(imageGeneration, attachments)` 改成通过 `attachments.saveImages()` 保存完整 generated image list，并返回 provider、model 和 `attachments`。Bridge injection 改成 `['taskQueue', 'imageGeneration', 'attachments']`。Vertical test 使用 `LocalAttachmentStore`，reopen Queue，通过 Attachment service 读取每个 reference 并验证 bytes 和 metadata，而不是验证 host path。

- [x] **Step 4: 用 `TextRetainer` 替换本地 text slicing**

semantic stdout 使用 `TextRetainer({ kind: 'head', maxBytes: maxAssistantBytes })`；nonzero stderr 使用 `TextRetainer({ kind: 'tail', maxBytes: failureTailBytes })`。增加 required resolved `failureTailBytes`，其上限为 `collectBytes`，并测试 empty stderr、multibyte boundary、newest-byte retention 和不包含 spill path。

- [x] **Step 5: 运行 focused PASS**

```powershell
pnpm vitest run packages/core/agent/tests/agent.spec.ts packages/experimental/agent-team/tests/persistence.spec.ts packages/image/image-generation-task-queue/tests/index.spec.ts packages/task-queue/task-queue-local/tests/image-v2-vertical.spec.ts packages/task-queue/task-queue-executor-dsh/tests/v2-handler.spec.ts
```

预期：所有 baseline 保持 green，且不存在 Queue root artifact writer。

- [x] **Step 6: 不 stage，记录完整 checkpoint**

```powershell
git diff --check -- packages/core/agent packages/experimental/agent-team packages/image/image-generation-task-queue packages/task-queue/task-queue packages/task-queue/task-queue-local packages/task-queue/task-queue-executor-dsh
git status --short -- packages/core/agent packages/experimental/agent-team packages/image/image-generation-task-queue packages/task-queue/task-queue packages/task-queue/task-queue-local packages/task-queue/task-queue-executor-dsh
```

---

### Task 4: 原子提交 terminal Notification 和 unknown Attention record

**依赖：**
- Task 1 和 Task 2。

**文件：**
- 修改：`packages/task-queue/task-queue/src/types.ts`
- 修改：`packages/task-queue/task-queue/src/fold.ts`
- 修改：`packages/task-queue/task-queue/tests/fixtures.ts`
- 修改：`packages/task-queue/task-queue/tests/fold.spec.ts`
- 修改：`packages/task-queue/task-queue/tests/validation.spec.ts`
- 修改：`packages/task-queue/task-queue-local/src/index.ts`
- 修改：`packages/task-queue/task-queue-local/tests/v2-scheduler.spec.ts`
- 只修改 compiler 明确指出的 Remote 和 Consumer fake。

**接口：**
- 消费：terminal settlement helper、recovery unknown transition 和 Frozen API and Record Changes 章节。
- 产出：same-ChangeSet Notification 和 Attention record；owner-fenced pending Notification read 和 CAS acknowledgement；operator pending Attention read 和 atomic resolution。

**测试策略：**
- 变更类型：persistence、authorization 和 idempotency boundary。
- 风险级别：boundary。
- 证据：精确 ChangeSet sibling assertion、foreign-owner rejection、wrong-message CAS rejection 和 reopen check。
- 扩大条件：无。

**验收贡献：**
- 在任何 Session integration 运行前建立 durable delivery fact。

- [x] **Step 1: 编写 RED terminal outbox test**

覆盖 successful result、retry exhaustion 后的 terminal failure、null Attempt 的 queued cancellation、带 Attempt 的 live cancellation、ownerless terminal work 和 auto-retried failure。断言 terminal owned work 恰有一个 pending Notification，ownerless 或 non-terminal work 没有。断言 Notification terminal sequence 等于所在 ChangeSet sequence。

- [x] **Step 2: 编写 RED unknown Attention test**

覆盖 Handler-returned unknown、restart-recovered unknown、ownerless unknown、confirmed failure 和 authorized retry。断言 unknown 创建一个 pending Attention；resolution 提交 `unknown/resolved + attention/resolved`；confirmed failure 还创建 terminal owner Notification；authorized retry 不创建。

- [x] **Step 3: 编写 RED facade test**

断言 pending Notification 按 owner 过滤，并按 `createdAt` 后接 id 排序。foreign-owner 和 wrong-message acknowledgement 拒绝。重复的正确 acknowledgement 幂等。Operator pending Attention 包含所有 owner，并且只有 atomic unknown resolution 后消失。

- [x] **Step 4: 运行 RED**

```powershell
pnpm vitest run packages/task-queue/task-queue/tests/fold.spec.ts packages/task-queue/task-queue/tests/validation.spec.ts packages/task-queue/task-queue-local/tests/v2-scheduler.spec.ts
```

预期：失败指出缺失 settlement sibling 和 facade method。

- [x] **Step 5: 实现 atomic settlement helper 和 facade**

在 `store.transaction()` 内构造完整 event array，再执行一次 append。Fold validation 要求匹配 terminal/unknown sibling，以及匹配的 owner、Work、Attempt、Result 和 ChangeSet sequence。删除 `acknowledgeAttention`；Attention resolution 不是 delivery receipt。不得为已删除的 unknown resolution 增加 compatibility overload。

- [x] **Step 6: 运行 focused PASS**

```powershell
pnpm vitest run packages/task-queue/task-queue/tests/fold.spec.ts packages/task-queue/task-queue/tests/validation.spec.ts packages/task-queue/task-queue-local/tests/v2-store.spec.ts packages/task-queue/task-queue-local/tests/v2-scheduler.spec.ts
```

预期：每个具名 test 通过，reopen assertion 检查 durable record。

- [x] **Step 7: 不 stage，记录完整 checkpoint**

```powershell
git diff --check -- packages/task-queue/task-queue packages/task-queue/task-queue-local
git status --short -- packages/task-queue/task-queue packages/task-queue/task-queue-local
```

---

### Task 5: 拆分 WorkKind admission 并完成显式 owner result delivery

**依赖：**
- Task 3 和 Task 4。

**文件：**
- 修改：`packages/task-queue/tool-task-queue/src/index.ts`
- 修改：`packages/task-queue/tool-task-queue/package.json`
- 修改：`packages/task-queue/tool-task-queue/tests/v2-tools.spec.ts`
- 新建：`packages/task-queue/tool-agent-run-task-queue/package.json`
- 新建：`packages/task-queue/tool-agent-run-task-queue/tsconfig.json`
- 新建：`packages/task-queue/tool-agent-run-task-queue/src/index.ts`
- 新建：`packages/task-queue/tool-agent-run-task-queue/src/invariant.ts`
- 新建：`packages/task-queue/tool-agent-run-task-queue/tests/index.spec.ts`
- 为 `packages/task-queue/tool-agent-run-task-queue` 新建成对 package README。
- 修改：`packages/bundle/base/package.json`
- 修改：`packages/bundle/base/cordis.patch.yml`
- 修改：`packages/bundle/base/tests/base.spec.ts`
- 修改：`packages/bundle/web-app/cordis.patch.yml`
- 修改：`apps/cli/config/agent-presets/standard/agent.cordis.yml`
- 修改：compiler 命名的 aggregate TypeScript project reference。

**接口：**
- 消费：pending owner Notification、shared `messageAccepted()`、Session flush 和现有 `agent.run@1` declaration。
- 产出：包含 `task_queue_result` 的 generic Queue tool；稳定 pre-step owner delivery；不含 executor argument 的 WorkKind-specific agent.run admission Consumer。

**测试策略：**
- 变更类型：model-facing API、durable cross-service delivery 和 package-composition change。
- 风险级别：boundary。
- 证据：精确 tool snapshot、真实 Session event、flush-before-ack 顺序、restart recovery、Loader composition，以及 generic Queue Consumer 不导入 WorkKind。
- 扩大条件：只有 documented pre-step entry semantics 与 focused integration 不同时才运行 agent-loop test。

**验收贡献：**
- 在保留 trusted Notification content 和 WorkKind ownership 的同时，完成 business-result collection。

- [x] **Step 1: 编写 RED generic Consumer test**

从 `v2-tools.spec.ts` 删除 enqueue expectation。增加 `task_queue_result` 的 queued/running、succeeded typed output、failed structured failure、canceled、unknown 和 foreign owner case。增加精确 stable owner message renderer test，并断言 malicious assistant text、stderr、prompt、path 和 attachment metadata 都不进入消息。

- [x] **Step 2: 编写 RED delivery test**

覆盖 accepted pre-step insertion、rejected pre-step、foreign Session isolation、由 required `maxNotificationsPerStep` 限制的 per-step delivery cap、每个 message id 一个 finalizer、Session flush 先于 Queue acknowledgement、flush rejection 保持 Notification pending、已有 `user/message` 的 restart acknowledgement，以及 dispose 阻止后续工作。使用真实 Agent inbox projection helper，不写本地 event scan。

- [x] **Step 3: 编写 RED agent.run Consumer 和 composition test**

新 package 只注册 `task_queue_enqueue` 和 `task_queue_enqueue_batch`，从 `exec.agent.session` 派生 authority，接受独立 Batch title，并且绝不暴露 executor、profile、model、credential 或 shell field。Base 和 standard preset composition 包含新配置项；Web 禁用 base agent-scoped 配置项，并从 preset 取得它。

- [x] **Step 4: 运行 RED**

```powershell
pnpm vitest run packages/task-queue/tool-task-queue/tests/v2-tools.spec.ts packages/task-queue/tool-agent-run-task-queue/tests/index.spec.ts packages/bundle/base/tests/base.spec.ts
```

预期：generic tool 仍拥有 admission，owner delivery 缺失，新 package 尚未 composition。

- [x] **Step 5: 实现 generic result 和 Notification delivery**

在 `tool-task-queue` 注册 list、status、result、cancel、retry、stats 和 kinds。tools 后注册 `agent/pre-step`：await downstream，保留 rejection，然后增加最多 `maxNotificationsPerStep` 条不存在的稳定消息。注册 `session/event`：匹配 `user/message` 时按 message id single-flight，flush Session，acknowledgement Notification，并在 finally 清除 in-flight state。pre-step 遇到已有稳定 `user/message` 时启动同一 finalizer，不 reinjection。

- [x] **Step 6: 实现并 composition agent.run Consumer**

只把两个 admission tool definition 及其 WorkKind type dependency 移入 `tool-agent-run-task-queue`。注册 package invariant 和 paired README。更新 Bundle dependency、host row、Web disable、standard preset 和 aggregate project reference。`tool-task-queue` 不得再依赖 `task-queue-executor-dsh`。

- [x] **Step 7: 运行 focused PASS 和 contract check**

```powershell
pnpm vitest run packages/task-queue/tool-task-queue/tests/v2-tools.spec.ts packages/task-queue/tool-agent-run-task-queue/tests/index.spec.ts packages/bundle/base/tests/base.spec.ts
pnpm run verify-package-invariants
pnpm run verify-skill-invocation-metadata
```

预期：所有具名 check 通过，生成的 tool input 不包含 executor field。

- [x] **Step 8: 不 stage，记录完整 checkpoint**

```powershell
git diff --check -- packages/task-queue/tool-task-queue packages/task-queue/tool-agent-run-task-queue packages/bundle/base packages/bundle/web-app apps/cli/config/agent-presets/standard
git status --short -- packages/task-queue/tool-task-queue packages/task-queue/tool-agent-run-task-queue packages/bundle/base packages/bundle/web-app apps/cli/config/agent-presets/standard
```

---

### Task 6: 证明 restricted worker 和十图 Batch vertical

**依赖：**
- Task 1-5。
- 已有 approved model 和 ArkCLI Agent Plan 配置；只报告名称和是否存在。

**文件：**
- 修改：`packages/task-queue/task-queue-executor-dsh/tests/v2-handler.spec.ts`
- 修改：`packages/task-queue/tool-task-queue/tests/v2-tools.spec.ts`
- 修改：`packages/image/tool-image-generation-task-queue/src/index.ts`
- 在 `packages/image/tool-image-generation-task-queue` 内新建：`tests/index.spec.ts`
- 修改：`packages/task-queue/task-queue-local/tests/image-v2-vertical.spec.ts`
- 修改：`packages/task-queue/task-queue-remote/tests/v2-remote.spec.ts`
- 仅 evidence：`outputs/task-queue-v2-owner-delivery/`

**接口：**
- 消费：restricted `task-worker` overlay、agent.run Consumer、image Batch Consumer、Attachment-backed output、owner delivery 和 operator unknown resolution。
- 产出：deterministic restart evidence，加一个真实 agent.run result 和一个真实十图 Batch。

**测试策略：**
- 变更类型：真实 external-process、model、image-provider、persistence 和 delivery vertical。
- 风险级别：broad milestone preparation。
- 证据：精确 Work/Attempt/Result/Batch/Notification/Session id、reopen 后 persisted record、process count、Attachment read 和脱敏 command outcome。
- 扩大条件：executor/profile 文件内只允许一次 evidence-directed worker correction；第二种不同 correction 或外部 component failure 会停止真实链路并记录 bounded diagnostic。

**验收贡献：**
- 证明 Queue 独特的 durable value，以及 typed WorkKind 所服务的 batch-efficiency path。

- [x] **Step 1: 完成 direct worker readiness**

运行精确 final composition，确认 Queue、Queue executor/tool/command/Remote、Jobs、Goal、Subagent、Workflow、Ralph 和 HMR 均禁用；只保留 Windows foreground PowerShell family，且 background execution 不可用。

```powershell
$workerPatch = (Resolve-Path 'packages/task-queue/task-queue-executor-dsh/worker.cordis.patch.yml').Path
pnpm dsh --profile task-worker --patch $workerPatch --dump-config
```

然后使用 Handler 构造的同一种 launcher argv 运行一个直接 task：

```text
Return exactly QUEUE-WORKER-DIRECT-OK. Do not modify files, run commands, or call external services.
```

在 `outputs/task-queue-v2-owner-delivery/worker-direct/` 保存脱敏 argv、timestamp、exit code、bounded stdout marker 和 bounded stderr。

- [x] **Step 2: 最多执行一次 evidence-directed worker correction**

| Diagnostic | 允许的修正 |
| --- | --- |
| Recursive 或 background capability 仍 active | 修正具名 final overlay row，并增加 composition assertion |
| Managed provider/model 缺失 | 修正 task-worker composition 以读取现有 managed settings；不得 hardcode provider 或 model |
| scrubbed process 缺少一个明确需要的 credential name | 增加 validated named credential forwarding；绝不把 pattern 或 value 写入 record/log |
| Foreground PowerShell 或 workspace sandbox 失败 | 只修正具名 Windows shell 或 permission row，并增加 regression coverage |
| 其他任何 failure | 停止并保留 `TextRetainer` diagnostic；不得扩大范围 |

- [x] **Step 3: 增加 deterministic owner-delivery restart coverage**

在 `v2-tools.spec.ts` 中使用真实 LocalTaskQueue、SessionStore、Agent test runtime 和 deterministic Handler。证明 admission、success、pending Notification、accepted stable message、显式 `task_queue_result`、Session flush、acknowledgement、close/reopen 和不复制消息。再把 flush 阻塞在 `user/message` 与 acknowledgement 之间重复一次；reopen 后证明 acknowledgement 完成且不 reinjection。

- [x] **Step 4: 增加 image Batch tool 和 deterministic performance test**

注册 `image_generate_enqueue_batch`，ordered item 包含 title、completed prompt、size、format、watermark、optional provider 和 optional model。一次调用创建一个 homogeneous Batch。十个 input 下，断言十个 image WorkItem、独立 title、不存在 `agent.run@1`、Batch `maxParallel`、resource capacity 和十个 Attachment-backed result。用 provider spy 证明 image generation 调用十次，DSH worker spawn 零次。

- [x] **Step 5: 运行 deterministic vertical test**

```powershell
pnpm vitest run packages/task-queue/tool-task-queue/tests/v2-tools.spec.ts packages/image/tool-image-generation-task-queue packages/task-queue/task-queue-local/tests/image-v2-vertical.spec.ts packages/task-queue/task-queue-remote/tests/v2-remote.spec.ts
```

预期：owner recovery 和十图 Batch scenario 在没有真实 external service 的情况下通过。

- [x] **Step 6: 运行一个真实 Queue-backed agent.run WorkItem**

从 live owner Agent Session enqueue title `QUEUE-V2-OWNER-DELIVERY`，prompt 为：

```text
Return exactly QUEUE-V2-OWNER-DELIVERY-OK. Do not modify files, run commands, or call external services.
```

记录 WorkId、AttemptId、ResultId、NotificationId、messageId、terminal ChangeSet sequence、timestamp、ownerSessionId 和 process exit。触发一个普通 owner step，显式调用 `task_queue_result`，并证明 stable Notification 排除 worker output，而 tool result 包含 marker。证明持久 `user/message` 和 Session flush 在 Notification acknowledgement 前完成。

- [x] **Step 7: 运行一个真实十图 Batch**

使用一份已经编译好的十条完整封面 prompt 列表。以 `maxParallel: 3` enqueue 一个 Batch。记录 BatchId、十个 Work/Attempt/Result id、最大 observed concurrent generation call、Attachment id、dimension、hash 和 provider/model fact。证明十个 succeeded result、Batch 最大并发不超过三、configured resource capacity 被执行、Queue reopen 后 Attachment read 成功，且这个 Batch 没有启动 task-worker child。

- [x] **Step 8: 保存并 hash evidence package**

写入脱敏 JSON，包含 id、sequence、timestamp、status、relative durable location、process count 和 command exit code。prompt/model output 只保留固定 marker，绝不保留 credential、presigned URL、完整 stderr 或完整 log。为每个 evidence file 生成 SHA-256。

- [x] **Step 9: 不 stage，记录 vertical checkpoint**

```powershell
git diff --check -- packages/task-queue packages/image packages/bundle
git status --short -- packages/task-queue packages/image packages/bundle outputs/task-queue-v2-owner-delivery
```

---

### Task 7: 同步 shipped 文档并运行最终 gate

**依赖：**
- Task 6 真实和 deterministic evidence 通过。

**文件：**
- 修改每个受影响 Queue 和 image package 的 paired README。
- 修改：`docs/subsystems/task-queue.md`
- 修改：`docs/subsystems/task-queue.zh.md`
- 实现与提案一致后，把 proposed Queue v2 ownership Agent Note 移入 `implemented/architecture` 并重写。
- 复核并更新或 cross-link 现有 Queue image canary、operator MVP 和 DSH executor Agent Note，不编辑 archived Note。
- 只有 executed path 或 command 变化时才修改本实施计划。
- 通过 repository script 重新生成 owner-generated catalog。

**接口：**
- 消费：shipped source、真实 evidence、focused test 和当前 generated catalog。
- 产出：当前 package contract、implemented rationale、同步 bilingual record 和最终 verification report。

**测试策略：**
- 变更类型：documentation 和 broad milestone。
- 风险级别：broad。
- 证据：paired-document check、Agent Note format、generated catalog freshness、focused suite、host/client build、lint、doc-sync 和 diff hygiene。
- 扩大条件：broad failure 立即与 dirty-checkout 初始 baseline 对比；只修复 changed file 导致的 failure。

**验收贡献：**
- 让已实现边界可复核，同时不声称 automatic continuation、byte-exact generic artifact 或 multi-host scheduling。

- [x] **Step 1: 更新 package 和 subsystem contract**

记录 persisted resource/policy、Batch limit、recovery、shutdown、受限 unknown resolution、Attachment-backed image result、拆分的 WorkKind admission、stable owner delivery、显式 result read 和当前 limitation。删除把 Queue ArtifactWriter、generic reconcile、operator-confirmed success 或 `tool-task-queue` WorkKind admission 描述为受支持的文本。

- [x] **Step 2: 提升 proposed Agent Note**

把完整 triplet 移入 `implemented/architecture`，把 `Status: proposed` 改成 `Status: implemented`，把 `Proposal` 重写为 `Decision`，用 shipped `Consequences` 和 verification fact 替换 acceptance/risk planning prose，并保留 alternative。复核 image canary 和 DSH executor Note 的 partial supersession；保留并 cross-link 独立有价值的 rationale，任何归档或合并前使用 `dsh-archive-agent-notes`。

- [x] **Step 3: 记录 translation pair 并重新生成 catalog**

```powershell
pnpm run verify-translation-pairing --write packages/task-queue/task-queue/README.md packages/task-queue/task-queue-local/README.md packages/task-queue/task-queue-executor-dsh/README.md packages/task-queue/task-queue-remote/README.md packages/task-queue/command-task-queue/README.md packages/task-queue/tool-task-queue/README.md packages/task-queue/tool-agent-run-task-queue/README.md packages/image/image-generation/README.md packages/image/image-generation-arkcli/README.md packages/image/image-generation-task-queue/README.md packages/image/tool-image-generation-task-queue/README.md packages/client/ui-task-queue/README.md docs/subsystems/task-queue.md .agents/notes/implemented/architecture/2026-08-27-queue-v2-reuse-boundaries.md docs/superpowers/plans/2026-08-27-queue-v2-owner-delivery-worker-closure.md
pnpm run doc-sync
```

预期：生成的 Queue/tool/config/API reference 与 source 一致；报告无关 baseline failure，不做修复。

- [x] **Step 4: 运行一次冻结的 focused milestone**

```powershell
pnpm vitest run packages/core/agent/tests packages/experimental/agent-team/tests packages/task-queue/task-queue/tests packages/task-queue/task-queue-local/tests packages/task-queue/task-queue-executor-dsh/tests packages/task-queue/tool-task-queue/tests packages/task-queue/tool-agent-run-task-queue packages/task-queue/task-queue-remote/tests packages/image/image-generation/tests packages/image/image-generation-arkcli/tests packages/image/image-generation-task-queue/tests packages/image/tool-image-generation-task-queue packages/client/ui-task-queue/tests packages/bundle/base/tests/base.spec.ts
```

预期：每个具名 focused file 通过。记录 test file 和 test 数量。

- [x] **Step 5: 运行一次最终 build 和 broad gate**

```powershell
pnpm run build:lib:host
pnpm run build:lib:client
pnpm run lint
pnpm run doc-sync
pnpm run verify-agent-note-format
pnpm run verify-package-paths
git diff --check
```

预期：changed-path gate 通过。报告无关 baseline failure 及其 owner path，不吸收它们。

- [x] **Step 6: 产出 completion report**

报告 focused test count、build/lint/doc result、Worker 和 Batch id、terminal 和 acknowledgement sequence、restart recovery fact、shutdown ownership evidence、最大 observed image concurrency、Attachment hash、没有 per-image DSH worker、evidence hash 和剩余 limitation。

允许的 completion statement 是：Queue v2 提供 host-durable typed WorkItem、recovery-safe execution、被执行的 Batch/resource capacity、显式 typed result collection 和 replay-safe owner delivery。restricted DSH worker 和十图 typed Batch 是已验证 vertical。Automatic Goal continuation、byte-exact generic artifact storage、unverified success reconciliation 和 multi-host Session scheduling 仍不存在。

- [x] **Step 7: 不 stage，准备 integration handoff**

```powershell
git diff --check
git status --short
```

## Executor Stop Conditions

- 需求变化会在没有修订设计决定的情况下，把 ownership 从 Queue 移到 Jobs、Goal、Session、Attachment、ImageGeneration 或其他现有 service。
- Recovery 无法在 dispatch 前把每个 persisted starting 或 running Attempt 标记 unknown。
- Shutdown 会在 Attempt 没有 durable terminal 或 unknown record 时释放 Queue root ownership。
- Batch admission 无法在一个 mutation transaction 内重新检查 receipt 并 append 每个 member。
- Result delivery 会把 executor output 作为 trusted user message 注入。
- Image acceptance 需要 byte-exact original，而 mounted Attachment Provider 会改变这些字节。
- Direct worker diagnostic 命名了 allowed executor/profile composition file 之外的 component。
- 真实 external check 会暴露 credential 或要求停止无关 live process。
- Broad gate 只在无关 dirty-checkout path 失败；报告后停止调查。

## Deferred Follow-on Plans

本计划完成后才分别编写：

1. **Queue-to-Goal continuation Bridge：** Goal-owned durable grant、one-shot wakeup、现有 Goal Round budget、revocation、replay prevention 和 audit event。
2. **Multi-host Session ownership：** Session/Agent lease 和 authenticated runner coordination；Queue 消费结果，但不拥有 lease。
3. **Byte-exact Artifact capability：** 只有当前 non-Attachment consumer 证明现有服务无法提供其 storage、retrieval、authorization 和 retention semantics 后才开始。

## Self-Review Checklist

- 每个 Task 都命名 dependency、file、interface、RED/baseline evidence、completion evidence 和 escalation。
- 后续 Task 使用的每个 public type 都在 Frozen API 章节定义。
- 最早的真实 worker 和 image slice 在 broad verification 前运行。
- Queue core 不依赖 WorkKind Provider。
- Recovered 和 shutdown Attempt 不能在 root lock 释放后消失。
- Batch `maxParallel`、host capacity 和 resource capacity 都能在 test 中观察。
- Notification content 是可信 metadata；typed output 必须通过 `task_queue_result`。
- Agent Teams 和 Queue 只共享 pure Session acceptance projection。
- Attachment normalization 是显式 product risk，而不是隐式 storage substitution。
- P3 continuation 和 multi-host Session ownership 继续位于 Queue core 之外。
