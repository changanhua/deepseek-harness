# @deepseek-ai/dsh-command-task-queue

[English](README.md) | 中文

面向人类的 `/queue` 斜杠命令，挂在 `ctx.taskQueue` 之上：`list`、`stats`、`status`、`retry`、`cancel`、`pause` 和 `resume`，由派发 UI 直接渲染结果，不经过模型。后端为可选读取：未挂载时命令仍然注册，但会报告 Queue v2 未挂载，而不是捕获一个半组合的服务。

## 命令

- `/queue list [limit]` 列出 Work id、状态、attempt 次数与上限、WorkKind 和标题；`limit` 必须是正整数。
- `/queue stats` 输出 queued、starting、running、unknown、succeeded、failed 和 canceled WorkItem 的数量。
- `/queue status <id>` 输出列表摘要、创建/更新时间，以及存在时的当前结构化 failure message。
- `/queue retry <id>` 为现有 failed WorkItem 授权下一次 attempt，并保留其持久 identity 与 attempt history。
- `/queue cancel <id>` 原子取消 queued work；对于 starting/running work，先记录取消意图，再请求 live cancellation。
- `/queue pause` 与 `/queue resume` 停止或恢复 dispatch；暂停期间 admission 和 operator inspection 仍可用。

裸命令或未知子命令返回用法提示；缺 id 或 id 不合法返回错误；后端未挂载时所有子命令都报告 Queue v2 未挂载。

## 契约

- 命令名 `queue`，全局注册（与 `command-feedback`/`command-goal` 相同的主机平面方式）。
- `recordInput` 保持默认 `true`：命令输入记入 `command/run` 生命周期事件，留审计痕迹。
- 本包不注册任何模型面；模型侧请用 `@deepseek-ai/dsh-tool-task-queue`。

## 模型体验

无。本包面向人类渲染 `/queue` 命令结果，不注册模型面。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制

- **无后端即无操作**——未挂载 `ctx.taskQueue` Provider 时所有子命令都报告 Queue v2 不可用。
- 命令暴露 trusted operator facade，但不准入 WorkItem，也不解决 unknown outcome；WorkKind Consumer 持有 admission，Remote/UI 持有限制后的 unknown-resolution flow。
