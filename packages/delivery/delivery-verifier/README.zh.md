---
description: "面向不可变 Personal Delivery target 的独立固定计划验证 closure。"
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-verifier

[English](README.md) | 中文

## 摘要

`dsh-delivery-verifier` 导出纯 `createDeliveryVerifier` factory，用于独立检查一个不可变 target commit。其 request 包含精确 Contract、Packet、匹配的成功 `CompletionClaim`、已解析 trusted plan、已绑定 Attempt 的 verification workspace opener、独立 range inspector、经过 integrity 检查的 evidence lookup/read closure，以及逐 check 的 evidence writer。它不拥有 Queue 状态、Delivery 记录、repository identity 或 evidence store。

完成的 run 返回经过 Protocol 验证的 `VerificationVerdict`。check、path、ancestry 和 evidence-integrity failure 保留为 verdict fact；invalid authority、process/evidence infrastructure loss、cleanup failure 与 cancellation 会拒绝 `done`，而不会制造 verdict。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
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

check 按顺序运行，不经过 shell interpolation，也不由 verifier 提供 environment override。Subprocess provider 提供经过 scrub 的 parent environment、强制 tree-scoped termination，并公开彼此独立的 exit fact。每条保存的 `verification-output` record 都包含 process outcome 与保留的 stdout/stderr，并在 UTF-8 边界裁剪到配置的完整字节预算。

`disposeGraceMs` 必须是正整数，且不能超过平台 timer 上限。`verificationOutputBytes` 必须是正 safe integer，且不能超过 `MAX_VERIFICATION_OUTPUT_BYTES`（64 MiB）。Queue bridge 默认提供 64 KiB 的逐 check 输出预算；此 factory 要求部署方显式传入这两个限制。

<a id="understand-the-implementation"></a>
## 理解实现

Queue bridge 先要求 claim 为 `completed`，证明 `claim.packetId === packet.id`，并证明 `claim.checkpointCommit === resolved.targetCommit`，然后以 `CompletedChangeClaim` 提供它。Verifier 在执行前会快照并在运行时验证 Contract、Packet、claim、resolved target、trusted plan、range fact 与 lease identity。它把 `claim.evidenceIds` 中每个 id 都视为 required input；缺失、size mismatch、digest mismatch 或 provenance 错误的 object 会形成 Protocol finding 和 failed verdict。

`inspectRange(signal)` 会为精确 base 与 target 独立推导 ancestry 和完整 changed-path 集合。`openWorkspace(signal)` 打开固定到该 target 的只读/执行 checkout。`resolveEvidence(id, signal)` 与 `readEvidence(ref, signal)` 闭合重启后的持久 ID 到字节 integrity 路径。`evidenceFor(checkId)` 防止 check 省略或替换其 verification-check provenance。这些都是 operation-local closure，而非新的 Cordis capability。

在任何 process 启动前，verifier 对每个 repository-relative `VerificationCheck.cwd` 应用 `lstat` 与 `realpath`，要求它是 lease root 内的物理 directory，并拒绝向外的 symlink 或 junction traversal。它不会在 target checkout 中重新发现 plan；只有 Packet 已解析的 check 会执行。

对于每个已启动的 check，verifier 会独立记录 timeout 与最终 process exit，并在结算前等待 `waitForExit()` 证明 whole-tree quiescence。required timeout 或 unexpected exit 会使 verdict 失败；optional uncertainty 产生 `needs-human-review`。Cancellation 会终止 active tree，并以 `canceled` 拒绝 `done`。Cleanup 只在已证明 quiescence 后移除 lease，在 process ownership 不确定时保留 lease，并显式报告 cleanup failure。

<a id="model-experience"></a>
## 模型体验

### 确定性验证边界

#### 模型看到什么

没有模型接收 verifier 输入或输出；此包消费固定 `VerificationCheck.argv`，并向可信 host code 返回结构化 `VerificationVerdict`。

#### Token 影响

验证会执行 subprocess 并保存 evidence，但不会增加 prompt token、tool schema、message 或另一轮模型请求。

#### KV Cache 影响

不存在模型请求，因此也没有 KV cache 贡献；确定性命令输出保留为 Evidence，而非 prompt context。

## 已知限制

<a id="known-limitations-and-deferred-work"></a>

- **Verification 是 isolation 而非 code sandbox**——固定 command 可以在 Attempt-owned checkout 内执行 repository code；deployment 仍然拥有所选 Subprocess provider 及其 operating-system confinement。
- **不在运行时发现计划**——任意 shell 文本、仓库提供的可执行 policy 与模型生成命令均不属于此包。
- **验收仍由人拥有**——passed verdict 不会调用 `recordAcceptanceDecision`，也不能 merge 或接受交付。

<a id="dev-note"></a>
### 开发备注

无。
