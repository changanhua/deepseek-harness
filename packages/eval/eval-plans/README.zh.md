---
description: "发现批准的 Plan 版本，并在登记运行标识前获取最新预检结果。所有调用方使用同一个来源 owner。解析成功的 JSON 对象不是准入能力。"
kind: "package-reference"
---

# @changanhua/dsh-eval-plans

[English](README.md) | 中文

## 摘要

发现批准的 Plan 版本，并在登记运行标识前获取最新预检结果。所有调用方使用同一个来源 owner。解析成功的 JSON 对象不是准入能力。

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

项目文件使用[本地实现](../eval-plans-local/README.zh.md)。Host 调用方提供确切的存活 Workspace 和授权回调；浏览器及命令输入只选择 id/version。 仅供 Host 使用的 `resolvedRequirements` 保留批准的 Tool/Skill id/source/digest 集合，经过深冻结并绑定到 `resolvedDigest`，供后续与实际执行观测比对。字段存在不代表 GateDecision；`checks` 和 `ready` 表示当前验证结果。

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

- 准入记录批准的运行标识，不构成执行或验证器证据。调用方仍负责派发时授权及实际执行事实。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作记录</summary>

无。

</details>
