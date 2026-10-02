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

## Investment review opt-in

包内的 `investment-review.patch.yml` 在本 bundle 之后添加 Assessment provider、有界 Quick Review runner、Remote 与 UI。它作为显式 profile patch 使用，不进入默认 bundle 层。将 `DSH_RIR_PROVIDER` 与 `DSH_RIR_MODEL` 设为已有模型路由；缺失时阻止激活，不猜测 provider。只有已知 build/commit identity 才设置 `DSH_RIR_BASELINE`，否则保持 `unknown`。本 patch 不存储凭据。

示例策略限制每份序列化请求与流式响应为 256 KiB、输出最多 12,000 Token、每次评估 120 秒。这些是可修改的部署限制，不是质量保证或 domain invariant。启动时不调用模型。在 UI 中通过投资评估页面创建手工评估，或使用 Plan / Focus 入口。真实评估产生所配置模型的用量，历史读取不调用模型。三个必需质量案例见 [WP1 规格](../../../docs/specs/2026-10-01-requirement-investment-review-wp1.md)。
