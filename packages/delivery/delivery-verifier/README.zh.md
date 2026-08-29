---
description: "面向不可变 Personal Delivery target 的独立固定计划验证 closure。"
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-verifier

[English](README.md) | 中文

## 摘要

`dsh-delivery-verifier` 导出纯 `createDeliveryVerifier` factory，用于独立检查一个不可变 target commit。其 request 包含精确 Contract、Packet、匹配的成功 `CompletionClaim`、已解析 trusted plan、已绑定 Attempt 的 verification workspace opener、独立 range inspector、经过 integrity 检查的 evidence lookup/read closure，以及逐 check 的 evidence writer。它不拥有 Queue 状态、Delivery 记录、repository identity 或 evidence store。

## 使用此包

Queue bridge 使用可信 subprocess 部署输入创建 verifier closure。dispatch 时传入 `DeliveryVerificationRunRequest`；返回的 `DeliveryVerificationRun` 同步发布 `done` 与 `cancel(reason)`。

```text
const startVerification = createDeliveryVerifier({
  subprocess: ctx.subprocess,
  verifierVersion: 'delivery-verifier@1',
  disposeGraceMs: 5_000,
  verificationOutputBytes: 64 * 1024,
})

const run = startVerification(request, signal)
const verdict = await run.done
```

只有 trusted Packet plan 中已有的固定 argv 才能执行。verifier 结果是持久 `VerificationVerdict`；它是人工决策的证据，绝不是自动 acceptance decision。

`disposeGraceMs` 必须是正整数，且不能超过平台 timer 上限。`verificationOutputBytes` 必须是正 safe integer，且不能超过 `MAX_VERIFICATION_OUTPUT_BYTES`（64 MiB）。Queue bridge 默认提供 64 KiB 的逐 check 输出预算；此 factory 要求部署方显式传入这两个限制。

## 理解实现

Queue bridge 先要求 claim 为 `completed`，证明 `claim.packetId === packet.id`，并证明 `claim.checkpointCommit === resolved.targetCommit`，然后以 `CompletedChangeClaim` 提供它。Verifier 把 `claim.evidenceIds` 中每个 id 都视为 required input。`inspectRange(signal)` 会为精确 base 与 target 独立推导 ancestry 和完整 changed-path 集合。`openWorkspace(signal)` 打开固定到该 target 的只读/执行 checkout。`resolveEvidence(id, signal)` 与 `readEvidence(ref, signal)` 闭合重启后的持久 ID 到字节 integrity 路径。`evidenceFor(checkId)` 防止 check 省略或替换其 Queue Attempt 与 check provenance。这些都是 operation-local closure，而非新的 Cordis capability。

在 repository-relative `VerificationCheck.cwd` 下启动 check 前，具体 verifier 必须解析其物理路径并证明它仍位于 lease root 内，否则就拒绝任何 symlink traversal。只做词法 `join()` 并不足够，因为 target tree 本身可以把中间目录重定向到隔离 checkout 之外。

## 模型体验

### 确定性验证边界

#### 模型看到什么

没有模型接收 verifier 输入或输出；此包消费固定 `VerificationCheck.argv`，并向可信 host code 返回结构化 `VerificationVerdict`。

#### Token 影响

验证会执行 subprocess 并保存 evidence，但不会增加 prompt token、tool schema、message 或另一轮模型请求。

#### KV Cache 影响

不存在模型请求，因此也没有 KV cache 贡献；确定性命令输出保留为 Evidence，而非 prompt context。

## 已知限制

- **具体 verifier 不可用**——`createDeliveryVerifier` 返回 live handle，其 `done` 以 `DeliveryVerifierError('unavailable')` 拒绝；ancestry、scope、逐个 `completionClaim.evidenceIds` lookup/read、command、timeout 与 verdict 逻辑均不受支持。
- **不在运行时发现计划**——任意 shell 文本、仓库提供的可执行 policy 与模型生成命令均不属于此包。
- **验收仍由人拥有**——passed verdict 不会调用 `recordAcceptanceDecision`，也不能 merge 或接受交付。
