---
description: "带不可变修订与 CAS 修改的项目计划 Board 契约。"
kind: "package-library"
---

# @changanhua/dsh-planning

[English](README.md) | 中文

## 概述

使用此 Definition 可通过所选 Provider 保存项目计划卡、不可变修订、人工排序、依赖、复盘记录和来源信息。Consumer 可以从任意分离的 Board 快照确定性生成演变图，无需调用模型。

草稿 generation 保留可信 actor 审计记录和已捕获来源；采纳不会改写此前 generation。

## 使用此包

Consumer 使用 `ctx.planning` 并传入可信的 `PlanningAccess`。输入不能提供授权、已观察来源 hash 或持久回执。浏览器安全的 Consumer 导入纯函数入口 `@changanhua/dsh-planning/evolution`；该入口不携带 Planning 服务或 Provider 身份。

可选的 `stateEntries` 属于不可变修订，以稳定条目 ID 表示目标、已接受和未解决内容。旧字段为空时保持为空，读取不会虚构条目。`buildPlanningContext(board, subject)` 定位 Plan 或可选的 Focus，返回当前条目、旧字段内容及不透明资源链接，不读取外部聊天历史。资源种类使用可扩展字符串。

Focus 修改与资源链接共用 Board 事务。Proposal 代次可以携带包含作用对象、基础修订、操作、来源和证据引用的 delta。精确代次采纳在整组应用及发布新修订之前校验对象与基础修订，失败时整个 Board 保持不变。Focus 完成不会完成父 Plan，也不授权 Delivery 或浏览器动作。

## 不变量策略

不发布 invariant 伴随模块，因为此包只定义契约与 schema，不维护可独立观察的运行时投影。

## 模型体验

### 无直接模型上下文

#### 模型看到什么

无直接内容。`ctx.planning` 不注册提示词段落、工具或模型资源。

#### Token effect

无。

#### KV Cache effect

无。

## 已知限制与延后工作

- 演变投影重建已保留的对象谱系与当前关系，不会虚构 Board 事件未保留的历史泳道位置或依赖值。
- 此包不提供 Provider、Remote、工具、Delivery 执行状态或记忆接纳权限。
