---
description: "在模型调用前预留资源，并在调用完成后保留实际用量。未知用量在重启后仍保持占用，直到人工核对。单次批准不会提高后续上限。"
kind: "package-reference"
---

# @changanhua/dsh-budget-local

[English](README.md) | 中文

## 摘要

在模型调用前预留资源，并在调用完成后保留实际用量。未知用量在重启后仍保持占用，直到人工核对。单次批准不会提高后续上限。

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

将本实现与路由到独占、同步提交、私有存储后端的 Storage Domain 一起挂载。[已验证的 Profile 配置](tests/fixtures/profile/budget.patch.yml)提供完整组合；通过 `maxScopes`、`maxReservations` 和 `maxLedgerBytes` 限制保留的账本。

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

- 账本保留所有决策和回执，直到配置容量；不会静默删除证据或重置上限。输入预留可能是估算，缺失的 Provider 用量需要明确核对。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作记录</summary>

无。

</details>
