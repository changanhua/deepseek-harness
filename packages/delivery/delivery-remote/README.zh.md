---
description: "面向导入、执行、验证并决定一次交付的用户，提供 Personal Delivery 浏览器 Remote。"
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-remote

[English](README.md) | 中文

## 概述

`dsh-delivery-remote` 实现 browser-safe `ctx.remote.delivery` namespace、派生的 workbench projection 与六个明确操作，而不暴露 raw Queue enqueue authority、filesystem path、process handle、credential 或通用 shell。

Snapshot 把一次 Delivery read 与可信 operator 的 Queue view 合并成五条派生 lane。每个异步操作都接受 operation-local `AbortSignal`；稳定 Typert failure 会分类预期的 domain refusal，而不会把任意 infrastructure text 复制到 browser。

## 目录

- [Remote 方法](#remote-methods)
- [权限边界](#authority-boundary)
- [开发说明](#dev-note)
- [Model Experience](#model-experience)
- [已知限制](#known-limitations-and-deferred-work)

<a id="remote-methods"></a>

## Remote 方法

- `snapshot()` 返回尚无 Packet 的 Contract revision，以及派生为 Ready、Running、Review、Blocked 或 Accepted lane 的 Packet card。
- `importIssue(input, signal)` 为必需的已配置 repository 明确采用一个 GitHub Issue URL 的当前 revision。Issue 中的严格 Work Brief 拥有 Contract 字段，Host 自行派生 previous revision；browser 既不能替换 base/plan，也不能提供 lineage。
- `createPacket(input, signal)` 只接受所选 Contract 与有界 Packet draft。Host 从不可变 Contract 解析 repository identity、base proof 与 verification source，再根据 Contract identity 与 canonical Packet digest 派生 idempotency key。
- `startChange(input, signal)` 把幂等 binding 与 ownerless Queue admission 委托给 Delivery/Queue bridge。
- `startVerification(input, signal)` 接受 Packet 及其 bound change dispatch；Host 在准入前派生精确 checkpoint 与可信 verification plan。
- `readEvidence(input, signal)` 只接受一个现有 evidence id，经 Delivery Evidence 完整性读取后返回安全 metadata 与 base64 bytes，不返回 provider URI。
- `recordDecision(input, signal)` 接受 human decision 以及所选 bound change 和 verification dispatch。Host 解析其 Queue result，actor 来自可信 Host 配置，idempotency key 根据 decision nonce 与解析出的不可变 target 派生。

`./types` export 包含 JSON wire declarations。生成的 `./typert` 与 `./remote` entry 分别承载 host 与 browser face。

<a id="authority-boundary"></a>

## 权限边界

Remote 注入 `delivery`、`deliveryEvidence`、`repoWorkspace` 与 `taskQueue`，但不会让 browser input 成为 authority。Git 证明 commit，Queue 拥有 execution，evidence storage 会解析并完整性读取每个精确引用的对象。在这个单用户 MVP 中，可信 Host 配置提供非空白 `operatorId`（默认 `local-operator`）作为 decision actor；`actorId` 永远不是 browser 字段。只有 human decision endpoint 可以请求 acceptance record。Browser input 只包含用户选择，不包含 authority-bearing identity、raw Queue payload、host path、provider URI 或 caller-defined idempotency key。

<a id="dev-note"></a>

## 开发说明

保持五条 lane 为派生值。不要添加可写 status，也不要向浏览器暴露通用 Queue operator authority。

## Model Experience

### 无直接模型上下文

#### 模型看到什么

模型不会直接看到任何内容。`delivery` Remote namespace 暴露浏览器 RPC 方法，但不注册 prompt、tool 或 resource。

#### Token effect

直接 token 为零；Typert transport payload 是浏览器控制数据，而不是模型输入。

#### KV Cache effect

无；本包从不组装模型输入。

## 已知限制

<a id="known-limitations-and-deferred-work"></a>

- **Composition 仍由外部拥有**——真实 browser flow 运行前，受支持的 profile 必须组合 Delivery domain、evidence、repository workspace、Queue bridge、Typert transport、本 Remote 与具体 GitHub intake provider。
- **单一可信 operator**——`operatorId` 是 Host 配置，不是 browser input 或多用户 authentication claim。
