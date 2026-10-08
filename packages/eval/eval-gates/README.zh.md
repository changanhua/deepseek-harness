---
description: "读取独立 Eval 决策及其证据是否仍有效。"
kind: "package-reference"
---

# @changanhua/dsh-eval-gates

[English](README.md) | 中文

## 概述

此 Service Definition 为已授权 Workspace 提供 evaluate 和 get。EvalGateView 将保留的决策与 current 或 stale 有效性分开。只有可信生产者能取得原始执行证据；解析后的 pass 不构成续跑许可。

## 目录

- [使用方式](#use-this-package)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用方式

挂载[本地 Gate owner](../eval-gates-local/README.zh.md)等生产者，通过已有 EvalRunAccess 能力访问。私有 GateSnapshotReader 契约只供可信 Host 组合使用，不接受线上的调用者输入。

<a id="further-exploration"></a>
## 进一步阅读

- [包组](../README.zh.md)
- [Eval 契约](../../../docs/subsystems/eval.zh.md)
- [架构](../../../docs/architecture.zh.md)

<a id="model-experience"></a>
## 模型体验

无；本包不增加模型提示词或工具。

#### KV Cache 影响

既有 Session 前缀保持不变；续跑时只追加本轮输入。检查器不发起模型请求。

## 已知限制与后续工作

不发布 invariant companion，因为公开状态直接派生自已有 owner 或唯一账本，没有独立缓存的投影。

<a id="known-limitations-and-deferred-work"></a>

- 证据过期后仍可查看历史决策。授权动作的消费者必须要求 current 有效性，并重新核对自身权限、资源和目标绑定。本契约不实现基线统计，也不认证修改后的 Harness 代码。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
