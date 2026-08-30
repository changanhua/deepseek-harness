---
description: "Personal Delivery 领域记录与幂等写入，覆盖需求采纳、有界工作包、Queue 绑定和人工决策。"
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery

[English](README.md) | 中文

## 摘要

`dsh-delivery` 是 `ctx.delivery` 的 Service Definition。它拥有不可变的 Contract revision、Work Packet、Delivery 到 Queue 的 dispatch binding，以及明确的人工验收决策。provider 分配 id 与时间戳，校验每个持久化的 Protocol V1 对象，串行化写入，并返回稳定快照。Queue Work 与 Attempt 状态、Git checkout、证据字节、executor handle、验证执行和 UI lane 均不属于此服务。

## 使用此包

Consumer 注入 `delivery`，并在其拥有的权限入口调用对应操作。GitHub intake 采纳 revision，workbench 创建 Packet 并记录人工决策，Queue bridge 开始并绑定 dispatch。每个创建请求都携带确定性幂等键：相同键与相同规范输入返回既有记录，输入发生变化则失败。

```text
export const inject = ['delivery']

const packet = await ctx.delivery.createWorkPacket(request)
const binding = await ctx.delivery.beginDispatch(dispatch)
```

`adoptContractRevision` 仅在 previous 与新 `SourceRef` 指向相同 provider、repository owner/name 和 Issue number 时接受非 null `previousRevisionId`。跨 Issue predecessor 会以稳定的 `invalid-reference` code 失败；不同 Issue 必须开始独立 revision lineage。

`createWorkPacket` 要求使用 `ctx.repoWorkspace` 根据 Contract selection rule 签发的 `VerifiedRepositoryBase`；普通 request 不能提交 `VerificationPlan`。contract-field source 由 provider 内部派生。对于 git-blob source，Delivery 把已验证 base、Contract 拥有的 path 和固定字节上限交给 operation-local host resolver，校验返回的 `VerifiedRepositoryBlob`，严格解析其 UTF-8 `delivery-verification-plan@1` 文档，再自行派生 provenance 与 digest。

`recordAcceptanceDecision` 只接收人工决定和 Delivery 拥有的 change/verification binding id。Delivery 先确认两条 binding 都是同一 Packet 的 bound Work，再把两条 Queue Work id 交给 operation-local host resolver，并将返回的成功 Attempt id、completed claim、verification intent 与 verdict 同 Packet、checkpoint、plan 和 Queue identity 交叉校验。对于普通 acceptance，Delivery 随后自行枚举 claim 与 verdict 的每个 evidence id，逐个调用第二个 host-only resolve-and-integrity-read capability，再校验 Work/Attempt/check provenance。两个 callback 都不是 browser DTO 或持久记录；最终只持久化人工 `AcceptanceDecision`。普通 acceptance 要求完全匹配、证据完整的 passed verdict，而 waiver 必须保持显式且由人提交。

## 理解实现

此包导出抽象 `Delivery` 服务以及与 provider 无关的 request、error 和 snapshot 类型，不包含存储后端。`snapshot()` 只返回 Delivery 拥有的记录，并明确排除 Queue 生命周期和可写的 Ready/Running/Review lane。本地 provider 属于 `dsh-delivery-local`；Consumer 依赖此 definition，而不依赖该 provider。

包拓扑见 [Personal Delivery 子系统](../../../docs/subsystems/delivery.zh.md)，持久语义见 [Personal Delivery Protocol V1](../../../docs/specs/2026-08-29-delivery-protocol-v1.md)，事实归属见 [MVP contract](../../../docs/specs/2026-08-29-personal-delivery-mvp.md)。

## 开发说明

没有待定的包内设计。Protocol 变更必须回到 `dsh-delivery-protocol`，不能由某个 provider 或 Consumer 局部扩宽。

## 模型体验

### Host 领域服务

#### 模型看到什么

模型不会看到来自 `ctx.delivery` 的内容；此 host 侧领域服务不添加 prompt、tool、message 或 model request。

#### Token 影响

无。

#### KV Cache 影响

无。

## 已知限制与延后工作

- 首版服务契约只覆盖一个本地仓库的交付流程和手工人工决策；planning、Batch/DAG 编排和多主机 lease 不在范围内。
- Completion claim 与 verification verdict 继续作为 Queue result 保存，不复制成 Delivery 记录；host-only resolver 只在一次 Packet 创建或决定操作中暴露它们。
