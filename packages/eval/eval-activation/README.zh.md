---
description: "表达从 Eval 决策到一轮 Goal 的显式 Host 授权续跑。"
kind: "package-reference"
---

# @changanhua/dsh-eval-activation

[English](README.md) | 中文

## 概述

ContinuationPolicy 在可信 Host 组合中固定目标 Session、Goal 版本、Budget、过期时间和续跑文本。CLI 调用者选择策略和 Gate；ActivationRequestFactory 从真实 owner 派生当前终态 Work 和 Attempt。

## 目录

- [使用方式](#use-this-package)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用方式

生产者提供 activate、get 和 reconcile。一个 Grant 最多消耗一次。consumed 回执证明续跑消息已持久接收，不代表 Goal 目标已完成或后续模型回答正确。

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

- 受支持的本地生产者需要不挂载 goal-round-driver 的专用 Profile。本契约不会从 Queue 通知、模型文本或未经验证的决策中推导动作授权。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
