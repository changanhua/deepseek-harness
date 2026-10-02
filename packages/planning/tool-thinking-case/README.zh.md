---
description: "有界 Thinking Desk 模型工具：读取冻结设计上下文并保存可复核候选，不修改 Planning。"
kind: "package-reference"
---

# @changanhua/dsh-tool-thinking-case

[English](README.md) | 中文

## 概述

此包让 Thinking Desk Agent 读取活动 run 的冻结上下文，并保存供人工复核的结构化设计候选。候选可以包含探索笔记、设计上下文和 Planning delta，但不能创建、采纳或执行 Planning 提议。它适用于由用户显式启动、需要保留来源并让人工控制 Planning 正式状态的设计思考 Session。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在 `thinking-desk` Agent preset 中挂载工具和限制行。

### 适用场景

仅在 Host `thinkingCase` owner 已将实时 Agent 和 Session 绑定到已准备 Thinking Run 时使用此包。普通 Planning 工作使用 [`tool-planning`](../tool-planning/README.zh.md)；它拥有不同权限，能够创建 Planning 提议。

### 最小配置

```yaml
- id: thinking-tools
  name: '@changanhua/dsh-tool-thinking-case'

- id: thinking-tool-restriction
  name: '@changanhua/dsh-tool-thinking-case/restrict'
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `maxOutputBytes` | `65536` | 完整 UTF-8 JSON 结果上限，包含外层结构。 |
| `timeoutMs` | `30000` | 由已组合工具超时策略执行的协作截止时间。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`thinking_context` 和 `thinking_submit_result` 从 `ToolRunContext.agent` 推导身份；Host owner 提供 run 上下文并持久化有版本的候选。结果 schema 不接受模型填写 case、run、subject 或 Planning 身份。preset 的 standing 限制监听 `agent/created`，并在每个 child `agent.ctx` 安装 allow-list，因此继承的执行和 Planning 工具不可见，而 standing Thinking 工具仍可见。该限制是 Context effect，会随 Agent scope 一起释放。

不发布 invariant 伴随模块。工具注册可撤销；持久记录、Agent 身份和授权仍由 Thinking Case Host service 拥有。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`thinking-desk` preset](../../preset/agent-presets/presets/thinking-desk/agent.cordis.yml)——Agent 组合与限制行。
- [`tool-planning`](../tool-planning/README.zh.md)——正式 Planning 工具和提议权限。
- [Planning 子系统](../../../docs/subsystems/planning.zh.md)——Board 生命周期和正式状态。

-----

<a id="model-experience"></a>
## 模型体验

### What the model sees

模型可见两个工具。`thinking_context` 返回活动 run 的有界冻结上下文。`thinking_submit_result` 需要 `expected_result_version`，首个候选填 `0`，还需要稳定的 `request_id` 和严格结构化 draft；它返回已保存的候选记录，不会把 Assistant prose 解析为结果。

### Token effect

两个工具 schema 增加固定请求前缀。上下文和候选 JSON 有上限，只在工具运行后增加随数据变化的历史 token。

### KV Cache effect

preset 和配置不变时，schema 前缀保持稳定。冻结上下文和已保存结果是随数据变化的工具结果，不会改变此前的 schema 前缀。

## 已知限制与延后工作

此包只拥有已绑定 Thinking Run 的有界模型工具访问。

- 第一个 preset 没有仓库或 Web 研究能力；它使用冻结的 Context Pack。
- Host `thinkingCase` owner 校验实时 run binding 并持久化候选；此包不拥有 case 存储或重试恢复。
- 候选在人工另行应用探索、保存设计上下文，或提交并采纳 Planning 提议前始终不是正式状态。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

[Thinking Desk Agent 循环](../../../.agents/notes/implemented/feature/2026-09-30-thinking-desk-agent-loop.zh.md)决策负责将这些工具保留在受限 Agent scope 中，并将候选保存在 Case owner 内。

</details>
