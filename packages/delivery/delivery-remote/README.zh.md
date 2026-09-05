---
description: "面向导入、发布、执行、验证并决定一次交付的用户，提供 Personal Delivery 浏览器 Remote。"
kind: "package-reference"
---

# @changanhua/dsh-delivery-remote

[English](README.md) | 中文

## 概述

`dsh-delivery-remote` 实现 browser-safe `ctx.remote.delivery` namespace，让用户塑造、批准、发布、执行、验证并验收 Delivery Case，而不暴露 raw Queue authority、filesystem path、process handle、credential 或通用 shell。

Snapshot 把一次 Delivery read 与可信 operator 的 Queue view 合并成六个派生 Case phase、下游 Packet card、readiness reason 与安全 publication state。每个异步操作都接受 operation-local `AbortSignal`；稳定 Typert failure 会分类预期的 domain refusal，而不会把任意 infrastructure text 复制到 browser。

## 目录

- [Remote 方法](#remote-methods)
- [权限边界](#authority-boundary)
- [开发说明](#dev-note)
- [Model Experience](#model-experience)
- [已知限制](#known-limitations-and-deferred-work)

<a id="remote-methods"></a>

## Remote 方法

- `snapshot()` 返回有序 Case card，其中包含 head revision、readiness、requirement decision、已配置 publication target、安全 publication state 与下游 Packet card。Human actor id、publication marker、digest 和 failure detail 留在 Host。
- `createCase(input, signal)` 在 Host 配置的 `repositoryId` 中创建一个 human-origin Case；browser 提供 requirement content，但不提供 repository、actor、identity 或 idempotency field。
- `reviseCase(input, signal)` 通过 Delivery compare-and-set boundary 推进一个已观察的 Case head，并返回 browser-safe child revision。
- `recordRequirementDecision(input, signal)` 为一个精确 revision 记录 approval、rejection 或 deferral。可信 Host 配置提供 actor，Host 派生 decision nonce 与 idempotency key。
- `importIssue(input, signal)` 为必需的已配置 repository，把一个 GitHub Issue URL 的当前 revision 显式导入 Case。Issue 中的严格 Work Brief 拥有 requirement field，Host 自行派生 Case lineage；browser 既不能替换 base/plan，也不能提供 lineage。
- `publishIssue(input, signal)` 接受一个 Case 与 revision selection。Host 解析 `githubTargets[repositoryId]`，为本次 operation 重新解析其 credential reference，再把耐久 external side-effect boundary 委托给 GitHub publisher。
- `resolvePublication(input, signal)` 接受一个不确定 publication 与 candidate Issue number。Host 执行 fresh authenticated GET，只有 exact terminal marker 与 digest 匹配时才确认 `published`。
- `createPacket(input, signal)` 只接受所选 Contract 与有界 Packet draft。Host 从不可变 Contract 解析 repository identity、base proof 与 verification source，再根据 Contract identity 与 canonical Packet digest 派生 idempotency key。
- `startChange(input, signal)` 把幂等 binding 与 ownerless Queue admission 委托给 Delivery/Queue bridge。
- `startVerification(input, signal)` 接受 Packet 及其 bound change dispatch；Host 在准入前派生精确 checkpoint 与可信 verification plan。
- `readEvidence(input, signal)` 只接受一个现有 evidence id，经 Delivery Evidence 完整性读取后返回安全 metadata 与 base64 bytes，不返回 provider URI。
- `recordDecision(input, signal)` 接受 human decision 以及所选 bound change 和 verification dispatch。Host 解析其 Queue result，actor 来自可信 Host 配置，idempotency key 根据 decision nonce 与解析出的不可变 target 派生。

`./types` export 包含 JSON wire declarations。生成的 `./typert` 与 `./remote` entry 分别承载 host 与 browser face。

<a id="authority-boundary"></a>

## 权限边界

Remote 注入 `credentials`、`delivery`、`deliveryEvidence`、`repoWorkspace` 与 `taskQueue`，但不会让 browser input 成为 authority。Git 证明 commit，Queue 拥有 execution，evidence storage 会解析并完整性读取每个精确引用的对象，publisher 拥有 GitHub request uncertainty。可信 Host 配置提供非空白 `operatorId`（默认 `local-operator`）、新 human Case 使用的一个 `repositoryId`（默认 `workspace`），以及以 Delivery repository id 为 key 的可选 `githubTargets` entry；每个 target 携带 owner、repository name、credential reference 与可选 Issue label，绝不携带 token value。Browser input 只包含有界 content 与 selection，不包含 authority-bearing identity、raw Queue payload、host path、provider URI、publication marker、digest、credential 或 caller-defined idempotency key。

<a id="dev-note"></a>

## 开发说明

保持 Case phase、Packet lane、readiness 与 publication presentation 为派生值。不要添加可写 status，也不要向浏览器暴露通用 Queue operator authority。

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

- **Composition 仍由外部拥有**——真实 browser flow 运行前，受支持的 profile 必须组合 credentials、Delivery domain、evidence、repository workspace、Queue bridge、Typert transport、本 Remote 与 GitHub intake/publisher library。
- **单一可信 operator**——`operatorId` 是 Host 配置，不是 browser input 或多用户 authentication claim。
- **Publication target 配置在每次 Host activation 内固定**——编辑 `githubTargets` 需要 recomposition；credential 本身会在每次 operation 重新解析。
