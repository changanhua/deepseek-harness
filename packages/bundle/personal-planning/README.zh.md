---
description: "在 DSH 中组合持久项目计划的可选 Personal Planning patch。"
kind: "package-bundle"
---

# @changanhua/dsh-personal-planning

[English](README.md) | 中文

## 概述

这个可选 patch 在既有 base 与 Web bundle 之上组合本地 Planning 持久化、Agent 作用域计划工具、浏览器 Planning Remote 和 Planning UI，不会修改任何默认 profile。

## 组合

base layer 继续提供 Storage Domain、Workspace Registry、Session Query、Skill registry、模型运行时和 Web shell。此 patch 先添加独立的 `planning-skills` filesystem provider，它只扫描本 Bundle 发布的 `skills/` 根目录；随后添加 `planning-local`、`tool-planning`、`planning-remote` 与 `ui-planning`。Planning 的 ownership lock 位于 `DSH_HOME/storages/planning-ownership`。可选的 `memory.patch.yml` 与 `knowledge.patch.yml` 会为计划经验加入有来源的 Memory candidate 和 Knowledge 来源快照。

可选 `initiative.patch.yml` 增加 Human/Agent 共用 Candidate 入口，以及显式人工晋升到 pending Planning Proposal；参见[候选配置与命令](../../initiative/README.zh.md)。

## 不变量策略

不发布 invariant 伴随模块，因为Bundle 仅组合已有能力，不拥有独立运行时状态。

## 模型体验

### Planning 指引与工具

#### 模型看到什么

`tool-planning` 加入有边界的 `planning_list`、`planning_read` 与 `planning_update` schema 和指引。`planning_list` 可在当前项目内按关键词筛选；bundled `planning-maintenance` Skill 要求 Agent 读取稳定身份，并在多个候选都可能匹配时先请用户选择。挂载 `tool-skill` 的 Agent preset 会看到此 Skill；UI 和 Remote 不增加模型上下文。

#### Token effect

组合对应 Consumer 时，Planning 指引、工具 schema 和所选 Skill 文本会增加提示词 token。结果 token 仍受 `tool-planning` 上限约束。

#### KV Cache effect

组合的 Planning 工具和 Skill catalog 不变时，指引与 schema 前缀保持稳定。

## 已知限制与延后工作

- 仅在同时启用 personal-delivery bundle 时追加 `delivery.patch.yml`；它创建的 shaping Case 不批准需求、不运行 Queue 工作、不验证修改或接纳结果。
- Memory 捕获保持为 candidate，直到人类接纳；Knowledge 来源捕获保存可读取快照，不生成、审查、采纳或发布条目。
- Planning lane 只表示个人安排；Delivery 执行、超出现有 Host 服务的已验证来源捕获及浏览器验收仍是独立组合的能力。
