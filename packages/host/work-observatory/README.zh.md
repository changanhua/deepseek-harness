# @deepseek-ai/dsh-host-work-observatory

[English](README.md) | 中文

由 Host 持有的用户与 agent（智能体）墙钟时间记账。`WorkObservatoryGateway` 注册 `workObservatory` 服务，并发布由 Typert 生成的直接 Remote：`workObservatory/observeClient` 与 `workObservatory/range`。

## 配置

`path` 选择独立版本控制的 SQLite 数据库；测试可使用 `:memory:`。`staleAfterMs` 默认为 30 秒，控制浏览器证据缺失多久后重置产生方状态。`sweepIntervalMs` 默认为 15 秒，只控制陈旧状态的物化时机，绝不延长记账时间。数据库 schema 版本未知时，服务激活会失败且不会重建该文件。

## 记账语义

浏览器文档使用文档生命周期 id 和单调序列发送 `visible` 与 `active` 快照。Host 校验 `active => visible`，使用接收时钟为已接受快照计时，并在不更新状态或证据的情况下忽略重复或更旧的序列。正常迁移在接收时关闭区间；产生方失联时在最后一条已接受证据处关闭。即使陈旧扫描尚未运行，查询期间的开放 Human 区间也只结束于最后证据。

该服务把规范的 `step/start` 至 `step/end` 会话事件投影为以 `(session_id, turn, step)` 为键的记录。`step/end` 是权威关闭事件；`assistant/message`、`tool/call` 和 `tool/result` 更新崩溃证据，而 token 级 `assistant/chunk` 事件不写 SQLite。回放保持幂等，子会话回放跳过 `SessionHeader.seedLength` 之前的事件，启动时先把历史开放记录关闭到最后证据，随后回放可以重新开放当前仍存活的步骤。

`range` 返回 Page Visible、Human Active 和 Agent Running 的规范化半开区间 `[start,end)` 时间线。它先合并重叠的浏览器客户端与会话，再派生 `Together = Human Active ∩ Agent Running` 和 `Agent Solo = Agent Running - Human Active`。概述时长与时间线数组来自同一套区间算法，并在发布前强制满足 `Human Active ⊆ Page Visible` 与 `Agent Running = Agent Solo + Together`。

事件观察与陈旧扫描故障会被记录并隔离，因此这个遥测服务不会拒绝会话发布。服务 dispose（资源释放）时会停止扫描；会话监听器随所属 Cordis fiber 解除，随后 SQLite 在这些 effect 退栈后关闭。

## 模型体验

无，因为这个 Host 遥测服务不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **Human Active 是行为代理** —— 可见性、焦点与近期交互无法证明注意力；缺少浏览器证据时会保守低估。
- **Agent Running 是步骤墙钟时间** —— 它可能包含模型执行、工具、等待用户以及等待子 agent，不能解释为计算时间或节省的人工时间。
- **一个 Host 代表一个用户** —— Host 上连接的所有浏览器客户端区间会在没有用户或租户身份的情况下合并。
