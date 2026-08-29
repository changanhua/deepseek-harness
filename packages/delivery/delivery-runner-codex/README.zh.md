---
description: "基于受支持、无 parent app-server 包边界的 Delivery 专用 Codex 变更 runner。"
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-runner-codex

[English](README.md) | 中文

## 摘要

`dsh-delivery-runner-codex` 是一次有界代码变更 Attempt 的 Delivery 专用适配器。它导出纯 `createCodexChangeRunner` factory 以及 operation-local request/run 类型。每个 request 都携带精确 `queueWorkId` 与 `queueAttemptId`，它们必须同时标识 workspace lease、evidence 与 completion claim。此包只选择 `@deepseek-ai/dsh-subagent-codex/app-server-run` 作为生产 transport 边界；既不 deep-import provider 源码，也不创建通用 executor registry 或 Cordis service。

## 使用此包

Queue bridge 从一个持久 Contract、Packet、已解析 Queue specification 与当前 Queue Work/Attempt 对组装 `CodeChangeRunRequest`。它把 workspace 打开与 evidence 发布绑定到该 Attempt，然后在 Queue side-effect boundary 调用返回的 `StartCodeChange` closure。

```text
const startChange = createCodexChangeRunner({
  spawn: ctx.subprocess.spawn.bind(ctx.subprocess),
  permissionMode: 'never',
  env: {},
  disposeGraceMs: 5_000,
  modelOutputBytes: 64 * 1024,
})

const run = startChange(request, signal)
const claim = await run.done
```

`CodeChangeRun` 同步发布 `done` 与 `cancel(reason)`。DSH WorkKind 注册、重试、workspace 所有权、持久 Queue 状态和验收均不属于此包。

`disposeGraceMs` 必须是正整数，且不能超过平台 timer 上限。`modelOutputBytes` 必须是正 safe integer，且不能超过 `MAX_MODEL_OUTPUT_BYTES`（64 MiB）。Queue bridge 默认提供 64 KiB 的 Codex 输出保留预算；此 factory 本身要求部署方显式传入该值。

## 理解实现

公共 request 携带持久 Protocol 值、`queueWorkId`、`queueAttemptId`，以及两个已绑定 Attempt 的能力：`openWorkspace(signal)` 与 `BoundDeliveryEvidenceWriter`。具体 runner 必须在启动 executor 前要求 `lease.ownerAttemptId === request.queueAttemptId`。Bound writer 返回的每个 EvidenceRef 与最终 `CompletionClaim` 都必须保留 request 中精确的 Work/Attempt 对；任何不匹配都是 infrastructure failure，而不是 claim。因此绝对 host path 始终是 operation-local。生产依赖是窄 app-server facade；`dsh-subagent-codex` 的 package root 保持不变，Delivery 也绝不导入 `subagent-codex/src/run.ts`。

## 模型体验

### Codex 执行提示

#### 模型看到什么

Runner contract 把模型输入限制为有界 `ContractRevision`、`WorkPacket`、允许与禁止路径、停止条件，以及 completion claim 要求；unavailable implementation 不调用模型。

#### Token 影响

Runner contract 允许每次 Attempt 使用一个紧凑 task prompt；原始 ChatGPT transcript、Queue 历史与无关仓库文档不在范围内。

#### KV Cache 影响

稳定 framing 与 policy 指令可以共享可复用前缀，而 Packet objective、scope 与 resume evidence 会按 Attempt 变化，从而降低 suffix 复用。

## 已知限制

- **具体 runner 不可用**——`createCodexChangeRunner` 返回 live handle，其 `done` 以 `DeliveryCodexRunnerError('unavailable')` 拒绝；Queue identity 检查、prompt 编译、transport settlement、checkpoint、evidence 与真实 completion claim 均不受支持。
- **Codex 是唯一已选择 provider**——没有单独、有证据的架构决策时，alternative provider 与共享 executor registry 均不在范围内。
- **不拥有 Queue**——此包不能注册 `code.change@1`、选择重试或写入 Queue 生命周期；该 bridge 由 `dsh-delivery-task-queue` 拥有。
