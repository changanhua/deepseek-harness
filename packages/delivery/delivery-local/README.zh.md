---
description: "面向组合交付 profile 的维护者，提供本地持久化 Personal Delivery 记录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-local

[English](README.md) | 中文

## 概述

`dsh-delivery-local` 是 `ctx.delivery` 的保留本地 provider。其 Storage Domain 存储边界覆盖不可变 Contract revision、Work Packet、Queue dispatch binding 与人工 acceptance decision，同时让 Queue lifecycle 和 evidence bytes 留在本存储之外。

此 provider 通过 `storageDomain` 打开私有 `personal_delivery` 格式。每次写入都会在返回前完成幂等持久化；宿主重启时，同步读取投影会从经过 Schema 校验的记录重建。

## 配置与组合

先挂载 Storage 与 Storage Domain，再加载此 provider。它刻意没有 Loader 配置：私有 domain identity 是格式事实，backend route 属于 Storage Domain composition。

## 所有权边界

Provider 只拥有 Delivery 记录与 restart-stable projection。它不拥有 Queue Work 或 Attempt、Git commit、executor process、evidence bytes、verification result 或可写 UI lane。

Contract adoption 会校验 source snapshot 与 revision lineage。Packet 创建通过可选的可信 Git-blob resolver 解析 Contract 拥有的 verification source；decision 记录则会在提交前解析精确绑定的 Queue candidate，并完整性读取每个被引用的 evidence object。重复 idempotency key 只有在 operation 与完整 request 都一致时才返回原记录。

## 开发说明

保持同步 read projection 与串行 durable write 对齐；不要新增第二套 Attempt 或 Queue lifecycle store。

## Model Experience

### 无直接模型上下文

#### 模型看到什么

模型不会直接看到任何内容。此 provider 只实现宿主侧 `ctx.delivery` 记录，不注册 prompt、tool 或 resource。

#### Token effect

直接 token 为零；本包不会把 Delivery 记录序列化到模型输入中。

#### KV Cache effect

无；本包从不组装模型输入。

## 已知限制

- **一个宿主进程独占已打开的 domain** — Storage Domain 的 change notification 只在进程内传递；另一个进程不会更新此 provider 的同步 projection。
- **不可变历史没有自动 retention** — 此 provider 不会删除 Contract revision、Packet、binding 或 decision，因此选定 backend 必须容纳这些记录的增长。
