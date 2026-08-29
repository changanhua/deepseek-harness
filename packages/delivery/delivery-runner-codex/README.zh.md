---
description: "通过无 parent 的 Codex app-server transport 运行一次有界 Personal Delivery 代码变更 Attempt，并如实保留取消、checkpoint、evidence 与 cleanup 结果。"
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-runner-codex

[English](README.md) | 中文

## 摘要

`dsh-delivery-runner-codex` 在调用方提供的 worktree 中运行一次有界代码变更 Attempt，并返回符合 Protocol 的 `CompletionClaim`。每个 request 都携带精确 `queueWorkId` 与 `queueAttemptId`，用来标识 workspace lease、evidence 与 claim。此包只选择 `@deepseek-ai/dsh-subagent-codex/app-server-run` 作为生产 transport；既不 deep-import provider 源码，也不创建通用 executor registry 或 Cordis service。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
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

`CodeChangeRun` 在 workspace 工作开始前同步发布 `done` 与 `cancel(reason)`。取消会到达所选 transport；`cancel()` 等待 runner settlement 与完整进程树 cleanup，cleanup 失败时会拒绝。DSH WorkKind 注册、重试、workspace 创建、持久 Queue 状态和验收均不属于此包。

`disposeGraceMs` 必须是正整数，且不能超过平台 timer 上限。`modelOutputBytes` 必须是正 safe integer，且不能超过 `MAX_MODEL_OUTPUT_BYTES`（64 MiB）。提示词会在执行前声明 UTF-8 head retention。超过已配置 head 的 final response 无法形成完整 JSON envelope，因此 run 会以 `completion` 失败并保留 worktree，而不会解析截断输出。

-----

<a id="understand-the-implementation"></a>
## 理解实现

Runner 会在发布 claim 前校验 Contract、Packet、resolved specification、lease 与 evidence identity。它通过 `openWorkspace(signal)` 打开 worktree，只把 `lease.cwd` 交给无 parent 的 app-server transport，并在解析模型 envelope 或要求 lease checkpoint 前 dispose 完整子进程树。`completed` envelope 必须产生 clean descendant checkpoint，并在移除 lease 前发布有界模型输出与 checkpoint-metadata evidence。`blocked`、`needs-decision` 和 `needs-scope-change` claim 不会虚构 checkpoint facts，并会保留 lease。`DeliveryCodexRunnerError` 区分 `invalid-request`、`startup`、`product`、`canceled`、`completion`、`ownership-lost` 与 `cleanup`；cleanup 失败会把较早失败保留为 `AggregateError` cause。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Delivery Protocol](../delivery-protocol/README.zh.md) — 持久 claim 与 evidence 语义。
- [Repository Workspace](../repo-workspace/README.zh.md) — Attempt-owned worktree 与 checkpoint 约定。
- [Delivery Evidence](../delivery-evidence/README.zh.md) — provenance-bound immutable evidence 发布。
- [Codex subagent](../../subagent/subagent-codex/README.zh.md) — 受支持的无 parent app-server transport。

-----

<a id="model-experience"></a>
## 模型体验

### Codex 执行提示

#### 模型看到什么

模型会收到精确 `ContractRevision`、`WorkPacket` 与 resolved code-change specification 的一份权威 JSON projection，随后是四种允许的 completion disposition 与已配置 UTF-8 head-retention 规则。模型不会收到 Queue history、Agent 或 Session object、evidence writer，也不会收到 control-center 的绝对路径。

#### Token 影响

Runner 每次 Attempt 增加一个 task prompt。Contract 与 Packet 文本产生 input token；严格 final JSON envelope 与保留的模型输出只在已配置 byte budget 内产生 output token。

#### KV Cache 影响

稳定 framing、disposition 指令与 retention wording 可以共享可复用前缀，而 Contract、Packet、resolved policy 与 byte-budget 值会按 Attempt 变化，从而降低 suffix 复用。

## 已知限制

<a id="known-limitations-and-deferred-work"></a>

- **Final response 是严格 protocol**——Codex 必须在一个 text result 中只返回一个 JSON object；额外 prose、额外 field、缺失 field 或超预算 envelope 都会导致 completion 失败并保留 worktree。
- **Codex 是唯一已选择 provider**——没有单独、有证据的架构决策时，alternative provider 与共享 executor registry 均不在范围内。
- **不拥有 Queue**——此包不能注册 `code.change@1`、选择重试或写入 Queue 生命周期；该 bridge 由 `dsh-delivery-task-queue` 拥有。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
