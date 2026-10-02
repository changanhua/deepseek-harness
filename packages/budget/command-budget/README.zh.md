---
description: "无需让模型编辑策略即可设置和检查资源上限。人工命令可以撤销作用域或核对单个未知回执，不会启动工作。"
kind: "package-reference"
---

# @changanhua/dsh-command-budget

[English](README.md) | 中文

## 摘要

无需让模型编辑策略即可设置和检查资源上限。人工命令可以撤销作用域或核对单个未知回执，不会启动工作。

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

将本命令与 Commands、Agent Registry 和 Budget 一起挂载。使用 `/budget {"action":"read","scope":"session"}`；[配置指南](../../../docs/cookbook/trusted-eval-and-budget.zh.md)提供完整设置命令。`maxOutputBytes` 默认 65536。

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

- 只有存活根 Agent 上确切的活动人工命令可修改预算。已有作用域定义不可变；Goal 作用域必须具有 Session 父级。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作记录</summary>

无。

</details>
