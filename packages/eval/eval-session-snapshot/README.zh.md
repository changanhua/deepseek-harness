---
description: "DSH Eval 套件的无密钥 ACP session-snapshot 执行，包括路由 provenance 检查与归一化持久日志比较。"
kind: "package-library"
---

# @deepseek-ai/dsh-eval-session-snapshot

[English](README.md) | 中文

## 概述

`dsh-eval-session-snapshot` 让 Eval runner 启动配置好的 ACP 应用，并把其持久化 session 日志与路由自有 replay fixture 比较。它复用真实 session-snapshot 子进程 harness，在启动前验证录制的 Provider/model provenance、准备 fixture 自有 Workspace，并返回确定性结果代码以及 Session 身份、usage 分桶、证据引用和分离的 Agent/evaluator 延迟。启动、协议、回放与持久化异常仍交给 `runEvalSuite()` 分类为基础设施不确定性。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

为一个 fixture 根目录与应用选择创建一个执行器，然后把它传给 `runEvalSuite()`。

### 何时使用

当 Eval case 是 ACP 文本提示词，且预期结果是归一化的持久化 session 日志时，使用此适配器。当 stdout、workspace 状态、提示词 pin、工具 schema pin 或多步骤 ACP 脚本属于 oracle 时，请使用更完整的 session-snapshot 套件工厂。

### 入口

适配器会选择路由特定的应用/Profile 覆盖，并把每个 fixture 限制在一个根目录下：

```text
const execute = createSessionSnapshotEvalExecutor({ fixtureRoot, agent, routes })
const result = await runEvalSuite(suite, execute, { signal })
```

匹配的快照返回确定性 `passed`。内容或 session 数量差异返回稳定失败代码。缺失或不匹配的录制路由 provenance 会在不启动子进程的情况下返回 `invalid`。成功或任务失败证据若缺少 Session id，会被 runner 降级为基础设施不确定。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

适配器解析主 fixture、override fixture、child fixture 与 Workspace fixture 路径，读取主请求 header，并把其 Provider/model 与路由比较。随后，它驱动一次带确定性权限答案的 ACP prompt。Session-snapshot owner 启动并拆卸子进程；此适配器归一化日志，从持久化 assistant message 读取 Provider usage，出现 retry 时把 retry usage 标为未知，并分别计时 Agent 执行与 evaluation。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 路由选择、fixture 限制/provenance、ACP 执行与快照比较 |
| [`src/invariant.ts`](src/invariant.ts) | 无运行时 invariant 的配套注册 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Eval 约定](../eval/README.zh.md)——此适配器消费的套件执行与报告语义。
- [Session snapshot](../../test-support/session-snapshot/README.zh.md)——应用启动、fixture 录制、归一化与清理。
- [Eval 决策](../../../.agents/notes/implemented/architecture/2026-08-31-deterministic-eval-contract-and-snapshot-adapter.zh.md)——适配器边界与替代方案。
- [最小 replay 套件](suites/minimal-v1/suite.json)——适配器集成测试执行的两套独立路由 fixture。

-----

<a id="model-experience"></a>
## 模型体验

### 套件提示词

#### 模型会看到什么

执行器把精确的 `EvalCase.prompt` 作为一个 ACP 用户提示词提交给回放支持的 Agent。

#### Token 影响

一个 case 会贡献其提示词 token，以及所组合 Profile 的普通系统提示词与工具 schema；此适配器不会添加 evaluator 提示词。

#### KV Cache 影响

Case 提示词是新的用户消息后缀。稳定的 Profile header 保留其普通前缀缓存行为。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 此适配器只比较持久化 session 日志；stdout 与 workspace 预期输出仍由更完整的 session-snapshot 套件工厂拥有。
- AbortSignal 会阻止新 case 启动，也会阻止接受取消后返回的分数，但上游子进程 harness 不暴露运行中 signal 取消。
- 录制实时 Provider fixture 与选择凭据仍是本包之外的显式 session-snapshot 操作。
- 聚焦测试无密钥执行全部十个 Case，为两条路由启动真实 session-snapshot ACP 子进程 harness，通过 ACP handshake 启动已发布 Loader/Profile，并 replay 一份 `recording: live` Provider fixture 来验证 usage 分桶。新的实时调用仍是需要显式凭据的操作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
