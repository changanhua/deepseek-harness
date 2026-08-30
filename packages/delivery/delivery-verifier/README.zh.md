---
description: "面向不可变 Personal Delivery 目标的独立固定计划验证说明。"
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-verifier

[English](README.md) | 中文

## 概述

`dsh-delivery-verifier` 导出纯函数 `createDeliveryVerifier`，用于独立检查一个不可变的目标提交。调用请求包含精确的 `ContractRevision`、`WorkPacket`、匹配且已完成的 `CompletionClaim`、已解析的可信计划、当前验证对应且不同于产出变更的 Queue 工作与尝试标识、绑定到该验证尝试的 worktree 打开函数、独立的范围检查函数、经过完整性校验的证据查找与读取函数，以及各项检查所用的证据写入器。它不持有 Queue 状态、Delivery 记录、仓库标识或证据存储。

运行结算后会返回经过 Protocol 校验的 `VerificationVerdict`。检查结果、路径边界、祖先关系和证据完整性问题都会记录在判定中；权限输入无效、进程或证据基础设施故障、清理失败以及取消则会使 `done` 拒绝，而不会伪造判定。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

Queue 桥接器使用可信的子进程部署参数创建验证函数。派发时，它传入 `DeliveryVerificationRunRequest`；返回的 `DeliveryVerificationRun` 会同步公开 `done` 与 `cancel(reason)`。

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

验证器只会执行可信 `WorkPacket` 计划中已有的固定 `argv`。验证结果是持久化的 `VerificationVerdict`；它只为人工决策提供证据，绝不会自动作出验收决定。

各项检查按顺序运行；验证器既不进行 shell 插值，也不覆盖环境变量。`Subprocess` 提供方会使用已剔除凭据的父进程环境，强制执行进程树范围的终止，并公开彼此独立的退出结果。每条保存的 `verification-output` 记录都包含进程结果以及保留的 `stdout` 和 `stderr`，并在 UTF-8 边界裁剪到配置的总字节预算。

`disposeGraceMs` 必须是正整数，且不能超过平台计时器上限。`verificationOutputBytes` 必须是正安全整数，且不能超过 `MAX_VERIFICATION_OUTPUT_BYTES`（64 MiB）。Queue 桥接器默认给每项检查分配 64 KiB 输出预算；调用此函数时必须显式传入这两个部署限制。

<a id="understand-the-implementation"></a>
## 理解实现

Queue 桥接器先要求声明的状态为 `completed`，证明 `claim.packetId === packet.id` 和 `claim.checkpointCommit === resolved.targetCommit`，再将其作为 `CompletedChangeClaim` 传入；它还会传入当前的 `verificationQueueWorkId` 与 `verificationQueueAttemptId`。执行前，验证器会在运行时校验 `ContractRevision`、`WorkPacket`、声明、已解析目标、可信计划以及 worktree 租约标识。`claim.evidenceIds` 中的每个标识都是必需输入；证据缺失、大小不符、摘要不符或来源错误都会生成 Protocol 检查结果，并使判定失败。

`inspectRange(signal)` 会为精确的基准提交与目标提交独立推导祖先关系和完整的变更路径集合。它返回后，验证器会立即校验标识、祖先标志与规范化路径，去除重复路径，并在下一项异步操作前冻结一份由自身持有的快照，防止提供方继续改写原对象。`openWorkspace(signal)` 会打开固定到该目标提交、仅供读取和执行的检出目录。`resolveEvidence(id, signal)` 与 `readEvidence(ref, signal)` 会在重启后贯通从持久标识到证据字节的完整性校验。`evidenceFor(checkId)` 提供已绑定来源信息的写入器；验证器还要求每个输出引用都精确匹配 `WorkPacket`、验证 Queue 工作、验证尝试和检查。这些函数只服务于本次操作，不会新增 Cordis 能力。

启动任何进程前，验证器会要求 worktree 的 `ownerAttemptId` 等于 `verificationQueueAttemptId`，并对每个仓库相对的 `VerificationCheck.cwd` 调用 `lstat` 与 `realpath`。工作目录必须是租约根目录内的物理目录；任何通过符号链接或 Windows 目录联接跳出根目录的路径都会被拒绝。验证器不会在目标检出目录中重新发现计划，只会执行 `WorkPacket` 中已经解析的检查。

对于每个已启动的检查，验证器会分别记录超时和最终进程退出结果，并在结算前等待 `waitForExit()` 证明整棵进程树完全停稳。必需检查超时或意外退出会使判定失败；可选检查的不确定结果会产生 `needs-human-review`。取消操作会终止活动进程树，并以 `canceled` 拒绝 `done`。清理只会在证明完全停稳后移除租约；无法确认进程归属时会保留租约，并明确报告清理故障。如果取消与清理故障同时发生，清理错误的原因会聚合两项事实，并继续保留更早的执行故障。

<a id="model-experience"></a>
## 模型体验

### 确定性验证边界

#### 模型看到什么

没有模型会接收验证器的输入或输出；此包读取固定的 `VerificationCheck.argv`，并向可信宿主代码返回结构化的 `VerificationVerdict`。

#### Token 影响

验证过程会执行子进程并保存证据，但不会增加提示词 token、工具 schema 或消息，也不会发起另一轮模型请求。

#### KV Cache 影响

此包不发起模型请求，因此不会占用 KV Cache；确定性命令输出会保留为证据，而不会进入提示词上下文。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **验证提供隔离，但不是代码沙箱**——固定命令可以在由变更尝试持有的检出目录内执行仓库代码；部署方仍负责选择 `Subprocess` 提供方，并配置操作系统级约束。
- **验证器不在运行时发现计划**——任意 shell 文本、仓库提供的可执行策略和模型生成命令都不属于此包。
- **验收仍由人工负责**——通过的判定不会调用 `recordAcceptanceDecision`，也不能合并或接受交付。

<a id="dev-note"></a>
### 开发备注

无。
