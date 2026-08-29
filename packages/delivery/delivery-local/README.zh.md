---
description: "面向组合交付 profile 的维护者，提供本地持久化 Personal Delivery 记录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-local

[English](README.md) | 中文

## 概述

`dsh-delivery-local` 是 `ctx.delivery` 的保留本地 provider。其 Storage Domain 存储边界覆盖不可变 Contract revision、Work Packet、Queue dispatch binding 与人工 acceptance decision，同时让 Queue lifecycle 和 evidence bytes 留在本存储之外。

Provider 名称与 `storageDomain` 注入是稳定的 composition contract。当前所有操作都会返回明确 unavailable 错误；在 durable storage 与 restart behavior 完成实现和测试前，本包不宣称已经可用。

## 配置与组合

先挂载 Storage 与 Storage Domain，再加载此 provider。它刻意没有 Loader 配置：私有 domain identity 是格式事实，backend route 属于 Storage Domain composition。

## 所有权边界

Provider 只拥有 Delivery 记录与 restart-stable projection。它不拥有 Queue Work 或 Attempt、Git commit、executor process、evidence bytes、verification result 或可写 UI lane。

即使处于 unavailable scaffold，其 concrete public method 也完整保留 Service Definition 的 operation-local authority：Packet 创建接受可选的可信 verification-source resolver，decision 记录则要求精确 Queue candidate resolver 与 integrity-read evidence resolver。Provider 不会收窄或静默忽略这些 callback。

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

- **持久化不可用** — 在幂等 Storage Domain 持久化与 restart recovery 完成实现和测试前，所有方法都会以稳定 `unavailable` 分类 fail closed。
