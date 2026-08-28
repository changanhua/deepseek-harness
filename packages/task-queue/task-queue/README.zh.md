# @deepseek-ai/dsh-task-queue

[English](README.md) | 中文

跨会话持久任务队列的契约（`ctx.taskQueue`）。抽象 `TaskQueue` 服务与其词汇表——任务模型、两阶段状态机、change 记录 schema、fold 与 canonical digest 规则、执行器适配器形状、`task-queue/*` 事件面——让 [`dsh-task-queue-local`](../task-queue-local/README.zh.md) 的持久后端与 [`dsh-tool-task-queue`](../tool-task-queue/README.zh.md) 的 agent 工具集共享同一套身份与 mutation 语义。设计文档见 [docs/specs/2026-08-14-task-queue-design.md](../../../docs/specs/2026-08-14-task-queue-design.md)。

## Service 契约

每个任务数据操作都把不透明的 `TaskQueueAccess` 作为第一个参数。`taskQueueAgentAccess(sessionId)` 签发只限于该精确归属会话的授权；`TASK_QUEUE_HOST_ACCESS` 是受信宿主面插件使用的单例全队列授权。运行时校验只接受已登记的授权对象身份，不接受字段副本。任务或通知 id 不存在与无权访问时均返回相同的未知记录错误，因此 Service 不会泄露某个 id 是否由其他会话持有。

- `enqueueFromTool(access, spec)` 以 `source: 'tool'` 接纳单条任务；Agent 授权从自身绑定 `ownerSessionId`，宿主授权则可接纳显式有主或无主任务。后端拒绝 `executor: 'shell'`、分配 receipt，并按已认证调用主体隔离显式幂等键。`enqueueBatchFromTool(access, specs)` 是有界批量形式（每次上限 200）。
- `list(access, filter?)` 与 `get(access, id)` 只返回该授权可见的任务；归属过滤先于公开过滤器和 `limit` 执行。
- `cancel(access, id)` 返回 `'canceled'`（pending 任务）或 `'stopping'`（starting/running 任务上持久化的取消意图）。`retry(access, id)` 清零 `attempt` 并把 failed 任务重新入队；`dismiss(access, id, dismissed)` 只更改可访问的终态任务。
- `stats(access)` 报告全局服务健康状态，以及只由该授权可见任务计算出的按状态与按执行器计数。
- `registerExecutor(name, adapter)` 注册 prepare-only 适配器并返回其 disposer。适配器的可选 `normalize()` 方法将原始进程输出转换为 Agent 可消费的 `summary` 与可选 `assistantText`——这是将进程队列升级为工作队列的关键 seam。调度器在 exit code 0 时调用 `normalize()`；若适配器未提供，则生成合理的默认摘要。
- `pause(TASK_QUEUE_HOST_ACCESS)`/`resume(TASK_QUEUE_HOST_ACCESS)` 只允许宿主授权闸控准入；`resume()` 必须拒绝 `faulted` 队列。
- `ackNotification(access, notificationId, messageId)` 用 CAS 确认一条可访问的 pending 投递记录；已 acknowledged 且 messageId 匹配的记录是幂等 no-op。`listNotifications(access)` 按 `terminalSeq` 返回一个 Agent 会话的记录，或宿主可见的完整记录。

所有 mutation 都经后端的服务级 FIFO 串行化，append 出错即 fail-closed——队列进入 `faulted`，任何调用方都不能用 `resume()` 把它带走。

## 任务模型

`Task` 携带完整持久快照：状态（`pending`/`starting`/`running`/`stopping`/`succeeded`/`failed`/`canceled`）、`attempt`/`maxAttempts`、`backoffMs`、`delayUntil`、`timeoutMs`、可选 `workspaceDir`、`outputDir`、tags、`lastError`、`result`、`ownerSessionId`、受信 `source`/`receiptId`，以及每次 attempt 的 `RunRecord[]`（`runId`、attempt、仅供诊断的 `pid`、时间戳、日志路径、命令指纹、`terminationUnverified`）。需要操作现有 checkout 的执行器以 `workspaceDir` 作为进程工作目录，`outputDir` 仍是队列持有的产物目录；缺少 `workspaceDir` 的旧记录会在物化时沿用 `outputDir`。

`TaskResult`（在 `succeeded` 时填充）携带人类可读的 `summary`（如 "exit 0, 3.2s, 2 output files"）、可选的 `assistantText`（DSH/Claude/Codex 等编码 agent 执行器产生的语义结果）、`exitCode`/`signal`、wall-clock `durationMs`、可选的 `logPath`（本次 attempt 的 run log）、有界 `stdoutTail`/`stderrTail`（各最多 4 KiB）、以及 `outputFiles`（output 目录下的一级产物文件名）。完整输出始终在 run log 与 output 目录中可查；tail 截断仅作为 Agent 可消费的摘要投影。

`attempt` 只在领取时（`pending → starting`）递增一次。失败回 `pending` 且 `attempt` 不变，退避延迟 = `backoffMs * 2^(attempt-1)`；耗尽 `maxAttempts` 进入 `failed`。宿主崩溃时 `starting`/`running` 走失败路径恢复，`stopping` 恢复为 `canceled` 并标 `terminationUnverified`——持久化 pid 只作诊断，绝不是跨重启的终止授权。

## Change 记录与折叠

`ChangeRecord` 是判别联合：任务 op（`created`/`starting`/`running`/`stopping`/`succeeded`/`failed`/`requeued`/`canceled`）携带 op 之后的完整 `state` 快照，终态转移还可原子附带一条 `notification`；`notification-acknowledged` op 携带 CAS 三元组（`notificationId`、`expectedStatus: 'pending'`、`expectedMessageId`）。

`foldChanges` 以 fail-closed 方式折叠有序流：严格 `seq` 单调（`lastSeq + 1`）、任务 op 身份（`state.id === taskId`）、终态通知一致性、CAS ack 语义——任一不满足即抛错，绝不跳过坏记录。`applyChange` 是后端在每次提交追加后使用的增量单步折叠。

`canonicalJson` 与 `canonicalQueueState` 做确定性序列化（UTF-8、无额外空白、键递归排序、tasks/notifications 按 id 升序），快照摘要永远不依赖运行时对象插入顺序。

## 事件

`task-queue/created`、`task-queue/starting`、`task-queue/running`、`task-queue/succeeded`、`task-queue/failed`、`task-queue/requeued`、`task-queue/canceled`、`task-queue/drained`、`task-queue/orphan-unknown`、`task-queue/faulted`——每个都在对应 change 完成 fsync 并折叠后才发布。

## Model Experience

间接地，经由 [`dsh-tool-task-queue`](../tool-task-queue/README.zh.md)，它渲染 `task_queue_*` 工具、`tool:task-queue` 提示词段落与通知投递消息；本契约自身不注册任何模型面。

#### KV Cache effect

无直接失效；命名的消费者拥有任何 request-prefix 变更。

## 已知限制与待办

- **at-least-once 执行**——spawn 与 running 记录之间崩溃可能留下未知孤儿；attempt 与逐次日志使重复可追溯。
- **无 segment GC**——v1 不删除已封段，恢复从不依赖 GC 协议。
- **`faulted` 是粘滞的**——只有成功的日志重判定或运营恢复 + 重启才能清除。
