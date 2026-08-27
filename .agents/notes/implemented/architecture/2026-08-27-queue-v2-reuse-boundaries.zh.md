# Agent Note: Queue v2 职责与复用边界

Status: implemented

[English](2026-08-27-queue-v2-reuse-boundaries.md) | 中文

## Problem

Queue v2 需要提供进程内 Jobs、同 Session Goal、Subagent、Workflow、Schedule 和 Agent Teams 都不具备的 host 级持久 typed work、崩溃恢复、资源调度和 owner 可见结果。实现必须复用有界文本保留、Session 消息收件检测、图片存储和 WorkKind 专用准入，而不能把这些职责移入 Queue core。

Queue 闭环要求重启恢复出的 queued WorkItem 可以 dispatch、崩溃时的 starting 或 running Attempt 转为 unknown、teardown 在 active Attempt 结算前保持根锁，并且 Batch 遵守自身 `maxParallel`。只通知 Agent 去检查一个不返回 typed result 的状态工具，是生命周期通知，不是完整业务结果。

## Decision

Queue v2 继续作为独立能力 seam。Service Definition 拥有持久 Work 记录和 typed handler 注册；本地 Service Provider 拥有单写者存储、调度、恢复和 outbox；WorkKind Bridge 插件连接 Queue 与领域服务；Consumer 插件拥有模型、命令、Remote 和 Session 消息入口。Queue core 不导入任何领域 Provider、Goal、Jobs、Workflow、Subagent、Schedule 或 Agent Teams 实现。

本决定细化 [Queue v2 image canary](2026-08-26-queue-v2-image-canary.zh.md) 中 artifact 与 generic tool 的职责决定。它保留 [Queue v2 operator MVP](2026-08-27-queue-v2-operator-mvp.zh.md) 的四态投影，以及不暴露 reconcile 或未经验证的成功确认。

### Capability ownership

| 需求 | Owner | 与 Queue 的关系 |
| --- | --- | --- |
| 进程内 live work 和流式输出 | `ctx.jobs` | 生命周期独立；不依赖 Queue |
| host 级持久有限工作、Attempt、重试和恢复 | `ctx.taskQueue` | Queue core 职责 |
| 模型或 provider 图片生成 | `ctx.imageGeneration` | `image.generate@1` Bridge 消费它 |
| 持久标准化图片字节 | `ctx.attachments` | Image Bridge 通过它存储输出引用 |
| 子 Agent 身份和 continuation | `ctx.subagents` | 不是 Queue executor 抽象 |
| 同 Session 目标和 Round 预算 | `ctx.goals` | 后续 opt-in continuation Bridge 可同时消费两个服务 |
| 并行依赖编排 | Workflow | 可以提交 WorkItem，但 Queue 不执行 Workflow 语义 |
| 定时会话投递 | Schedule | 与 Queue 完成事件相互独立 |
| peer roster、mailbox 和 task board | Agent Teams | 可复用其 Session receipt helper；task board 不是 Queue backend |

### Package and dependency design

```text
@deepseek-ai/dsh-task-queue                 Service Definition
  ^                 ^                  ^
  |                 |                  |
task-queue-local    agent.run bridge   image.generate bridge
Store + scheduler   -> subprocess      -> imageGeneration
                                         -> attachments

tool-task-queue                    generic Agent control + owner delivery
tool-agent-run-task-queue          agent.run admission
tool-image-generation-task-queue   image.generate admission
command-task-queue                 trusted host command Consumer
task-queue-remote                  loopback operator Consumer
```

Provider 和 Consumer 依赖 `@deepseek-ai/dsh-task-queue`；Queue core 不依赖它们。Bundle 选择本地 Queue Provider、WorkKind Bridge、资源 capacity 和 agent-scoped Consumer 配置项。Handler 注册继续是 Cordis effect，并且必须触发已恢复 queued work 的 dispatch。

### Durable records

`ChangeSet` 继续作为唯一 append 单位。`WorkItem` 持久化 canonical intent、resolved execution facts、handler 派生的 `WorkPolicy` 和经过验证的 `ResourceClaim`。持久化 claim 可以防止重启后的 Handler 版本或部署变化悄悄改变已 admission work 所需的资源。

`BatchRequest` 包含同一种类、各自具有 title、input 和 tag 的条目。外部 admission resolution 完成后，一张 receipt、可选 Batch 和所有 WorkItem 在一个 ChangeSet 中提交。Provider 在 append 前于 mutation transaction 内重新检查 receipt。`Batch.maxParallel` 与 host `maxConcurrent`、资源 capacity 一起参与每次 claim 决策。

`Attention` 只表示需要 operator resolution 的 unknown Attempt。它有 `pending` 与 `resolved` 状态；`unknown/resolved` 和 `attention/resolved` 一起提交。不存在可以在 WorkItem 仍为 unknown 时隐藏 Attention 的独立 acknowledgement。

`Notification` 是 terminal `succeeded`、`failed` 或 `canceled` work 的 owner delivery outbox。它与 terminal event 在同一 ChangeSet 提交，携带不可变 Work、Attempt、Result、owner 和 message identity，绝不包含 executor output。dispatch 前取消时 Attempt id 为 null。ownerless work 不创建 Notification。

### Admission and scheduling

`WorkHandler.resolveAdmission()` 只在 receipt lookup 未命中后执行外部发现。Provider 各调用一次 `resources()` 与 `policy()`，验证完整值并随 WorkItem 持久化。同步 `start()` 返回 `LiveAttempt` 之前，任何 WorkHandler 方法都不得开始副作用。

本地 scheduler 串行执行持久 mutation，但在 transaction 外执行 admission resolution、prepare 和 live execution。claim 前同时计算全局 execution、每项持久 resource claim 和 WorkItem 所属 Batch 的 active member 数。缺失 capacity、非法 unit、非法 policy 或不可用 WorkKind 会让 admission 失败或产生稳定 blocked diagnostic；绝不能静默留下无法 claim 的 work。

Handler 注册在可见后调用 scheduler。打开 store 时先取得 Queue root 所有权，再执行 recovery。普通 dispatch 开始前，recovery 把每个持久 starting 或 running Attempt 转成 unknown，并在同一 ChangeSet 创建一个 Attention，因为外部 start 与 running append 之间的崩溃无法证明副作用是否开始。

Provider dispose 会关闭 admission 和 dispatch，为每个尚无记录的 active WorkItem 提交 `cancel/requested`，abort 每个 active execution，请求 `LiveAttempt.cancel()`，并在配置的 shutdown bound 内等待 settlement。已结算 outcome 正常提交。cancel 错误或 deadline 会在 store 释放 Queue root 锁前提交 unknown 与 Attention。live attempt 未由持久 terminal 或 unknown record 表示时，绝不释放锁。

### Owner delivery and result collection

generic Agent facade 暴露 pending Notification 和 owner-fenced acknowledgement。Agent Consumer 只把稳定 trusted-reference message 添加到已接受的 `agent/pre-step` 输入，不唤醒 idle Agent。它观察匹配的持久 `user/message`，flush owner Session，然后按 Notification id 和 message id acknowledgement。重启时使用 Agent inbox projection helper 区分已接受消息和缺失消息，绝不复制稳定 identity。

稳定消息标识 Work、Attempt、terminal outcome 和 Result id，并指引 Agent 使用 `task_queue_result`。它绝不包含 assistant text、stderr、prompt、path 或 artifact bytes。`task_queue_result` 通过普通 tool-result retention policy 返回 owner 可见 typed result 或 structured failure，因此 executor content 只会在显式读取后变为 model-visible，并记录为 tool result。

当前 Agent Teams 私有的纯 Session 消息 receipt helper 移入拥有 `agent/inbox/spliced` 的 Agent inbox 模块。Agent Teams 与 Queue delivery 共享该 helper；两者的持久 mailbox 和 outbox 状态机仍然独立。

### Result storage

Queue core 持久化 typed JSON result，不提供 generic filesystem writer。Image Bridge 通过 `ctx.attachments` 写入生成图片，并在 `ImageGenerateOutput` 中存储 `ImageAttachmentRef`。这会复用内容寻址持久化、验证、replay 和授权读取，而不是发布 Queue root host path。

如果当前 consumer 要求 attachment normalization 无法保留的 byte-exact 非图片输出或图片原件，该需求必须证明独立 Artifact Service Definition、Provider、检索 Consumer 和 authority model 的必要性。私有 Queue-local path writer 不是 fallback。

### WorkKind Consumers

`tool-task-queue` 拥有 generic list、status、result、cancel、retry、kinds、prompt guidance 和 owner Notification delivery。它不导入特定 WorkKind 包，也不注册 admission schema。

`tool-agent-run-task-queue` 拥有单项和 Batch `agent.run@1` admission。`tool-image-generation-task-queue` 拥有单项和 Batch `image.generate@1` admission。Image Batch tool 接收完成的 visual prompt；prompt 专业知识在 Queue admission 前通过显式选择或固定版本的 Skill 执行一次。Queue worker 绝不为了编写 prompt 而为每张图启动一个 Agent。

### Future continuation

Task success 不授予继续 owner Goal 的权限。后续可选 Bridge 可以消费 Queue Notification 和 Goal 拥有的 durable continuation grant，再通过 Agent 或 Session runner 请求一次 bounded wakeup。Goal 拥有 objective revision 和 Round budget；Session runtime 拥有任何 multi-host lease。Queue 仍是 terminal fact producer，不成为 Goal scheduler 或 Session coordinator。

## Alternatives considered

**使用 Jobs 作为 Queue backend。** 否决，因为 `JobStart` 在一个进程中捕获 callback 和精确 live Agent 对象。适配它会在 wrapper 内重新实现 durable identity、recovery、Attempt、receipt 和 ownership 语义。

**把所有 admission 留在 generic `tool-task-queue`。** 否决，因为一个 Consumer 会决定 WorkKind-specific schema 和 dependency。它已经硬编码 `agent.run@1`，而 image path 证明 domain admission 会独立演进。

**为可能出现的未来文件保留 Queue-owned `ArtifactWriter`。** 当前范围否决，因为 image generation 是唯一 consumer，而 DSH 已有持久图片 store。假设中的 generic file consumer 不能证明 public path-based abstraction 的必要性。

**把 Agent Teams mailbox 复制到 Queue delivery。** 否决，因为 Session acceptance projection 才是重复 invariant。Queue Notification 与 Team mailbox state 继续由各自领域拥有，而 pure projection helper 共享。

**消息进入 inbox 时 acknowledgement owner Notification。** 否决，因为本提案把 acknowledgement 定义为持久写入 `user/message` 加 Session flush 成功。pending inbox data 可防止复制，但不能证明已接受 step 记录了消息。

**允许 generic reconcile 和 operator-confirmed success。** 否决，直到 WorkKind-specific reconciler 能证明 live ownership 或验证 typed recovered result。没有 `LiveAttempt` 就把 unknown Attempt 改为 running，或者把任意浏览器 JSON 当成 success，都会捏造证据。

**把 automatic continuation 放入 Queue core。** 否决，因为 task completion 是 fact，而花费另一个 Agent Round 的权限属于 Goal 和 Session policy。

## Verification

聚焦确定性覆盖验证 recovery、shutdown ownership、原子 Batch admission、Batch 与资源容量、owner-fenced Notification、Session flush 先于 acknowledgement、restart 去重、显式 typed result 读取、Attachment-backed 图片和受限 worker 组成。

真实 `agent.run@1` 纵切以 Work `21e5bb63-f4df-4601-b81a-0ae501606684` 完成，产生稳定 owner Notification，显式结果包含 `QUEUE-V2-OWNER-DELIVERY-OK`。真实十图 Batch `2cd643c7-1a56-4877-8b1e-fb13215f81e5` 完成 10 个 Attachment-backed 结果，观测并发为 3，图片生成没有启动 task-worker 进程。

- 干净重启后，recovered queued work 会在 Handler 注册后 dispatch。
- 每个 recovered starting 或 running Attempt 会在新 dispatch 前转为 unknown，并创建一个 durable Attention。
- graceful shutdown 和 bounded-failure shutdown 只在每个 active execution 都持久 terminal 或 unknown 后释放 Queue ownership。
- 并发重复 Batch admission 只产生一个 receipt 和一个 Batch；`maxParallel`、resource capacity 和 global capacity 全部执行。
- 非法 claim 和 policy 会显式失败，不会让 queued work 饥饿。
- unknown resolution 只允许 confirmed failure 或 authorized retry；resolution 原子清除其 Attention。
- 每个 terminal owner outcome 创建一个 same-ChangeSet Notification；owner Session flush 先于 Notification acknowledgement；重启不复制稳定消息。
- owner 可以使用 `task_queue_result` 显式取得 typed result。
- DSH worker diagnostic 使用 `TextRetainer`；image output 使用 `ctx.attachments`；generic Queue core 不拥有这两个机制。
- 一个真实 restricted `agent.run@1` WorkItem 和一个十项 `image.generate@1` Batch 通过 Queue 与各自 typed handler 完成，不产生 recursive Queue 或 per-image Agent startup。typed Consumer admission 与最终 composition 由确定性测试验证。

## Consequences

通过 `ctx.attachments` 保存 image output 可能会 normalize 未来 consumer 希望原样保留的字节。在当前 consumer 证明独立 Artifact capability 的必要性前，byte-exact original retention 不属于 Queue。

共享 Session receipt helper 增加了 Agent package 的 public utility API。它保持为 Session event 上的 pure projection，而不是第二个 mailbox 或 delivery service。

Shutdown 无法强迫外部 provider 证明最终 outcome。因此 bounded path 会增加 operator Attention，而不是猜测成功、失败或安全重试。

拆分 WorkKind admission 会为 `agent.run@1` 增加一个 package 和 Bundle row；它消除了具体的跨领域依赖，并为后续 WorkKind 建立稳定 composition pattern。
