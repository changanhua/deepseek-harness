# @deepseek-ai/dsh-tool-task-queue

[English](README.md) | 中文

`ctx.taskQueue` 的面向模型工具包：八个 `task_queue_*` 工具、一个工具指引提示词区段、一个 pre-step 候选通知钩子，以及 append→flush→CAS-ack 通知 finalizer。一次 apply 即注册全部内容——钩子不会被拆进多个会重复监听的挂载。宿主 Service 通过 `ctx.get('taskQueue')` 可选读取：未组装后端时工具仍会注册，但其 `execute` 会带明确的加载指引报错，pre-step/finalizer 钩子则直接空转。

`enqueue` 与 `enqueue_batch` 会把调用方 session 绑定为任务的 `ownerSessionId`，使终态通知能路由到正确的会话。模型无法自行设置该字段——`validateEnqueueSpec` 会从模型输入中剥离它——因此只有受信代码路径能注入。无 Agent 的宿主面调用（例如 inbox 扫描）产生无主任务，不生成通知。

`cancel`、`retry`、`dismiss`、`undismiss` 实施 owner 授权检查：调用方 Agent 必须是任务的所有者（其 session id 与 `ownerSessionId` 匹配），或者调用方为无 Agent 上下文的宿主操作员。非 owner 的 Agent 尝试操作其他会话的任务将被拒绝并给出明确提示。无主任务（无 `ownerSessionId`）只能由宿主操作员操作。

## 工具

- `task_queue_enqueue(spec)` 入队一个持久的、跨会话的任务。`spec` 必含 `title`、`prompt`、`executor`，可选携带 `priority`、`maxAttempts`、`backoffMs`、`delayUntil`、`timeoutMs`、`outputDir`、`tags`、`idempotencyKey`。它拒绝 `executor: 'shell'`（仅限 inbox），并把 `idempotencyKey` 校验为 1–128 字节且不含 NUL。
- `task_queue_enqueue_batch(specs)` 一次批量入队至多 200 个任务。任一 spec 的 `executor` 为 `shell` 都会让整个调用被拒绝。
- `task_queue_list(status?, executor?, tags?, limit?)` 列出摘要投影，按 status/executor/tags 过滤并受 limit 约束。入队前先调用它以避免重复工作。
- `task_queue_status(id)` 返回任务的完整持久记录，并把可空的 `delayUntil`/`lastError`/`result` 字段投影掉，使闭合的输出 schema 保持整洁。
- `task_queue_cancel(id)` 取消一个 pending 任务（或请求停止一个 starting/running 任务），返回 `{ outcome: 'canceled' | 'stopping' }`。
- `task_queue_retry(id)` 把一个 failed 任务送回 pending（重试次数清零）。
- `task_queue_stats()` 返回服务状态（`running`/`paused`/`faulted`）、各状态计数、可选的 fault 原因，以及各执行器计数。会话开始时调用它查看积压。
- `task_queue_executors()` 列出已注册的执行器及其启用状态，并标记模型工具是否可提交（`shell` 为 inbox-only）。入队前调用它选择可用的执行器。

`enqueue` 与 `batch` 使用 `execute` 类卡片；`list`、`status`、`stats` 使用 `read` 类卡片；`cancel` 与 `retry` 使用 `execute` 类卡片。

工具承载了队列的“何时使用”语义：当你有三个及以上独立任务、长耗时任务、可能需要重试的任务，或任何要跨会话存活的任务时入队；单条快速交互则内联完成。

## 系统提示词

插件注册一个独立排序的区段 `tool:task-queue`（order `107`，位于 `tool:jobs` 之后）：

```markdown
Use the task_queue_* tools for durable cross-session work. Enqueue a batch first, then report the queued ids — do not inline a batch of 3 or more independent tasks, long-running jobs, or anything that may need retry or should survive the session. At session start, call task_queue_stats to see the backlog, and task_queue_executors to see which executors this deployment enables. For batch LLM/script work use the node executor with a local script (prompt JSON { script, args? }); use claude/codex/opencode/arkcli only for full coding-agent jobs. Never submit shell (inbox-only). When a task is failed, report it proactively and suggest task_queue_retry. Do not re-enqueue duplicate work: call task_queue_list first to check for an existing matching task. Your responsibilities are delivery (enqueue), monitoring (list/status/stats/executors), failure triage (retry/cancel), and reporting results.
```

## Pre-step 候选通知

pre-step 钩子通过 `listNotifications` 读取该会话的待处理 outbox 通知，按 `terminalSeq` 排序，并提出候选通知消息。它跳过已经 `inFlight` 或已不再是 `pending` 的记录。对于 marker 已出现在会话 user 消息中的候选——即 append-before-ack 崩溃窗口——不会重新注入，而是直接交给同一个 flush→CAS finalizer 处理，因此消息在 ack 持久化之前已 append 的通知，能被可靠消费而不重复。每条提议的消息都内嵌一条稳定的 marker 行。当任务成功并带有结果时，消息中包含 outcome `summary`，使 Agent 无需额外调用 `task_queue_status` 即可消费结果：

```
[task-queue-notification <notificationId> <messageId>]
```

被选中的 `messageId` 会标记为 `inFlight`，使后续 pre-step 不再重复提议。该钩子只准备消息——绝不 flush、绝不 ack。agent loop 会在 waterfall 返回后 append 这些提议的消息；持久性由 finalizer 断言，而非本钩子。

## 通知 finalizer

`session/event` 监听器监视 `user/message` 追加中的 marker 行。命中时监听器立即返回（避免 append 重入），并启动一个受控的异步 finalizer：

1. `await ctx.sessions.flush(session)`。若没有持久化监听器参与、flush 失败或会话已失效，finalizer 会把该 messageId 从 `inFlight` 清除并让通知保持 pending——它不会 ack。
2. flush 成功后，用 `ackNotification(notificationId, messageId)` 进行 CAS ack，只让一个仍为 `pending` 且 message id 匹配的记录转为 `acknowledged`。ack 幂等：已 ack 且 id 匹配的记录是无副作用操作。

## turn/end 对账

在 `turn/end` 上，监听器对 `inFlight` 进行对账：凡是被标记、但其 marker 从未抵达会话 `user/message`（pre-step 决策在消息 append 前被 abort 或 reject）的 `messageId` 一律清除，使下一次 pre-step 能重新提议。否则，一次被中止的 pre-step 会把通知永远钉死。

## 配置

| key | 默认值 | 含义 |
|---|---|---|
| _(无)_ | — | `Config` 为空对象；插件仅为 loader 对称性而声明它 |

配置字段格式非法时，插件会在加载时报错。

## Model Experience

本工具集是任务队列的模型面：8 个 `task_queue_*` 工具的规范 schema 归档于 [docs/tool-catalog.md](../../../docs/tool-catalog.md)；`tool:task-queue` 提示词段落的全文在上方"系统提示词"一节声明；通知投递以带 marker 行的 `user/message` 注入，持久性由 finalizer 断言。

#### KV Cache effect

无直接失效；工具 description 与提示词段落的变更由本包拥有，任何 request-prefix 变更由命名的消费者声明。

## 已知限制与暂缓事项

- **无后端即无投递**——未组合 `@deepseek-ai/dsh-task-queue-local` 时，工具以清晰的加载错误拒绝，pre-step/finalizer 钩子 no-op，不产生任何通知。
- **`shell` 仅限 inbox**——模型面工具设计上永远不能入队 `shell` 任务（授权 §6.3）；只有 inbox 准入路径可以。
- **通知 at-least-once**——append 与 ack 之间崩溃会重新注入通知（按稳定 marker 去重），同一次完成可能浮现两次。
- **无主任务不产生通知**——无 Agent 的宿主面调用（例如 inbox 扫描）创建的任务不带 `ownerSessionId`，其终态不会通知。
- **Owner 授权在工具层实现**——`cancel`/`retry`/`dismiss`/`undismiss` 在调用 Service 前检查所有权；Service 本身不强制 ownership，且 `task_queue_status`/`task_queue_list` 对任何调用方暴露任务数据。后续版本可能将授权检查下沉到 Service seam。
