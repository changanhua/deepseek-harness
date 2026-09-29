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
