# @changanhua/dsh-tool-operation-run-task-queue

[English](README.md) | 中文

`@changanhua/dsh-tool-operation-run-task-queue` 为 host-configured `operation.run@1` work 注册 model-facing Queue admission。它从实时 Agent Session 派生 owner 权限，只提交 operation ids；operation WorkHandler 持有 resolution 和 execution。

## 工具

- `operation_run_enqueue(title, operationId, idempotencyKey)` 持久化入队一个 host-configured operation，并返回其 WorkItem id。
- `operation_run_enqueue_batch(items, idempotencyKey, maxParallel)` 原子入队带独立标题的 operation ids，并返回其 Batch id；`maxParallel` 必须是正安全整数。

两个工具都会在 ToolRuntime dispatch 前关闭 parameter objects。它们需要实时 Agent Session，将调用 session 保留为 Queue owner，且只返回持久化 id。通用 `task_queue_kinds`、status、result、cancellation、retry、statistics 和 Notification delivery 仍由 `@changanhua/dsh-tool-task-queue` 提供。

## 配置与 Opt-in 组合

插件没有配置字段，且不由 base bundle 挂载。只有当 Queue provider 为已解析 operation resource 配置了 capacity，且 `@changanhua/dsh-operation-run-task-queue` 已带 host allowlist 挂载时，它才有作用。

```yaml
- id: task-queue
  name: '@changanhua/dsh-task-queue-local'
  config:
    resourceCapacity:
      operation-run: 1

- id: operation-run-task-queue
  name: '@changanhua/dsh-operation-run-task-queue'
  config:
    operations: host-reviewed allowlist

- id: tool-operation-run-task-queue
  name: '@changanhua/dsh-tool-operation-run-task-queue'
```

## 准入、结果与失败

准入会在 work 入队前拒绝缺失实时 Agent Session、不支持的 parameter fields，以及非正或非安全的 Batch concurrency value。Queue provider 会拒绝不可用的 `operation.run@1`、未知 host operation ids、缺失 resource capacity 和其他 admission failures。已接受 work 通过终态 result 读取和持久化 Notifications 保持 owner scope；execution failures 和 results 由 WorkHandler 而非此 Consumer 提供。

## 扩展边界

schemas 有意只暴露 title、operation id、idempotency key、Batch items 和 Batch concurrency。它们不暴露 command arguments、environment values、credentials、working directories、execution deadlines、resource claims 或 retry policy。通过扩展 host allowlist 添加调用方可见 operation；通过独立 WorkKind 和 Consumer 添加新的 execution semantics。

## 模型体验

### 准入工具 schemas

#### 模型看到的内容

模型收到 [`operation_run_enqueue` 和 `operation_run_enqueue_batch`](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-operation-run-task-queue) schemas 及渲染后的 durable ids；catalog 持有其完整 JSON Schema。

#### Token 影响

挂载或移除该插件会在 request path 中添加或移除两个 tool schemas 及其 tool-result text。

#### KV Cache 影响

挂载、移除该插件或修改其 schema 时，这两个 schemas 会改变可复用请求前缀；Queue lifecycle results 是独立 tool-result content。

## 已知限制与延后工作

- 准入同时需要实时 Agent Session，以及已带匹配 resource capacity 挂载 operation WorkHandler 的 host composition。
- Batch admission 是原子的，但没有按 item 的 partial-success response；调用方获得 Batch id，并通过持久化 Queue records 检查终态 outcomes。
