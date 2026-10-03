---
description: "在一次性 Profile 中检查冻结输出，不加载任务代码或调用模型。"
kind: "package-reference"
---

# @changanhua/dsh-eval-verifier

[English](README.md) | 中文

## 概述

检查器验证完整输入结构、预期 cell 覆盖和确定性条件，写入一份有边界的报告，包含真实 Profile、配置及持久化 Session 身份。进程和报告的认证仍由 Host 观测负责。

## 目录

- [使用方式](#use-this-package)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用方式

本地 Gate 运行器创建包含 Sessions 和 SessionPersistence 的私有 Profile，提供独占输入输出路径及字节边界。应用等待 appReady，物化其拥有的 Session 句柄，一次写入报告，关闭句柄，再通过 appExit 退出。

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

- 本应用不评判任意自然语言、不比较基线、不执行任务插件，也不认证自开发。纯 verifySnapshot 函数返回未绑定的运行身份；只有 Profile 生命周期能补充实际运行事实。没有独立缓存的服务投影，因此不需要 invariant companion。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
