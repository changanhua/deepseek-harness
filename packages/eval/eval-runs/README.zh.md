---
description: "通过统一授权契约启动、检查和控制持久化 Eval 运行。"
kind: "package-reference"
---

# @changanhua/dsh-eval-runs

[English](README.md) | 中文

## 摘要

在重启后找回同一次评测。检查 Cell Attempt、证据可用性及受限的角色和用量事实，同时保护私有提示与 Host 路径。每次操作都需要当前 Workspace 授权；运行结果不授予可信 Gate 通过或新的模型调用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

实现 CLI、Web 或可信 Host 调用方时依赖此契约。将[本地实现](../eval-runs-local/README.zh.md)与既有 Plan、Queue 和 Workspace owner 一起挂载；此抽象服务没有独立部署配置。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现说明</summary>

[服务契约](src/index.ts)区分安全视图和操作意图。Queue 拥有 Attempt 生命周期，实现从 Queue 和保留证据派生每个运行投影。Host 私有验证输入通过本地实现的代码能力取得，不能由公开证据视图反构造。本包没有独立缓存的业务投影，因此不发布 invariant companion。

</details>

<a id="further-exploration"></a>
## Further Exploration

- [包组](../README.zh.md)
- [Eval 契约](../../../docs/subsystems/eval.zh.md)
- [架构](../../../docs/architecture.zh.md)

<a id="model-experience"></a>
## Model Experience

无，本包不增加模型提示或工具，呈现与执行提示由调用方负责。

#### KV Cache effect

本包不改写提示前缀，模型调用由执行与续跑 owner 控制。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 重试适用于失败的 Work；未知执行需要操作人员明确解决。重试已取消 Work 不属于 Queue 契约。
- passed 是执行结果。可信 Gate 决策、保留来源核验与 Activation 授权分别由各自 owner 负责。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作背景</summary>

无。

</details>
