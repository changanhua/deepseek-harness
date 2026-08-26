# Task Queue Remote

[English](README.md) | 中文

浏览器面板在持久任务队列上的宿主远程面：一个轻量的 Typert Remote 服务，把 `ctx.taskQueue` 的读取形态（`list` / `stats` / `get`）与操作动词（`cancel` / `retry` / `pause` / `resume`）暴露为纯 JSON 线缆视图。

客户端通过 `ctx.remote.taskQueue`（线缆命名空间）访问；Cordis 服务键保持为 `taskQueueRemote`，避免与队列后端自身冲突。服务声明 `inject: ['taskQueue']`，因此只会在挂载了队列后端（`@deepseek-ai/dsh-task-queue-local`）的组合中激活。每次队列调用都携带显式 `TASK_QUEUE_HOST_ACCESS` 授权，因为该 Remote 是受信宿主操作员面，而不是 Agent-owner 面。

## 线缆视图

客户端安全的数据词汇位于 `./views` 子路径，它不引用任何宿主面——浏览器程序可以直接解析：

- `QueueTaskSummaryView` —— 一行列表（状态、executor、尝试次数、标签、归属）。
- `QueueTaskView` —— 完整持久状态（提示词、结果、运行记录、receipt），供详情面板使用。
- `QueueStatsView` —— 服务状态（`running` / `paused` / `faulted`）、故障原因，以及按状态 / 按 executor 的计数。
- `QueueCancelOutcomeView` —— `'canceled'`（等待中任务直接取消）或 `'stopping'`（已为运行中工作持久化取消意图）。

`faulted` 是粘性且 fail-closed 的：`resume` 会拒绝它，界面将其视为操作员恢复状态，而不是单个任务的失败。

## 排除的面

入队、executor 注册与通知确认刻意不在此暴露——它们属于工具面（`@deepseek-ai/dsh-tool-task-queue`）与操作员的 `/queue` 命令（`@deepseek-ai/dsh-command-task-queue`）。

## 消费方

- `@deepseek-ai/dsh-client-ui-task-queue` —— Queue 模块工作区。
- `@deepseek-ai/dsh-api-remotes` —— 把生成的 Remote 贡献挂进浏览器装配（`ctx.remote.taskQueue`）。

## Model Experience

无。本浏览器面板线缆面只渲染持久记录，不注册任何模型面。

#### KV Cache effect

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- 入队、执行器注册与通知确认不会在这里暴露；它们属于工具面与操作员的 `/queue` 命令。
