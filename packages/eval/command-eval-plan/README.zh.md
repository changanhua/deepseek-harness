---
description: "从人工命令界面发现并预检批准的 Plan。明确的准入请求记录可复用的运行标识。这些命令都不会派发 Queue 工作或调用模型。"
kind: "package-reference"
---

# @changanhua/dsh-command-eval-plan

[English](README.md) | 中文

## 摘要

从人工命令界面发现并预检批准的 Plan。明确的准入请求记录可复用的运行标识。这些命令都不会派发 Queue 工作或调用模型。

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

挂载时由部署将 `entrypoint` 设置为 `web`、`cli` 或 `ci`，并明确设置 `maxOutputBytes`。使用 `/eval-plan {"action":"discover"}`；预检和准入参见[配置指南](../../../docs/cookbook/trusted-eval-and-budget.zh.md)。

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

- 本命令要求已注册 Workspace 中的存活 Agent，以及确切的活动人工命令证据。命令结果不会暴露完整的 Host Plan。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作记录</summary>

无。

</details>
