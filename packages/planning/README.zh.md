---
description: "项目规划 Board：不可变版本、受控复盘与可选 Delivery 交接。"
kind: "package-group"
---

# packages/planning

[English](README.md) | 中文

## 概述

Planning 在一个持久 Board 中保存项目想法、证据、版本、顺序、依赖和复盘。它可以将一个冻结版本交给 Delivery，但不会取得批准、执行、验证或接纳该 Delivery 工作的权限。

## 包

| 包 | 职责 |
| --- | --- |
| [`planning`](planning/README.zh.md) | 定义 `ctx.planning`、Board 数据和 CAS 变更。 |
| [`planning-local`](planning-local/README.zh.md) | 为每个 Workspace 持久化 Board 并捕获受信来源。 |
| [`tool-planning`](tool-planning/README.zh.md) | 向发起 Agent 提供有界 Board 工具。 |
| [`tool-thinking-case`](tool-thinking-case/README.zh.md) | 向已绑定 Thinking Desk Agent 提供仅候选的上下文和结果工具。 |
| [`planning-remote`](planning-remote/README.zh.md) | 提供已认证浏览器投影和有界命令。 |
| [`planning-delivery-bridge`](planning-delivery-bridge/README.zh.md) | 为可恢复的 Delivery shaping Case 冻结一个版本。 |

## 相关文档

- [Planning 子系统](../../docs/subsystems/planning.zh.md)——生命周期、权限、版本、复盘与 Delivery 边界。
- [Delivery 子系统](../../docs/subsystems/delivery.zh.md)——交接后的需求、执行、验证与接纳。

## 开发备注

无。
