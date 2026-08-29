---
description: "面向在 DSH 中运行完整 Issue-to-acceptance 工作流的用户，提供 Personal Delivery add-on composition。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-personal-delivery

[English](README.md) | 中文

## 概述

`dsh-personal-delivery` 是 Personal Delivery vertical slice 的 add-on bundle carrier：GitHub Issue intake、持久 Delivery record、隔离 Git worktree、governed Codex execution、不可变 evidence、独立 verification、Queue bridge、Remote projection、UI 与 human acceptance。

已发布 patch 刻意为空。这是明确 unavailable 状态，而不是 runnable profile；在完整 composition 与 end-to-end proof 存在前，不激活任何 provider、bridge、Remote 或 UI row。

## 目录

- [组合](#composition)
- [开发备注](#dev-note)
- [Model Experience](#model-experience)
- [已知限制](#known-limitations-and-deferred-work)

<a id="composition"></a>
## 组合

此 bundle boundary 是现有 base 与 Web application bundle 之上的 patch layer。Manifest 承载 Personal Delivery runtime package，但空 `cordis.patch.yml` 不激活其中任何一个。

Bundle 只包含 composition。它不实现 scheduler、不复制 Queue state、不解析 Issue、不执行 Git、不验证 evidence，也不接受交付。

<a id="dev-note"></a>
## 开发备注

保持本包为静态 patch carrier。Runtime behavior 属于独立拥有的 Delivery plugin。

<a id="model-experience"></a>
## Model Experience

### 无直接模型上下文

#### 模型看到什么

模型不会直接看到任何内容。`cordis.patch.yml` 刻意为空，不注册 prompt、tool 或 resource。

#### Token effect

直接 token 为零；本包只预留空 composition boundary。

#### KV Cache effect

无；本包从不组装模型输入。

## 已知限制

<a id="known-limitations-and-deferred-work"></a>

- **Bundle 刻意不可用** — 任何 profile 命名此 bundle 前，必须加入 provider、bridge、Remote 与 UI rows，并证明完整 acceptance scenarios。
