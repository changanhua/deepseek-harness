---
description: "将 Session 和 Goal 预算应用到真实 Agent 及其存活祖先。人工回合可通过现有审批界面批准一个额外请求。自主 Goal 续跑会因预算耗尽而停止，并保留原因。"
kind: "package-reference"
---

# @changanhua/dsh-budget-agent

[English](README.md) | 中文

## 摘要

将 Session 和 Goal 预算应用到真实 Agent 及其存活祖先。人工回合可通过现有审批界面批准一个额外请求。自主 Goal 续跑会因预算耗尽而停止，并保留原因。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将本桥接与 Agent Registry、Budget 及 [LLM 桥接](../budget-llm/README.zh.md)一起挂载。通过[人工命令](../command-budget/README.zh.md)设置上限；请求元数据中声称的 session id 不构成权限。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现说明</summary>

行为与生命周期契约以 [源码](src/index.ts) 为准。此包没有独立缓存的业务投影可与 owner 状态比较，因此不发布空的 invariant companion。

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Package group](../README.zh.md)
- [Setup guide](../../../docs/cookbook/trusted-eval-and-budget.zh.md)
- [Architecture](../../../docs/architecture.zh.md)

<a id="model-experience"></a>
## Model Experience

通过呈现资源拒绝和获准结果的 Agent、LLM 与 Workflow 调用方间接影响模型。

#### KV Cache effect

本包不直接改写提示前缀，提示构造和缓存复用由相应调用方负责。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 交互式例外需要处于直接人工回合中的存活根 Agent。缺少回答器和无人值守工作不会被默认放行。冷续跑必须保留持久的作用域绑定。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作记录</summary>

无。

</details>
