# Agent Note: 任务队列 P0 业务收敛——owner、通知、TaskOutcome、所有权锁与授权

Status: implemented

[English](2026-08-26-task-queue-p0-business-closure.md) | 中文

## Problem

对当前 master 上 task-queue 的实现审查确认了四个 P0 缺陷，后续 coherence 审查又发现三个额外缺口：

1. **工具入队的任务丢失了 owner session。** `task_queue_enqueue` 与 `task_queue_enqueue_batch` 入队任务时不带 `ownerSessionId`，导致 `commitTerminal` 不创建通知，任务结果永远无法送达调用方 session。
2. **append-before-ack 崩溃窗口让通知永久卡住。** pre-step 钩子过滤掉 marker 已在会话中的候选——但从不启动 finalizer，因此消息已 append 但 ack 尚未持久化的通知会永远停在 `pending`。
3. **`TaskResult.durationMs` 始终为 0，result 不携带 stdout/stderr/logPath。** Agent 从 `task_queue_status` 拿不到 exit code 之外的任何可消费工作成果。
4. **`TaskQueueStore` 假定单写者却不提供跨进程互斥。** 同一 `queueRoot` 上的第二个宿主进程会把第一个进程的存活 starting/running 任务当作崩溃遗留来 `recover()` + `reclaimCrashed()`。
5. **`TaskResult` 过于"进程导向"，不是 Agent 可消费的工作成果。** 缺少人类可读的 `summary`，执行器适配器也没有产出摘要的标准化 seam。
6. **`ownerSessionId` 只是通知路由字段，不是授权边界。** 其他 session 可以 cancel、retry、dismiss 任意任务，无需所有权。
7. **通知消息只携带状态，不携带结果。** Agent 必须额外调用 `task_queue_status` 才能了解任务产出。

## Decision

### 1. Owner session 绑定

`ownerSessionIdOf(exec)` 在工具层从 `exec.agent?.session.id` 提取调用方 session id。`task_queue_enqueue` 与 `task_queue_enqueue_batch` 调用它并将结果写入 `spec.ownerSessionId` 后再传给 service。模型无法自行设置 `ownerSessionId`——`validateEnqueueSpec` 不接受此字段（它不在 `SPEC_PARAM.properties` 中）——因此只有受信代码路径能注入。无 Agent 的宿主面调用（inbox 扫描）产生无主任务，不生成通知。

下游 `createTask` 与 `commitTerminal` 已有 `ownerSessionId ?? null` 和 `ownerSessionId === null → 无通知` 的逻辑，无需改动。

### 2. append-before-ack 崩溃恢复

pre-step 钩子不再静默跳过 marker 已在会话中的候选。当发现 pending 通知的 marker 已存在于会话 user 消息中时，它会将 `messageId` 加入 `inFlight` 并立即调用 `finalize(session, notificationId, messageId)`——与 `session/event` 监听器使用的同一个 flush→CAS finalizer。finalizer 的 CAS ack 是幂等的：已 acknowledged 的通知直接返回。未注入的候选不受影响，走正常的 inject→append→observe→finalize 路径。

### 3. TaskResult 增强

`TaskResult` 新增三个可选字段：`logPath`（本次 attempt 的 run log）、`stdoutTail`（stdout 最后 4 KiB，UTF-8 安全截断）、`stderrTail`（stderr 最后 4 KiB）。`durationMs` 从 `0` 改为基于 `actualStartedAt` 计算的实际 wall-clock span。`outputFiles` 列出 output 目录下的一级产物文件名。所有新字段均为 optional，不会破坏既有 snapshot 或 schema 校验。完整输出始终在 run log 与 output 目录中可查；tail 截断仅作为 Agent 可消费的摘要投影。

### 4. 跨进程单写者所有权锁

`lock.ts` 导出 `acquireQueueOwnership(root)`，它将一个完整的 `owner.lock` 临时文件写入、fsync，然后通过原子 `link(2)` 在 queue root 创建锁文件。锁文件内容为 `{version, pid, bootId, hostname, acquiredAt}`。link 失败时读取现有锁：存活 pid（或同一进程）拒绝启动；死 pid 归档到 `quarantine/` 并重试一次；不同 hostname 始终拒绝。`LocalTaskQueue.boot()` 在 `store.recover()` 与 `reclaimCrashed()` 之前调用 `acquireQueueOwnership`，因此第二个宿主进程在能读取持久日志之前即被拒绝。拆卸时锁以 best-effort 释放；残留文件会在下次 acquire 时由 stale-takeover 路径恢复。

### 为什么用 `link(2)` 而不是 `flock`

Node.js 不暴露 `flock()`。`proper-lockfile` 等库使用 `rename` 或 `open('wx')` 竞争，但 Windows 上 `rename` 覆盖已存在目标是 POSIX 语义，NTFS 不保证。`link(2)` 在 NTFS 上是原子操作（硬链接不能覆盖已存在目标），且不需要额外依赖。

### 为什么不在锁中嵌入心跳

心跳引入定时器和额外 I/O。用 `kill(pid, 0)` 做 pid 存活检查对单机场景足够：进程死时 OS 回收 pid，且 `bootId`（UUID）区分不同启动，即使 pid 被复用也不会混淆。

### 为什么 TaskResult 只带 tail 而非完整输出

完整 stdout 可能很大（按收集上限 256 KiB × 2 流）。写入 change record 会膨胀持久日志与 snapshot。4 KiB tail 足够 Agent 判断任务是否产出了有用结果；完整输出始终在 run log 与 output 目录中可查。

### 为什么 owner 绑定在工具层而非 `enqueueFromTool` 内部

`enqueueFromTool` 是 service 层受信入口，inbox 扫描也走它，inbox 任务天然无 owner。把绑定放在工具层保持了 service 的来源无关性：工具负责从执行上下文提取 owner，inbox 负责不提供 owner，service 不关心来源。

### 5. TaskOutcome：summary 与 normalize seam

`TaskResult` 新增必填的 `summary` 字段——一段人类可读的摘要，owner Agent 可直接从通知中消费，无需额外调用 `task_queue_status`。`assistantText` 是可选的语义结果字段，供编码 agent 执行器（DSH/Claude/Codex）使用。

`ExecutorAdapter` 新增可选的 `normalize(task, stdout, stderr)` 方法，产出 `{ summary, assistantText? }`。调度器在 exit code 0 时调用它；若适配器未提供，调度器会从 exit code、duration、tail 存在性与输出文件数量生成合理的默认摘要（如 "exit 0, 3.2s, stdout captured, 2 output files"）。

### 6. cancel / retry / dismiss 的 owner 授权

`assertOwnerOrHost(exec, ownerSessionId)` 强制调用方要么是任务的所有者 Agent（其 session id 匹配 `ownerSessionId`），要么是宿主操作员（无 Agent 上下文）。非 owner Agent 尝试操作其他会话的任务将被拒绝并给出明确提示。无主任务（`ownerSessionId === null`）只能由宿主操作员操作——任何 Agent 都不能认领。

检查在工具层应用于 `cancel`、`retry`、`dismiss`、`undismiss`。Service 本身不强制 ownership，`task_queue_status`/`task_queue_list` 仍对任何调用方暴露任务数据。将授权检查下沉到 Service seam 留待后续版本。

### 7. 通知中包含 outcome summary

通知消息现在在任务成功且带有结果时包含 outcome `summary`。pre-step 钩子从 `task.result.summary` 提取摘要，经 `NotificationCandidate` 传给 `renderNotification`。消息格式从：

```
Background task "X" reached succeeded.
Inspect it with task_queue_status, or retry with task_queue_retry if it failed.
```

变为：

```
Background task "X" reached succeeded.
Outcome: exit 0, 3.2s, stdout captured, 2 output files
Inspect it with task_queue_status for details.
```

失败任务省略 `Outcome:` 行，因其没有 `result`。

## Alternatives considered

**在 `enqueueFromTool` 内部注入 `ownerSessionId` 而非工具层。** 这需要把 session id 传过 service 接口，把 service 契约耦合到 agent 生命周期。service 已有两个调用方（工具与 inbox），各有不同的所有权语义，在调用方边界做区分更干净。

**用 `flock` 或 `proper-lockfile` 做跨进程锁。** 拒绝，因为 Node.js 不暴露 `flock`，且 `proper-lockfile` 基于 `rename` 的方案在 Windows NTFS 上不保证原子性。`link(2)` 是单次 syscall，在队列运行的每个平台上都有正确的语义。

**在 `TaskResult` 中包含完整 stdout/stderr。** 拒绝，因为持久 change record 不该承载无界输出。run log 已保存完整输出；tail 是诊断快照。

**在 append-before-ack 场景下重新注入已 append 的消息。** 拒绝，因为会在会话中产生重复通知。marker 是稳定的，CAS ack 是幂等的，直接启动 finalizer 既正确又不重复。

**把 owner 授权下沉到 Service seam。** 暂缓。Service 目前没有"调用方身份"概念（它接收纯 `TaskId` 参数）。为每个 mutation 添加 session 参数需要 inbox 扫描（宿主面运行）携带合成身份，且 remote backend 需要转发它。工具层检查对当前单宿主部署模式足够。

**将 `summary` 设为 optional 并提供默认值。** 拒绝。每个 `succeeded` 任务都应产出人类可读的摘要；当适配器省略 `normalize` 时始终生成默认值，因此 `summary` 在实践中从不缺失。设为 optional 会掩盖"每个 succeeded 任务都有摘要"这一不变式。

## Consequences

- 工具入队的任务现在携带 owner session，终态转变时产生通知。inbox 任务保持无主、不通知。
- append-before-ack 崩溃窗口已关闭：消息在 ack 持久化之前已 append 的通知，会在下一次 pre-step 交给 finalizer 并被消费，不重复。
- `task_queue_status` 现在返回有意义的 `durationMs`、用于审计的 `logPath`、可消费的输出 tail、以及人类可读的 `summary`。Agent 无需读 run log 即可检查任务结果。
- 同一 `queueRoot` 上的第二个宿主进程在能读取持久日志之前即被拒绝，防止了存活任务的静默损坏。拆卸时释放锁，残留文件由 stale-takeover 路径恢复。
- 原 `lock.ts` 会静默接管自己锁（将其当作 stale 处理）的同进程重入现在被显式拒绝。
- `ExecutorAdapter` 现在有 `normalize` seam，将原始进程输出转换为 Agent 可消费的结果。适配器省略时调度器生成合理的默认摘要。
- 通知消息现在对 succeeded 任务包含 outcome `summary`，owner Agent 无需额外 `task_queue_status` 调用即可消费结果。
- `cancel`、`retry`、`dismiss`、`undismiss` 在工具层强制 owner 授权：只有任务的所有者 Agent 或宿主操作员可操作。非 owner Agent 被拒绝并给出明确提示。无主任务只能由宿主操作员操作。

## Testing

- `packages/task-queue/tool-task-queue/tests/index.spec.ts`（42 个测试）：append-before-ack 测试现在验证 finalizer 被启动（flush 被调用、ack 完成、inFlight 清除）。三个测试验证 `enqueue`、`enqueue_batch` 与宿主面调用的 owner 绑定。十个授权测试验证 owner 可以 cancel/retry/dismiss、非 owner 被拒绝、宿主操作员被允许。两个通知摘要测试验证 outcome 行的包含/排除。
- `packages/task-queue/task-queue-local/tests/lock.spec.ts`（7 个测试）：首次 acquire、二次 acquire 拒绝、不可读内容、跨主机拒绝、存活 pid 拒绝、stale-takeover、release 后重新 acquire。
- `packages/task-queue/task-queue-local/tests/lifecycle.spec.ts`（9 个测试）：真实 `node` 任务产出 stdout、stderr 与 output 文件，断言 `summary` 匹配预期模式、`durationMs > 0`、`logPath` 匹配、`stdoutTail`/`stderrTail` 包含预期字符串、`outputFiles` 列出产物。