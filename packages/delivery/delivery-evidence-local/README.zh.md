---
description: "面向组合 evidence-backed Personal Delivery 的维护者，提供本地不可变 evidence bytes。"
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-evidence-local

[English](README.md) | 中文

## 概述

`dsh-delivery-evidence-local` 是 `ctx.deliveryEvidence` 的保留本地 provider。其存储边界覆盖以不可变 content-addressed bytes 原子发布 bounded log、Git fact、patch、checkpoint metadata、verification output、screenshot 与 Resume Capsule。

本地 `root` 配置是稳定的 composition contract。当前 save、resolve 与 read 会返回明确 unavailable 错误；在 immutable bytes 可以被提交并验证前，不会返回任何 reference。

## 配置

`root` 是 content-addressed object 的私有目录。Provider 派生 evidence id、URI、byte length、SHA-256 digest 与 creation time；调用方只提供 bytes、label 与已经绑定的 provenance。

## 完整性边界

`save()` 先发布 bytes，再返回其 `EvidenceRef`。`read()` 必须验证 identity、size 与 digest，不能只信任持久 reference。Queue 只保存 reference，不保存这些 bytes。

## 开发说明

没有另一个具体 consumer 和 retention 决策时，不要把此 delivery-specific store 扩展为通用 artifact platform。

## Model Experience

### 无直接模型上下文

#### 模型看到什么

模型不会直接看到任何内容。此 provider 实现宿主侧 `ctx.deliveryEvidence` 存储，不注册 prompt、tool 或 resource。

#### Token effect

直接 token 为零；除非其他调用方明确选择，evidence bytes 只作为 artifact 保存，不进入模型输入。

#### KV Cache effect

无；本包从不组装模型输入。

## 已知限制

- **Evidence storage 不可用** — atomic publication、metadata resolution、verified read、immutable naming、bounded input 与 corruption test 尚未实现。
