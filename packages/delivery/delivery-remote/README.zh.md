---
description: "面向导入、执行、验证并决定一次交付的用户，提供 Personal Delivery 浏览器 Remote。"
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-remote

[English](README.md) | 中文

## 概述

`dsh-delivery-remote` 预留 browser-safe `ctx.remote.delivery` namespace、workbench projection 与六个明确操作，而不暴露 raw Queue enqueue authority、filesystem path、process handle 或通用 shell。六个操作当前均不可用。

Namespace、wire types 与 method names 预留稳定 browser contract。同步 snapshot 会抛出明确 unavailable 错误；五个异步操作都接受 operation-local `AbortSignal`，并在不可用时返回 rejected Promise。本包不宣称 projection 或 edge adapter 已经实现。

## Remote 方法

- `snapshot()` 返回尚无 Packet 的 Contract revision，以及派生为 Ready、Running、Review、Blocked 或 Accepted lane 的 Packet card。
- `importIssue(input, signal)` 为必需的已配置 repository 明确采用一个 GitHub Issue URL 的当前 revision。Issue 中的严格 Work Brief 拥有 Contract 字段，Host 自行派生 previous revision；browser 既不能替换 base/plan，也不能提供 lineage。
- `createPacket(input, signal)` 只接受所选 Contract 与有界 Packet draft。Host 从不可变 Contract 解析 repository identity、base proof 与 verification source，再根据 Contract identity 与 canonical Packet digest 派生 idempotency key。
- `startChange(input, signal)` 把幂等 binding 与 ownerless Queue admission 委托给 Delivery/Queue bridge。
- `startVerification(input, signal)` 接受 Packet 及其 bound change dispatch；Host 在准入前派生精确 checkpoint 与可信 verification plan。
- `recordDecision(input, signal)` 接受 human decision 以及所选 bound change 和 verification dispatch。Host 解析其 Queue result，actor 来自可信 operator authentication context，idempotency key 根据 decision nonce 与解析出的不可变 target 派生。

`./types` export 包含 JSON wire declarations。生成的 `./typert` 与 `./remote` entry 分别承载 host 与 browser face。

## 权限边界

Remote 注入 `delivery`、`deliveryEvidence`、`repoWorkspace` 与 `taskQueue`，但不会让 browser input 成为 authority。Git 证明 commit，Queue 拥有 execution，evidence storage 会解析并完整性读取每个精确引用的对象。在这个单用户 MVP 中，可信 Host 配置提供非空白 `operatorId`（默认 `local-operator`）作为 decision actor；`actorId` 永远不是 browser 字段。只有 human decision endpoint 可以请求 acceptance record。Browser input 只包含用户选择，不包含 authority-bearing identity 或 caller-defined idempotency key。

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

- **所有方法不可用**——scaffold contract test 已覆盖配置与失败形态；六个 edge adapter、host projection、intake integration 与 Queue bridge integration 均不受支持。
