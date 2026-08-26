# @deepseek-ai/dsh-command-task-queue

[English](README.md) | 中文

面向人类的 `/queue` 斜杠命令，挂在 `ctx.taskQueue` 之上：`list`、`stats`、`status`、`retry`、`cancel`——由派发 UI 直接渲染结果，不经过模型。后端为可选读取：未挂载时命令仍然注册，但每次执行都返回明确的加载指引错误，而不是解析一个半组合的服务。

## 命令

- `/queue list [limit]` 列出摘要投影（id、状态、attempt、执行器、标题、tags）；`limit` 必须是正整数。入队前先调用它以避免重复工作。
- `/queue stats` 输出服务状态（`running`/`paused`/`faulted`，含 fault 原因）、按状态的计数、按执行器的计数。
- `/queue status <id>` 输出一条任务的完整持久记录（状态/attempt/退避/超时/延迟/标签/归属会话/最近错误/结果/历次 run 记录）。
- `/queue retry <id>` 把 failed 任务送回 pending（重试次数清零），返回新任务 id。
- `/queue cancel <id>` 取消 pending 任务，或对 starting/running 任务持久化停止意图（`canceled` / `stopping`）。

裸命令或未知子命令返回用法提示；缺 id 或 id 不合法返回错误；后端未挂载时返回带 `@deepseek-ai/dsh-task-queue-local` 的加载指引。

## 契约

- 命令名 `queue`，全局注册（与 `command-feedback`/`command-goal` 相同的宿主面方式）。每次 Service 调用都携带 `TASK_QUEUE_HOST_ACCESS`，因此人类操作员可以跨会话检查并控制有主与无主任务。
- `recordInput` 保持默认 `true`：命令输入记入 `command/run` 生命周期事件，留审计痕迹。
- 本包不注册任何模型面；模型侧请用 `@deepseek-ai/dsh-tool-task-queue`。

## Model Experience

无。本包面向人类的 `/queue` 命令直接渲染记录，不注册任何模型面。

#### KV Cache effect

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **无后端即无操作**——未组合 `@deepseek-ai/dsh-task-queue-local` 时所有子命令都返回加载指引错误。
- 命令只做投影与直控，不做入队（入队属于模型工具或 inbox 准入路径）。
