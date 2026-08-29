---
description: "Personal Delivery 准入 bridge，以及 Queue 中 code.change@1 与 code.verify@1 声明的唯一 owner。"
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-task-queue

[English](README.md) | 中文

## 摘要

`dsh-delivery-task-queue` 是唯一向 Queue `WorkKindMap` 增补 `code.change@1` 与 `code.verify@1` 的包。它把持久 Delivery Packet 桥接为 ownerless operator Queue WorkItem，把 operation-local Codex/verifier closure 适配成 Queue `LiveAttempt` 所有权，并让 Prepared value 留在持久 Delivery Protocol 之外。

## 使用此包

可信 host Consumer 调用纯 admission function。两个 browser request 都不接受 idempotency key。在修改任一存储之前，change admission 会解析 Packet 并执行 required executor 约束；verification admission 会解析选中的 bound change、其精确的成功 Queue result 以及 repository ancestry。仅在这些检查通过后，bridge 才派生 canonical intent digest 与稳定 cross-store key、开始 Delivery binding、准入 Queue WorkItem，并以 compare-and-set 绑定返回的 Queue identity。

```text
const queue = ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
const dependencies = {
  delivery: ctx.delivery,
  queue,
  repoWorkspace: ctx.repoWorkspace,
}

const binding = await startCodeChange(
  dependencies,
  { packetId, executorId },
)

const verification = await startVerification(
  dependencies,
  { packetId, changeBindingId: binding.id },
)
```

代码变更 key 精确为 `delivery:<packetId>:code.change@1`；若 Packet 指定 required executor，则它必须在 `beginDispatch` 前与 host 选择匹配。验证调用方只选择 Packet 及其 bound code-change dispatch。在读取 repository 或写入任一 admission store 之前，bridge 会解析 Queue Work intent、重新计算其 canonical digest、匹配 binding input digest，并解析 resolved value，确认其中的 Contract、repository、base 和 executor 与 Packet 及 binding 完全一致。然后它才要求该精确 Queue Work 为 `succeeded`，用 `codeChangeOutputSchema` 解析其 output，要求 completed claim 中的 Packet、Work 与 Attempt identity 全部匹配，并证明 checkpoint 是 Packet base 的后代。不可变 target 来自该 claim，trusted plan digest 来自 Packet；两者都不由 caller 提供。验证 key 会包含这两个派生值。crash 后重试会复用 Queue admission 幂等性，并完成同一个 Delivery binding。

## 理解实现

此包拥有 declaration merging，因为它是唯一能够解析 Delivery 记录、推导当前 Queue Work/Attempt 对、把已验证 repository operation 与 evidence provenance 绑定到该 Attempt，并将两个 runner settlement 映射成 typed Queue output 的适配器。其 prepared `CodeChangeRunRequest` 必须携带两个 Queue identity；绑定 workspace 的 owner、evidence provenance 与最终 claim 必须一致。`dsh-delivery-protocol` 保持 Queue-independent；`dsh-delivery-runner-codex` 与 `dsh-delivery-verifier` 保持无 Queue import 的纯 factory。

插件是 function plugin，而非新 service。它消费 `ctx.delivery`、`ctx.deliveryEvidence`、`ctx.repoWorkspace`、`ctx.subprocess` 与 `ctx.taskQueue`；不发布 `ctx.codeExecutors` 或另一个 bridge registry。

此包导出组合两个 handler 的 Loader `Config` schema。稳定默认值为 `executorId: 'codex'`、不覆盖 model、`permissionMode: 'never'`、`env: {}`、`disposeGraceMs: 5_000`、`modelOutputBytes` 与 `verificationOutputBytes` 各 64 KiB、`resource: 'agent-run'`、`maxAttempts: 1`，以及 `verifierVersion: 'personal-delivery-v1'`。两个输出预算都必须是正 safe integer，硬上限为 64 MiB；grace 必须是正整数，且不能超过平台 timer 上限。即使具体 handler registration 当前不可用，这些值仍描述已保留的 Loader contract。

## 模型体验

### Queue 准入元数据

#### 模型看到什么

模型不会直接看到 Queue admission 或 DispatchBinding 记录；`CodeChangeRunRequest` 只交给已选择的 Codex runner，模型 prompt 由 runner 包拥有。

#### Token 影响

Bridge 不增加 prompt token 或 tool schema，也不把 Queue 历史复制进 runner request；它只传递有界 Contract、Packet 与 operation-local capability。

#### KV Cache 影响

没有直接 KV cache 贡献；把 admission metadata 留在 prompt 外，可以避免易变 Work/Attempt identity 打散 Codex prefix。

## 已知限制

- **具体 handler implementation 不可用**——`apply` 抛出 `DeliveryTaskQueueError('unavailable')`；admission resolution、preparation、runner adaptation、policy、resource 与 registration 均不受支持。
- **Admission function 已可用**——`startCodeChange` 与 `startVerification` 已为 Remote 和 workbench Consumer 实现冻结的幂等 Delivery-to-Queue handshake。
- **没有通用 executor capability**——一个 Codex provider 与一个 caller 不足以证明 registry；alternative provider 需要单独、有证据的架构决策。
- **不提升 client 权限**——browser 只能经可信 Remote 校验选择 Packet、executor 与已有 change binding；不能提供 verification target 或 plan identity，也不能选择 Queue 所有权、idempotency key、evidence provenance 或 acceptance。
