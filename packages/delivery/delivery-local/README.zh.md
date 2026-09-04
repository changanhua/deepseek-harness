---
description: "面向组合交付 profile 的维护者，提供本地持久化 Personal Delivery 记录。"
kind: "package-reference"
---

# @changanhua/dsh-delivery-local

[English](README.md) | 中文

## 概述

`dsh-delivery-local` 是 `ctx.delivery` 的保留本地 provider。其 Storage Domain 存储边界覆盖持久的 Delivery Case、不可变 Contract revision、人工 requirement decision、Issue publication、Work Packet、Queue dispatch binding 与人工 acceptance decision，同时让 Queue lifecycle 和 evidence bytes 留在本存储之外。

此 provider 通过 `storageDomain` 打开 format version 2 的私有 `personal_delivery` domain，每个记录族一张表。Storage Domain 没有数据迁移：以不同 format version 标记的介质在打开时以 `version-mismatch` 拒绝，因此 version-1 root 在任何写入之前关闭失败且字节保持不动；version-2 验收使用独立的 DSH home。每次写入都会在返回前完成幂等持久化；宿主重启时，同步读取投影会从经过 Schema 校验的记录重建。

## 配置与组合

先挂载 Storage 与 Storage Domain，再加载此 provider。它刻意没有 Loader 配置：私有 domain identity 是格式事实，backend route 属于 Storage Domain composition。

## 所有权边界

Provider 只拥有 Delivery 记录与 restart-stable projection。它不拥有 Queue Work 或 Attempt、Git commit、executor process、evidence bytes、verification result 或可写 UI lane。

Case 创建原子地提交 Case 与其 root revision；Case 修订在串行化写入边界内通过 expected-head compare-and-set 移动 head：过期 head 以 `conflict` 关闭失败，child revision 已持久化的重放修订会完成或拒绝 head 移动而不是分叉 Case。Packet 创建与 publication 准备共享同一条 approval 边界——revision 必须属于该 Case、处于 ready 且携带唯一 `approved` requirement decision，否则写入以 `approval-required` 失败。Publication 状态转换在 domain 写入链内运行，因此 `prepared → publishing → published/failed/unknown` 生命周期、failed 记录在既有 id 下重置为 `prepared`，以及仅限人工的 `unknown` 记录 resolution 都会与并发尝试串行化。Packet 创建通过可选的可信 Git-blob resolver 解析 Contract 拥有的 verification source；acceptance decision 记录则会在提交前解析精确绑定的 Queue candidate，并完整性读取每个被引用的 evidence object。重复 idempotency key 只有在 operation 与完整 request 都一致时才返回原记录。

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
- **不可变历史没有自动 retention** — 此 provider 不会删除 Case、Contract revision、requirement decision、publication、Packet、binding 或 decision，因此选定 backend 必须容纳这些记录的增长。
