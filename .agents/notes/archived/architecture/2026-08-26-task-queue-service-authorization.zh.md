# Agent Note: 任务队列 Service 授权

Status: implemented
Archived: 2026-08-28

[English](2026-08-26-task-queue-service-authorization.md) | 中文

## 问题

任务队列最初只在 `dsh-tool-task-queue` 中绑定 `ownerSessionId`，并检查 cancel/retry/dismiss 的归属。直接 Service 消费方可以读取或更改任意任务，模型面的 list/status/stats 会暴露跨会话数据，通知确认接受任意已知 id，一条全局工具幂等 receipt 还可能把其他会话的任务 id 返回给调用方。在各个工具中分别补检查，无法让归属成为未来消费方共同遵守的不变量。

## 决策

`@deepseek-ai/dsh-task-queue` 持有闭合的 `TaskQueueAccess` 联合类型。`taskQueueAgentAccess(sessionId)` 为一个精确会话签发不透明 Agent 授权；`TASK_QUEUE_HOST_ACCESS` 是受信宿主面插件使用的单例全队列授权。运行时校验只接受签发时登记的原始对象身份，因此复制授权的可枚举字段不能生成另一个有效授权。每个准入、读取、计数、通知或控制任务数据的公开操作都必须携带其中一种授权。执行器注册与发现保持无作用域，因为它们暴露的是部署能力，而非任务记录。

`LocalTaskQueue` 在返回任务或通知前校验授权，并在串行 mutation 内再次执行校验。Agent 授权只能看到 `ownerSessionId` 与其会话匹配的记录；无主记录需要宿主授权。任务 id 不存在与无权访问时都抛出 `unknown task <id>`，通知 id 则都抛出 `unknown notification <id>`，因此 Agent 无法用错误信息探测记录是否存在。列表先应用可见性，再应用 status/executor/tag 过滤器与 `limit`；stats 保留全局服务健康状态，但只统计可见任务。Pause 与 resume 必须使用宿主授权。

Agent 准入会用已认证会话覆盖调用方传入的任何 `ownerSessionId`。宿主准入可以保留显式 owner，也可以接纳无主任务。显式幂等键在查询 receipt 前按 Agent 会话或宿主隔离，因此同一调用主体内的去重保持稳定，但不会返回其他调用主体的任务 id。

`dsh-tool-task-queue` 只从 `ToolRunContext.agent.session.id` 派生 Agent 授权；无 Agent 的派发使用宿主授权。工具层原有的归属检查与手动 owner 注入被移除。`dsh-command-task-queue` 与 `dsh-task-queue-remote` 是显式的受信宿主操作员消费方，每次 Service 调用都传入单例宿主授权。本决策取代了 [P0 业务闭环 Agent Note](../bug-fix/2026-08-26-task-queue-p0-business-closure.zh.md) 中仅在工具层授权的放置方式。

## 考虑过的替代方案

**继续在模型面包装层授权。** 未采用，因为它会让直接 Service 调用、未来消费方、读取投影、stats、通知与幂等查询处于归属规则之外。Service 持有任务身份，也是第一个能对所有消费方实施同一规则的层级。

**向每个 Service 方法传裸 session id。** 未采用，因为字符串无法区分已认证 Agent 权限与宿主操作，也容易诱使调用方合成 owner。闭合授权明确表示权限种类，并让仅限宿主的 pause/resume 在类型签名中可见。

**返回不同的 forbidden 错误。** 未采用，因为这会泄露传入的任务或通知 id 确实由其他 owner 持有。统一的未知记录错误让缺失与不可访问记录保持相同行为。

**使用一个全局幂等命名空间。** 未采用，因为不同会话提供相同模型幂等键时，会在归属检查之前发生碰撞，并可能泄露外部任务 id。按调用主体隔离 receipt，既保留同一会话的重试语义，也消除跨会话别名。

## 后果

- Agent 工具只能列举、检查、计数、通知、重试、取消、dismiss 和 undismiss 自身任务；无主与外部会话任务不可见。
- 受信命令与浏览器 Remote 面通过显式导入的授权，保留全队列操作员行为。
- 直接 Service 消费方必须选择并传递授权。这是有意的预发布 API 破坏性变更，不提供兼容重载。
- 宿主授权是进程内信任决策，不是用户身份认证机制。导入宿主授权的插件属于受信宿主面。
- 授权测试使用真实本地后端覆盖归属绑定、幂等隔离、先归属过滤再 limit、读写隐藏、作用域 stats、通知 CAS 归属与仅限宿主的控制操作。完整任务队列包测试与仓库类型检查覆盖所有已迁移消费方。
