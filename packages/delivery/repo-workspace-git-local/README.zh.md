---
description: "面向执行 Personal Delivery 修改与验证的维护者，提供隔离的本地 Git worktree。"
kind: "package-reference"
---

# @deepseek-ai/dsh-repo-workspace-git-local

[English](README.md) | 中文

## 概述

`dsh-repo-workspace-git-local` 是 `ctx.repoWorkspace` 的保留本地 provider。其 ownership boundary 覆盖已配置 repository identity、完整 Git commit 验证，以及每个 Queue Attempt 的一个隔离修改或验证 worktree。

`subprocess` 注入与 Loader 配置是稳定的 composition contract。当前所有操作都会明确失败；worktree ownership 不可用期间，不会创建 checkout、修改 Git 或启动进程。

## 配置

- `repositories` 是从稳定 `repositoryId` 字符串到本地 Git checkout root 的封闭映射。
- `worktreeRoot` 是 attempt-owned worktree 的父目录。

Host path 只是 deployment fact。持久 Delivery 对象保留已配置 repository id 与完整 commit，绝不把可变 absolute path 当作 authority。

## 生命周期边界

Inspection 不创建 checkout。修改或验证 lease 在 `close()` 完成前拥有其 cwd；不确定执行必须保留 worktree，而不能静默删除。

## 开发说明

所有 Git 命令必须使用 `ctx.subprocess`；绝不能在 DSH control-center checkout 中执行。

## Model Experience

### 无直接模型上下文

#### 模型看到什么

模型不会直接看到任何内容。此 provider 实现宿主侧 `ctx.repoWorkspace` 隔离，不注册 prompt、tool 或 resource。

#### Token effect

直接 token 为零；除非调用方明确转发，否则 repository inspection 数据不会进入模型输入。

#### KV Cache effect

无；本包从不组装模型输入。

## 已知限制

- **Git workspace 操作不可用** — repository verification、幂等 lease recovery、checkpoint、cleanup 与 process-tree-safe cancellation 尚未实现期间，每个操作都以稳定 `unavailable` 分类失败。
