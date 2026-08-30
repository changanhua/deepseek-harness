---
description: "通过不依赖 Parent 的 Codex app-server 传输层运行一次有界 Personal Delivery 代码变更 Attempt，并如实报告取消、检查点、证据和清理结果。"
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-runner-codex

[English](README.md) | 中文

## 摘要

`dsh-delivery-runner-codex` 在调用方提供的 worktree 中运行一次有界代码变更 Attempt，并返回符合 Protocol 的 `CompletionClaim`。每个请求都携带精确的 `queueWorkId` 与 `queueAttemptId`，用来标识工作区租约、证据与声明。此包只选择 `@deepseek-ai/dsh-subagent-codex/app-server-run` 作为生产传输层；它既不深层导入提供方源码，也不创建通用执行器注册表或 Cordis 服务。

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

Queue 桥接层从一个持久 Contract、Packet、已解析 Queue 规范与当前 Queue Work/Attempt 组合组装 `CodeChangeRunRequest`。它把工作区打开与证据发布绑定到该 Attempt，然后在 Queue 副作用边界调用返回的 `StartCodeChange` 闭包。

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

`CodeChangeRun` 在工作区操作开始前同步发布 `done` 与 `cancel(reason)`。取消会传递到所选传输层；`cancel()` 等待运行器结算与完整进程树清理，并在清理失败时拒绝。传输层完全停稳后，如果在检查点、证据或租约关闭的等待期间发生取消，结果仍为 `canceled`；清理失败仍为 `cleanup`。DSH WorkKind 注册、重试、工作区创建、持久 Queue 状态和验收均不属于此包。

`disposeGraceMs` 必须是正整数，且不能超过平台计时器上限。`modelOutputBytes` 必须是正安全整数，且不能超过 `MAX_MODEL_OUTPUT_BYTES`（64 MiB）。提示词会在执行前声明 UTF-8 头部保留规则。超过已配置头部上限的最终响应无法形成完整 JSON envelope，因此运行会以 `completion` 失败并保留 worktree，而不会解析截断输出。

-----

<a id="understand-the-implementation"></a>
## 理解实现

运行器会在发布声明前校验 Contract、Packet、已解析规范、租约与证据身份。它通过 `openWorkspace(signal)` 打开 worktree，只把 `lease.cwd` 交给不依赖 Parent 的 app-server 传输层，并在解析模型 envelope 或要求租约创建检查点前 dispose（资源释放）完整子进程树。`completed` envelope 必须产生干净且从基准派生的检查点，并在移除租约前发布有界模型输出证据与检查点元数据证据。`blocked`、`needs-decision` 和 `needs-scope-change` 声明不会虚构检查点事实，并会保留租约。`DeliveryCodexRunnerError` 区分 `invalid-request`、`startup`、`product`、`canceled`、`completion`、`ownership-lost` 与 `cleanup`；未发布的启动回滚如果无法证明进程树完全停稳，就会以 `cleanup` 失败并保留租约，而每次清理失败都会在 `AggregateError` 的 `cause` 中保留较早的失败。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Delivery Protocol](../delivery-protocol/README.zh.md) — 持久声明与证据语义。
- [Repository Workspace](../repo-workspace/README.zh.md) — Attempt 所有的 worktree 与检查点约定。
- [Delivery Evidence](../delivery-evidence/README.zh.md) — 绑定来源的不可变证据发布。
- [Codex subagent](../../subagent/subagent-codex/README.zh.md) — 受支持且不依赖 Parent 的 app-server 传输层。

-----

<a id="model-experience"></a>
## 模型体验

### Codex 执行提示

#### 模型看到什么

模型会收到精确 `ContractRevision`、`WorkPacket` 与已解析代码变更规范的一份权威 JSON 投影，随后是四种允许的完成处置与已配置的 UTF-8 头部保留规则。模型不会收到 Queue 历史、Agent 或 Session 对象、证据写入器，也不会收到 control-center 的绝对路径。

#### Token 影响

运行器每次 Attempt 增加一个任务提示词。Contract 与 Packet 文本会增加输入 token。Codex 仍可能生成完整的最终响应，其中全部输出 token 都可能计入 token 用量；宿主最多保留已配置的 UTF-8 字节数，并拒绝超出预算的 envelope，而不会解析它。

#### KV Cache 影响

稳定的框架、处置指令与保留规则措辞可以共享可复用前缀，而 Contract、Packet、已解析策略与字节预算会随 Attempt 变化，从而降低后缀复用率。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **最终响应采用严格协议**——Codex 必须以一个文本结果返回恰好一个 JSON 对象；额外文字、额外字段、缺失字段或超预算 envelope 都会导致完成失败并保留 worktree。
- **Codex 是唯一选定的提供方**——没有单独且有证据支持的架构决策时，其他提供方与共享执行器注册表均不在范围内。
- **不拥有 Queue**——此包不能注册 `code.change@1`、选择重试或写入 Queue 生命周期状态；该桥接层由 `dsh-delivery-task-queue` 拥有。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
