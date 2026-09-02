---
description: "面向在 DSH 中运行完整 Case-to-acceptance 工作流的用户，提供 Personal Delivery add-on composition。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-personal-delivery

[English](README.md) | 中文

## 概述

`dsh-personal-delivery` 是 Personal Delivery vertical slice 的 add-on bundle carrier：Case shaping 与 approval、可选 GitHub Issue intake 与 publication、隔离 Git worktree、governed Codex execution、不可变 evidence、独立 verification、Queue bridge、Remote projection、UI 与 human acceptance。

已发布 patch 是叠加在 `dsh-base` 与 `dsh-web-app` 之上的可运行本地 Windows composition。它挂载持久 Delivery provider、本地 evidence 与 Git-worktree provider、Queue bridge、浏览器 Remote 和 Delivery UI，但不会新增 scheduler 或 control-plane store。

## 目录

- [组合](#composition)
- [开发备注](#dev-note)
- [Model Experience](#model-experience)
- [已知限制](#known-limitations-and-deferred-work)

<a id="composition"></a>
## 组合

此 bundle boundary 是现有 base 与 Web application bundle 之上的 patch layer。请从要交付的精确 Git 仓库启动 DSH：启动目录以 repository id `workspace` 暴露，evidence 与 Attempt-owned worktree 位于 `DSH_HOME/personal-delivery/`。Git provider 在生成权威 revision fact 前会验证启动目录就是仓库 toplevel。

Patch 按依赖顺序挂载 `delivery-local`、`delivery-evidence-local`、`repo-workspace-git-local`、`delivery-task-queue`、`delivery-remote` 与 `ui-delivery`，并把新 human Case 与 repository workspace 绑定到 id `workspace`。Credentials、Storage Domain、Subprocess、Queue capacity、transport 和 Web shell 继续由 base layer 持有；`delivery-remote` 直接消费 publisher library，不增加 mounted row。

Bundle 只包含 composition。它不实现 scheduler、不复制 Queue state、不解析 Issue、不执行 Git、不验证 evidence，也不接受交付。

<a id="dev-note"></a>
## 开发备注

保持本包为静态 patch carrier。Runtime behavior 与持久 authority 仍属于各自独立拥有的 Delivery、Queue、Git-workspace 和 evidence plugin。

除非设置 `DSH_DELIVERY_GITHUB_CANARY_APPROVED=1`，real-provider acceptance case 会保持 skipped。获批运行还要提供 `DSH_DELIVERY_GITHUB_CANARY_REPOSITORY`、`DSH_DELIVERY_GITHUB_CANARY_CREDENTIAL_REF`、`DSH_DELIVERY_GITHUB_CANARY_LABEL`，并通过该具名 reference 提供 credential value；evidence log 永远不包含该 value。

<a id="model-experience"></a>
## Model Experience

### 无直接模型上下文

#### 模型看到什么

模型不会直接看到任何内容。`cordis.patch.yml` 组合不注册 prompt、tool 或 model resource 的 provider、Remote 与 UI。

#### Token effect

直接 token 为零；本包只选择 Host 与浏览器 plugin。

#### KV Cache effect

无；本包从不组装模型输入。

## 已知限制

<a id="known-limitations-and-deferred-work"></a>

- **仅一个启动目录仓库** — local profile 只暴露 repository id `workspace`；请从 Case 将要修改的精确 Git toplevel 启动 DSH。
- **仅本地执行与 evidence** — worktree 与 evidence 留在这台 Windows Host；multi-host execution 需要其他 provider。
- **Codex authentication 保持外置** — Bundle 使用现有 Codex 安装与凭据，绝不会把 secret 复制进 Delivery 配置。
- **GitHub publication 是 opt-in Host configuration** — shipped default 不含 target 或 token；发布前需为 `delivery-remote.githubTargets.workspace` 配置 owner、repository name 与 credential reference。
