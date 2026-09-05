---
description: "面向 DSH 回归消费方的严格确定性 Eval 套件、顺序执行、四类结果折叠与稳定报告。"
kind: "package-library"
---

# @changanhua/dsh-eval

[English](README.md) | 中文

## 概述

`dsh-eval` 让 runner 比较录制的 Provider/model/Preset 路由，同时不允许被测 Agent 自证完成。调用方可以验证带版本的套件与路由特定运行，按确定顺序执行每个路由和 case，并渲染稳定的 JSON 或 Markdown 报告。Run 保留固定源码 revision、环境、可见 Tool/Skill 表面、Session 与 fixture 身份、Provider usage 分桶以及分离的 Agent/evaluator 延迟。此库保留无效与不完整证据，而不会把它们转换为模型分数。

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

在已经知道如何执行一个 case 并返回确定性结果的评测边界使用此库。

### 何时使用

使用 `dsh-eval` 处理严格的套件/运行交换、首次调用顺序回放调度、取消安全的结果分类与报告。当 case 必须启动 DSH、调用模型、读取 fixture 或检查外部状态时，请使用具体适配器。

### 入口

最小 runner 会验证套件、提供一个执行器并序列化报告：

```text
const suite = parseEvalSuite(input)
const { report } = await runEvalSuite(suite, executeCase, { signal, routeContexts })
const json = formatEvalReportJson(report)
```

成功时返回有序的 `EvalRun[]` 与一份 `EvalReport`。Schema 错误会抛出。取消、Host 或执行器异常、Session 事实缺失、结果缺失与格式错误的执行器分数保持为显式非通过结果。模型 grader 记录自身 Provider/model/prompt 版本，且不能覆盖确定性失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Schema 要求套件版本、固定十六进制源码 revision、默认路由矩阵、至少两个路由，并要求每个路由与 case 精确拥有一个独立 replay fixture。每个 case 声明确定性 Workspace 准备、成功条件和允许的 evaluator。Runner 按路由再按 case 的顺序执行。报告保留逐 Case 证据、失败样本、成功率、拆分 Token 分桶与独立 Agent/evaluator 延迟，不会为未知证据编造数值。

| 文件 | 职责 |
|---|---|
| [`src/schema.ts`](src/schema.ts) | 严格的套件、路由、case 与 fixture schema |
| [`src/run.ts`](src/run.ts) | 运行 schema 与结果折叠 |
| [`src/runner.ts`](src/runner.ts) | 串行执行以及取消/错误分类 |
| [`src/report.ts`](src/report.ts) | 跨对象验证与 JSON/Markdown 报告 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Session-snapshot 适配器](../eval-session-snapshot/README.zh.md)——此 runner 的无密钥 ACP 执行。
- [Eval 决策](../../../.agents/notes/implemented/architecture/2026-08-31-deterministic-eval-contract-and-snapshot-adapter.zh.md)——归属与证据理由。
- [LLM 回放](../../test-support/llm-replay/README.zh.md)——首次调用顺序 transcript 绑定。
- [最小 replay 套件](../eval-session-snapshot/suites/minimal-v1/suite.json)——首个无密钥比较使用的十个 Case 与二十个路由专属 fixture。

-----

<a id="model-experience"></a>
## 模型体验

无，因为此纯约定包不执行模型调用，也不拥有 evaluator 提示词。

#### KV Cache 影响

无。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 此库拥有通用 runner，而非 DSH 进程适配器；无密钥 ACP 回放与归一化 session 日志比较请使用 `dsh-eval-session-snapshot`。
- 回放证明针对录制证据的行为，不证明当前 Provider 可用性或当前模型质量；真实 Provider 验证是独立的受控操作。
- 每个被比较路由都需要独立录制的 fixture；此库不会录制或合成 fixture。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
