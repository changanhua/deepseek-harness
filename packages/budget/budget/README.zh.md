---
description: "为 Session、Goal 和 Workflow 定义统一资源账本。调用方可查询用量，并让父级上限约束子请求。服务定义不授予模型修改预算的权限。"
kind: "package-reference"
---

# @changanhua/dsh-budget

[English](README.md) | 中文

## 摘要

为 Session、Goal 和 Workflow 定义统一资源账本。调用方可查询用量，并让父级上限约束子请求。服务定义不授予模型修改预算的权限。

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

使用[本地实现](../budget-local/README.zh.md)和本组的桥接包，不要单独挂载抽象定义。

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

无，本包不增加模型提示，结果呈现由调用方负责。

#### KV Cache effect

本包不直接改写提示前缀，提示构造和缓存复用由相应调用方负责。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 作用域定义不可变；使用其他上限需要新的明确授权作用域。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作记录</summary>

无。

</details>
