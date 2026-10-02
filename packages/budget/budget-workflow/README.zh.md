---
description: "为每个配置的 Workflow 运行提供共享父预算。并发子任务从同一账本预留，并在模型调用前保留 Session 绑定。取消运行仍会保留不确定用量。"
kind: "package-reference"
---

# @changanhua/dsh-budget-workflow

[English](README.md) | 中文

## 摘要

为每个配置的 Workflow 运行提供共享父预算。并发子任务从同一账本预留，并在模型调用前保留 Session 绑定。取消运行仍会保留不确定用量。

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

在 `workflows` 中配置确切的 `name`、`limits` 和 `onExhausted`，并挂载 Agent 和 LLM 预算桥接。没有匹配 Host 策略或获准父作用域的 Workflow 不能启动子任务。

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

- 本桥接覆盖进程内 Workflow 子任务路径，不授权绕过本地 LLM 运行时的外部 Agent 服务，也不增加自动 Activation。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作记录</summary>

无。

</details>
