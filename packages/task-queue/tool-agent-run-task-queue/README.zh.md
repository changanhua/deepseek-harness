# @deepseek-ai/dsh-tool-agent-run-task-queue

[English](README.md) | 中文

`@deepseek-ai/dsh-tool-agent-run-task-queue` 提供 `agent.run@1` 的 WorkKind 专用 Queue 准入。它从实时 Agent Session 派生 owner 权限，不暴露 executor、profile、model、credential 或 shell 选择。

## 工具

- `task_queue_enqueue(title, prompt, idempotencyKey)` 准入一个受限 Harness worker 请求。
- `task_queue_enqueue_batch(items, idempotencyKey, maxParallel)` 原子准入带独立标题的请求，并保留调用方提供的正数 Batch 并发上限。

Queue provider 解析并持久化 worker 规范、策略与资源声明。通用列表、状态、结果、取消、重试、统计和 Notification 投递仍由 `@deepseek-ai/dsh-tool-task-queue` 提供。

## 配置

插件没有配置字段。Host 拥有的 worker 路由在 `agent.run@1` provider 上配置。

## 模型体验

间接通过两个 `task_queue_enqueue*` 工具 schema 及其渲染的 WorkItem 或 Batch id 产生影响。

#### KV Cache 影响

挂载或移除插件会通过工具 schema 改变可复用请求前缀。

## 已知限制与延后工作

- 准入需要实时 Agent Session，且仅支持 `agent.run@1`。
- Batch item 只接受标题与提示词；执行控制由 host 持有。
