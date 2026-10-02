---
description: "加载批准的项目 Plan，同时防止文件自行授权凭据或预算豁免。可发现安全摘要、检查当前预检，并在重启后恢复同一已准入运行。重新加载只发布完整代次。"
kind: "package-reference"
---

# @changanhua/dsh-eval-plans-local

[English](README.md) | 中文

## 摘要

加载批准的项目 Plan，同时防止文件自行授权凭据或预算豁免。可发现安全摘要、检查当前预检，并在重启后恢复同一已准入运行。重新加载只发布完整代次。

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

从[版本化示例](examples/minimal-v1.plan.json)和[配置指南](../../../docs/cookbook/trusted-eval-and-budget.zh.md)开始。将本实现与 Workspace Registry、私有同步 Storage Domain 一起挂载；[已验证的 Profile](tests/fixtures/profile/plans.patch.yml)包含明确的来源和容量配置。 真实调用来源要求 owner 验证的有限预算及到期时间，每条 route 必须明确设置正数 `maxTokens`。固定 Plan 只能豁免无密钥回放的预算准入。

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

- 预检证明配置可用性和内容身份，不证明执行完成。Tool 检查覆盖已注册契约，不证明实现字节。验证器执行和可信 GateDecision 生成仍由各自 owner 负责。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作记录</summary>

无。

</details>
