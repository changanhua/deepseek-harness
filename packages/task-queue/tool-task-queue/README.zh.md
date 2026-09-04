# @changanhua/dsh-tool-task-queue

[English](README.md) | 中文

`@changanhua/dsh-tool-task-queue` 向实时 Agent 会话提供通用 Queue v2 控制。插件需要 `tools`、`taskQueue`、`sessions` 和必填的 `maxNotificationsPerStep` 上限。每项 WorkItem 操作都从当前 Session 派生受 owner 限制的 `AgentWorkQueue`。

## 工具

- `task_queue_list()` 返回 owner 名下 WorkItem 的摘要。
- `task_queue_status(id)` 返回一个 owner 名下 WorkItem 的摘要。
- `task_queue_result(id)` 显式返回类型化终态输出或结构化失败。
- `task_queue_cancel(id)` 请求取消一个 owner 名下的非终态 WorkItem。
- `task_queue_retry(id)` 重试一个 owner 名下的失败 WorkItem。
- `task_queue_stats()` 按生命周期状态统计 owner 名下 WorkItem。
- `task_queue_kinds()` 列出 host 启用的类型化 WorkKind。

WorkKind 专用准入工具由独立 Consumer 包提供。

## Owner 投递

对于每个待处理的 owner Notification，插件仅在下游 pre-step 监听器接受该 step 后添加稳定元数据消息，每个 step 最多添加 `maxNotificationsPerStep` 条。消息标识 WorkItem、Attempt、终态结果与 Result id，并引导 Agent 调用 `task_queue_result`；消息不会包含执行器输出、stderr、提示词、路径或附件。

插件仅在匹配的 `user/message` 已持久化且 `sessions.flush()` 成功后确认 Notification。重启处理会识别已有稳定消息并重试确认，不会重复注入。step 被拒绝或 flush 失败时，Notification 保持待处理。

## 配置

- `maxNotificationsPerStep` — 必填正整数，限制每个已接受 step 添加的稳定 owner 消息数。

## 模型体验

间接通过七个 `task_queue_*` 工具和稳定终态通知消息产生影响；类型化执行器输出仅在显式调用 `task_queue_result` 后才对模型可见。

#### KV Cache 影响

挂载或移除此插件会通过工具 schema 改变可复用请求前缀。仅在存在待处理 Notification 时，投递消息才会增加普通的已记录用户内容。

## 已知限制与延后工作

- 控制仅作用于当前 Agent Session 名下的 WorkItem；受信任 operator 使用 operator Queue API。
- 稳定投递不会唤醒 idle Agent，也不会自动继续 Goal。
- 完整 Attempt 历史由 Queue operator 视图提供，不通过这些模型工具返回。
