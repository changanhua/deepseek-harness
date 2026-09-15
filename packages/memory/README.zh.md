---
description: "按项目保存可复用命题、来源检查和持久化的人工记忆决策。"
kind: "package-group"
---

# packages/memory

[English](README.md) | 中文

## 概述

本能力族保存带来源身份、不可变版本和人工决策的简短项目命题。已接纳的命题仍需通过来源、复核期限和冲突检查。原文件和 Session 日志继续由既有领域保存。

## 包

| 包 | 职责 |
| --- | --- |
| [memory](memory/README.zh.md) | `ctx.projectMemory` Definition 与严格记录 schema |
| [memory-local](memory-local/README.zh.md) | Workspace 授权、来源观察、本地存储与独占 Host 所有权 |
| [tool-memory](tool-memory/README.zh.md) | 模型检索、检查后读取与提出候选 |
| [command-memory](command-memory/README.zh.md) | 人工查看与确切版本的接纳、拒绝和撤回 |

## 相关文档

- [Project Memory 子系统](../../docs/subsystems/project-memory.zh.md) 定义记录与操作语义。
- [Storage](../storage/README.zh.md) 拥有持久化后端与原子 domain 更新。

## 开发备注

无。
