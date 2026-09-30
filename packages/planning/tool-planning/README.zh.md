---
description: "通过有界模型工具查看和更新发起 Agent 当前项目的计划 Board。"
kind: "package-reference"
---

# @changanhua/dsh-tool-planning

[English](README.md) | 中文

## 概述

此插件向 Agent（智能体）提供当前项目 Planning Board 的工具：有界卡片列表、单卡不可变修订读取，以及带 CAS 围栏的命令更新。Planning provider 拥有持久化、来源捕获和提交授权。模型不能选择 Workspace 或 actor，不能批准 Delivery 工作、接纳 Delivery 结果或接纳 Memory。

已绑定 Planning 的 Session 通过现有持久上下文装配获得有上限的正式上下文快照，其中保留原始作用对象和基础修订。当前上下文包包含状态条目、可选 Focus、旧字段及资源引用，不包含历史聊天记录。`planning_context` 刷新该投影；`planning_update.propose.delta_json` 在现有 Proposal 代次上提交结构化 delta。已绑定 Session 不能直接修改或采纳正式状态。

## 使用此包

将插件与 Tools、System Prompt、Planning、Agent、Session 和 Workspace Registry 一起挂载。它从精确的实时 `ToolRunContext.agent` 推导 Workspace 和 actor，并在 provider 授权读取或提交时重新检查同一 Agent、Session 与规范化工作目录。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `maxOutputBytes` | 16384 | 完整 UTF-8 文本块结果上限，包含外层结构 |
| `timeoutMs` | 30000 | 由已组合工具超时策略执行的协作截止时间 |

`planning_list` 返回含 Board 版本、分组、阻塞项和来源标识的卡片 head 摘要页。可选 `query` 在当前项目的标题、意图、范围、验收条件与已捕获来源文本中匹配所有空格分隔的关键词，逐条返回稳定身份、head 版本、命中字段和有界摘录；相似候选不会合并。筛选后的更多结果通过 `next_cursor` 继续读取。列表会缩小可解释文本，不会返回无效 JSON 片段。`planning_read` 根据 `item_id` 和可选 `revision_id` 返回一张卡和一个不可变修订；分页的 `sources`、`reviews` 与 `handoffs` 段让模型回读原始来源链接和执行历史。

`planning_update` 在 `command` 中接收一个严格的直接 `PlanningCommand`，或接收一次 `propose`、`accept_proposal`、`dismiss_proposal` 操作。草稿保留多轮版本和来源，采纳绑定精确版本。同一逻辑更新重试时复用命令的 `requestId`。成功回执在适用时使用 `board_version`、`item_id`、`revision_id` 与 `review_id`。

## 实现

[输入准入](src/input.ts) 拒绝未知外层字段、Workspace 覆盖、actor 覆盖，以及不符合公共判别联合的命令。[范围推导](src/scope.ts) 仅在 Agent 注册表、Session store、规范化工作目录与 Workspace Registry 持续一致时把 Agent 视为实时调用者。[呈现](src/presentation.ts) 对完整模型可见块实施上限；列表或卡片超限时生成更小但完整的投影。工具和提示词注册通过 Context effect 随插件卸载。

## 不变量策略

不发布 invariant 伴随模块，因为工具注册可撤销，持久状态与授权仍由 Provider 拥有。

## 模型体验

### 计划指引 (system-prompt)

#### What the model sees

`tool:planning` 段落要求模型先检索和读取精确候选，多个候选均有可能时请用户选择；重试时保留 `requestId`，把来源内容视为参考而不是权限，不使用批准或 Memory 接纳操作。

#### Token effect

基础能力附带一个固定指引段落和四个工具 schema。组合 Planning Delivery bridge 后会增加交接工具及固定意图与权限指引。当同时组合 Bridge 和 Planning Remote 时，`planning_execution` 会读取所选 Plan 分页的执行事实和 packet 已声明的证据。这些附加能力随各自 provider 卸载。结果文本有上限，随数据变化。

#### KV Cache effect

插件配置和可见性不变时，指引和 schema 前缀保持稳定。已绑定 Session 的正式上下文变化时，会增加随数据变化的持久上下文快照。

## Known Limitations and Deferred Work

- 组合 `planningDelivery` 后，`planning_handoff` 将精确的已采纳修订准备为 Delivery shaping Case。它不批准、派发或接纳工作，也不接纳 Memory。Agent 与 Skill 解释意图，Host 校验当前调用者、用户消息、项目和版本事实。
- 所选 Planning provider 拥有来源解析、持久回执重放、Board 容量和跨会话恢复。
- 列表、草稿和选定卡片的分段可用 `next_cursor` 继续；卡片概览只展示选定修订，`reviews` 与 `handoffs` 保留匹配历史。
