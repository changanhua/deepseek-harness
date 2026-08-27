# Typed Work Queue v2 与 AgentPlan 图片纵向链路

[English](2026-08-26-typed-work-queue-v2.md) | 中文

> 本计划是当前实现依据。优先级是：先证明 Queue 的类型化执行与图片批次性能，再完成全部产品入口迁移。

## 全局约束

- 保留当前工作树中的 Queue WIP；不得 reset、clean、覆盖无关修改或触碰 `.dsh-intelligence/` 与仓库根 `outputs/`。
- 包名 `task-queue` 保持不变；新领域语言统一使用 `WorkItem/WorkState/WorkAttempt/WorkResult/WorkHandler/WorkKind`。
- `ChangeSet` 是唯一持久化原子单位，`DomainEvent` 只是其中的逻辑事实。
- caller intent 先 canonicalize 并查幂等 receipt；命中后直接返回原 ID，不再做外部解析。首次 admission 才调用 `resolveAdmission()` 并持久化 resolved spec。
- `prepare()` 只做 dispatch 准备；`start()` 必须同步返回 `LiveAttempt`，真实副作用只能从 `start()` 开始。
- 自动重试必须同时满足 `retriable=true` 与 `sideEffect=not-started`；`unknown` 是阻塞新 Attempt 的非终态，只有 operator resolution 能解除。
- Handler 只声明 `ResourceClaim`；部署配置声明 capacity。调度取全局并发、资源 capacity 与 Batch `maxParallel` 的最小值。
- Artifact 必须先写入耐久位置并 fsync/atomic rename，再提交引用它的 terminal `ChangeSet`。
- 不实现 v1 decoder 或 migrator。先在 canary root 完成真实单图和十图验收，最后才删除 canonical v1 root。

## Task 1：Queue v2 领域与公共接口

负责 `packages/task-queue/task-queue`。先写 RED 测试，再替换 executor-centric 类型、fold 与 transitions。

公开接口固定为：

```ts ignore-check
interface ChangeSet {
  seq: number
  changeId: string
  at: string
  events: readonly DomainEvent[]
}

interface WorkHandler<K extends WorkKind> {
  readonly kind: K
  resolveAdmission(input: WorkInput<K>, context: AdmissionContext): Promise<ResolvedWork<K>>
  resources(resolved: ResolvedWork<K>): readonly ResourceClaim[]
  prepare(resolved: ResolvedWork<K>, context: PrepareContext): Promise<PreparedWork<K>>
  start(prepared: PreparedWork<K>, context: StartContext): LiveAttempt<K>
}
```

实现不可变 Work、独立 State/Attempt/Result/Batch/Attention/Receipt、Service 层 authority、原子 Batch、intent digest、unknown resolution 和 declaration-merging `WorkKindMap`。纯领域测试覆盖原子 terminal、原子 Batch、attempt ordinal、幂等冲突、unknown 阻塞、attention CAS 以及 operator resolution。

## Task 2：v2 Store、调度与 fake Handler vertical

负责 `task-queue-local`。保留 owner lock、FIFO、append/fsync、segment continuity、torn-tail repair、snapshot digest、inbox quarantine 与 notification CAS；改为 v2 `ChangeSet` codec 和新 fold。

- 新增 root manifest `schemaVersion: 2`，未知或 v1 root fail loud。
- snapshot tail 从已有 `lastSeq` 增量 fold。
- append 故障按目标 seq + canonical ChangeSet digest 精确判定。
- Batch admission 只 append 一个 ChangeSet；append 失败零成员可见。
- `attempt/started` 落盘后调用同步 `start()`，再提交 `attempt/running`。
- crash/recovery 无法证明结果时进入 unknown，不重跑。
- `resolveUnknown()` 支持 reconcile、confirm-succeeded、confirm-failed、authorize-retry。
- pause 只暂停 dispatch；入队、读、取消、ack、reconcile 继续可用。

用 fake Handler 打通 admission → dispatch → durable artifact/result → notification；覆盖取消竞争、shutdown quiescence、资源容量与 HMR dispose。

## Task 3：共享图片能力、ArkCLI Provider 与 Queue Handler

新增 `packages/image/image-generation`、`packages/image/image-generation-arkcli` 和 `packages/task-queue/task-queue-handler-image`。

- admission 顺序：intent receipt lookup → `arkcli profile show` 一次 → image resources 一次 → 每个唯一 canonical model 查询 `supported_params` 一次 → 原子持久化 resolved spec。
- dispatch 后不得再次执行 profile/resource/model discovery，只消费持久化 spec。
- 当前 profile 必须是 AgentPlan 类型；resolved profile 名写入 spec，所有后续命令显式 `--profile`。
- `image.generate@1` 支持 `png|jpeg`、尺寸和 boolean watermark；Provider 必须输出 `--watermark=<value>`。
- 请求参数不被模型 `supported_params` 支持时 admission 明确失败，不静默降级或本地转码。
- `+gen` 通过 `ctx.subprocess` 直接运行，不启动 DSH Agent、不复制 HOME、不保存密钥或预签名 URL。
- 输出先解码、核对尺寸/媒体类型、计算 sha256，再以私有临时文件 → fsync → atomic rename 写入 Queue artifact，最后提交 terminal ChangeSet。
- failure 同时携带 category、sideEffect 与 retriable；timeout/transport 不能凭错误名自动重试。

假 ArkCLI loader vertical 必须证明统一模型十图批次的预期无重试调用为 `profile 1 + resources 1 + capability 1 + generation 10`，DSH worker 为 0。

## Task 4：尽早 canary 与性能验收

在 `C:\Users\xbh\.dsh\task-queue-v2-canary` 启动 v2，不影响 canonical v1。

1. 真实生成一张 2048x3072 PNG，检查 Queue succeeded、attempt=1、artifact 解码/尺寸/哈希、provider/model、安全结果和零 DSH worker。
2. 提交一个十本世界名著的 `image.generate@1` 原子 Batch。调用 Agent负责为每本书确定风格和完整提示词；统一模型，默认资源 capacity=3。
3. 保存首图时间、总时间、每分钟成功数、ArkCLI 子进程分类计数、DSH worker 数、attempt/retry/审核/429 计数。
4. 只有 canary 正确且明显优于旧基线“约 16 分钟 3 张、6 个 DSH worker”才继续正式 cutover。

## Task 5：模型工具、命令、Remote 与 Web UI

迁移 Tool、`/queue`、Remote 和 UI 到 Work/Batch/Attempt/Attention 语义。

- 工具不接受 executor；提供 enqueue、atomic batch、list/status/batch-status/stats/kinds、cancel/retry、attention ack。
- Agent authority 只能操作自身 Work；unknown resolution 仅 operator。
- Remote 每次轮询用一个分页 `snapshot()` 返回 stats、rows 和可选 detail；批量动作在服务端一次完成。
- UI 按 Batch/独立工作分组，展示阶段、等待原因、attempt、progress、artifact 和 attention；unknown 提供 operator resolution；“暂停派发”不阻止入队。
- 当前 DSH worker WIP 迁为显式 `agent.run@1` Handler，默认 capacity=1，不作为已知类型任务的默认路径。

## Task 6：文档、正式切换与最终验证

- 新建当前事实的 Agent Note；旧 DSH executor Note 按归档规则交叉引用或归档，不把候选写成已实现事实。
- 更新相关 README/JSDoc、bundle、package/Client/Cordis catalogs 和 Queue skill，移除 executor-first 指导。
- 完成 focused tests 后运行一次 typecheck/doc-sync/package gates；浏览器验收前只 build 一次。
- 正式切换时读取 owner lock，确认实际 owner 已退出且 lock 释放；精确验证目标为 `C:\Users\xbh\.dsh\task-queue` 后删除整个 v1 root，再以 schemaVersion 2 初始化 canonical root。
- 明确保留 `C:\Users\xbh\deepseek-harness\outputs`、`.dsh-intelligence` 和其他无关 WIP。
- 最终执行真实 browser 交互、刷新恢复、批量操作、unknown resolution、console 检查和完整 Queue 相关测试。
