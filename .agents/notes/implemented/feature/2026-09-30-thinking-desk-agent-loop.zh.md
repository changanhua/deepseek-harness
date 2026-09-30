# Agent Note: Thinking Desk Agent 循环保持 Planning 的人工控制

Status: implemented

[English](2026-09-30-thinking-desk-agent-loop.md) | 中文

## 问题

首个 Design Case 能保留冻结布局，却不能把明确的设计问题变成可持久化、可审阅的 Agent 输出。复用普通 Planning 工具或通用执行 Session 会让模型在人工审阅候选前创建正式修改，也会在刷新或重启后失去解释该候选所需的精确 Planning 和 Case 输入。

## 决策

SBC Case owner 将 Thinking run 持久化在既有的 Case 记录中。浏览器动作会以一份冻结的 Planning Context Pack、Case 版本、原生 Session 身份、Planning binding 命令和 kickoff 请求准备 run。Client 以相同身份经过原生 Session 创建、binding 和 prompt 步骤恢复该记录；binding 前的修订变化会将记录标记为 blocked，且不会发送 prompt。run、result、Design Context、探索建议、提交 receipt 和 Proposal 审阅快照均受 Case 记录容量限制。

`thinking-desk` preset 只在 run 的实时 Agent child scope 中提供 `thinking_context` 和 `thinking_submit_result`。owner 从实时 Agent、preset、绑定的 Session、Workspace 和已存 run 推导授权；模型输入不能选择这些身份。preset 排除 `planning_update`，结果工具只能读取冻结的 Context Pack 或持久化带版本的候选。

浏览器会在三个独立的人类动作应用探索建议、保存 Design Context 或提交 Proposal 前渲染候选。应用建议和上下文只会改变 Case。Proposal 提交使用冻结的 subject、base revision、origin、evidence 和审阅快照，不推进正式 Planning。采纳仍是既有的人类 Planning 动作。Case 漂移要求用户对仍适用的输出做可见确认，Planning 漂移会拒绝创建 Proposal。Proposal 审阅使用不可变的 state-entry 材料和代次绑定的 Focus、资源快照；缺少前值时会阻止采纳。

手动画布创作复用同一 Case 卡片 owner，并明确标记手工来源，避免仅记录一个想法也必须先运行模型。新建和编辑卡片只改变探索内容，冻结的 Planning 投影保持不可变。删除卡片也删除其移动历史，避免撤销产生没有卡片的布局记录。

## 考虑过的替代方案

**在 Thinking Session 中使用普通 Planning 工具。** 它们现有的授权可从绑定 Session 创建 Proposal，因此提示词文字或隐藏按钮不能强制所需的人工审阅边界。

**在 Case 之外存储 Thinking 状态。** 第二份记录需要自己的所有权、恢复、容量和一致性规则，同时复制 Case 的冻结投影和本地输出生命周期。

**在中断后启动替代 Session 或 prompt。** 新身份可能从不同的 Planning 修订生成第二次模型请求。持久启动记录使每个成功副作用都能以原身份恢复。

**自动变基或采纳 delta。** 这两种动作都不能保留输入已经变化的候选的审阅含义。实现保留候选，并要求人选择下一步。

画布选中和移动在 Case 保存期间保留已挂载视图及其布局。保存提示覆盖在画布内，不插入文档流中的新行，卡片透明度保持不变。重复选中是本地空操作，探索编辑不会刷新无关的 Thinking 结果。这样避免可见跳动和多余请求，同时保留 Case 持久化及版本检查。

## 后果

Thinking 输出可通过原生 Agent loop 使用，却不会变成正式 Planning 数据。Context Pack 仍是首个 preset 唯一的研究输入，因此不具备仓库或 Web 研究能力。人可以独立应用三种输出，同一 Case 的后续 run 会读取已保存的 Design Context。

聚焦的 Remote、工具、Client 和组合 Web 检查覆盖启动恢复、scope 拒绝、有界结果、独立输出应用、精确 Proposal 审阅、采纳、漂移和第二个 run 继承的 Design Context。真实 Web Agent 测试覆盖原生 Thinking 工具、三种输出、人类 Proposal 采纳、漂移和第二次上下文读取。这证明组合测试环境，不表示已部署到用户安装的实例。
