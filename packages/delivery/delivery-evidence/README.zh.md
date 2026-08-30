---
description: "Personal Delivery 的不可变内容寻址证据发布与校验读取。"
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-evidence

[English](README.md) | 中文

## 摘要

`dsh-delivery-evidence` 是 `ctx.deliveryEvidence` 的 Service Definition。runner 与 verifier 发布有界日志、Git metadata、patch、checkpoint metadata、verification output、screenshot 和 Resume Capsule。provider 推导持久 id、URI、byte length、SHA-256 digest 与创建时间，并且只在不可变字节提交后返回 reference。

## 使用此包

将 writer 交给执行组件之前，先绑定 Work/Attempt 或 verification-check provenance。得到的 writer 不能省略或替换该 provenance。

```text
const writer = ctx.deliveryEvidence.bind(provenance)
const ref = await writer.save({ kind: 'log', mediaType: 'text/plain', data })
```

Claim、Verdict 与 Resume Capsule 只保留持久 `EvidenceId`，因此 `resolve(id)` 可在重启后恢复一份新的不可变 reference；对象不存在时返回 `undefined`。随后，`read(ref)` 只有在校验传入的 reference identity、byte length 与 digest 后才返回分离的字节副本。对象缺失或变化会以稳定的 `DeliveryEvidenceError` code 失败，使 verifier 能生成 evidence-integrity finding，而不是把损坏字节当作成功。

## 理解实现

抽象 `DeliveryEvidence` 服务拥有发布与校验读取语义，不拥有文件系统布局或 retention policy。`dsh-delivery-evidence-local` 提供本地不可变存储。Queue 记录只保留有类型的 `EvidenceRef`，字节不会进入 Queue state。

包拓扑见 [Personal Delivery 子系统](../../../docs/subsystems/delivery.zh.md)，证据种类与 provenance 见 [Personal Delivery Protocol V1](../../../docs/specs/2026-08-29-delivery-protocol-v1.md)。

## 开发说明

没有待定的包内设计。新的 evidence kind 必须进入 Delivery Protocol，并且要有当前 producer 与 Consumer。

## 模型体验

### Host 证据服务

#### 模型看到什么

模型不会直接收到来自 `ctx.deliveryEvidence` 的内容。runner 可以总结证据，但此服务自身不添加 prompt 或 message 内容。

#### Token 影响

此服务不产生 token 成本。Consumer 负责其选择渲染的任何摘要成本。

#### KV Cache 影响

此服务无影响。

## 已知限制

- 不支持自动 retention 或 garbage collection；reference 可能比 Packet 与 Attempt 保留更久。
- 此契约仅用于代码交付证据，不是通用 artifact 平台。
