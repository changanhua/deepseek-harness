---
description: "冻结计划修订并可恢复交接 Delivery Case 的仅 Host Bridge。"
kind: "package-reference"
---

# @changanhua/dsh-planning-delivery-bridge

[English](README.md) | 中文

## 概述

使用此 Host 服务可将一个精确计划修订转为可恢复的 Delivery shaping Case。它选择配置的 Workspace 到仓库路由，在创建或关联 Delivery Case 前冻结修订来源并保存稳定映射 digest 和幂等键。

## 配置

`routes` 将规范化 Workspace 路径映射到仓库 id。`operatorId` 标识固定的 Delivery origin actor。没有精确路由的 Workspace 会拒绝交接。

## 行为

Bridge 以可恢复步骤准备、创建和关联。重试从冻结 handoff 重建 Delivery 请求，并使用同一稳定 key。映射的 `allowedScope` 仅保留已同意的产品范围，真正的路径授权仍由后续 Delivery packet 的 `allowedPaths` 拥有。Bridge 将 `baseSelectionRule` 与 `verificationSource` 保持为 null。Host 校验当前直接用户依据和精确修订身份；它不通过 NLP 判断用户是否意图执行。模型只能经条件化的 `tool-planning` handoff 路径调用此服务。

交接只创建 shaping Case。Delivery 仍拥有需求批准、派发、验证和人工接纳。

## 不变量策略

不发布 invariant 伴随模块，因为恢复由 Planning 交接记录和 Delivery 回执负责，桥接层不维护状态副本。

## 开发备注

无。

## 模型体验

### No direct model context

#### What the model sees

本包不注册提示词或工具；可选的 `tool-planning` consumer 负责模型指引和结果呈现。

#### Token effect

无直接 token。

#### KV Cache effect

无。

## 已知限制与延后工作

- 由于计划范围不提供 Delivery 执行边界，Delivery readiness 可拒绝映射后的 Case。
