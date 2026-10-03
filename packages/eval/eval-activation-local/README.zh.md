---
description: "持久认领一次性 Grant，最多投递一轮已授权 Goal。"
kind: "package-reference"
---

# @changanhua/dsh-eval-activation-local

[English](README.md) | 中文

## 概述

私有账本先认领 Grant，再恢复 Session。Host 请求工厂与核验器读取真实 Gate、终态 Queue Attempt、Session 工作区，以及 Session Budget 和父级预算。在 followup 前再次检查。只有准确的持久消息 id、Goal 版本和轮次才能确认回执。

## 目录

- [使用方式](#use-this-package)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用方式

挂载本服务、Agents、Goals、Sessions 和私有同步 Storage Domain，从可信代码提供 createActivationHost 和 createActivationRequestFactory。使用 exclusiveGoalDriver=true 且不挂载 goal-round-driver 的专用 Profile。冷 Agent 需要 Profile 通过正常 Agent 请求扩展点提供模型路线。Grant Budget 必须属于目标 Session，并与 Eval Plan 授权一致。

即使 Grant id 不同，同一 Session 的操作也会串行处理。异步授权返回后，owner 在投递前再次检查 Grant 是否过期、Goal 身份及版本，以及 Agent 是否空闲。卸载 owner 会取消其活动轮次，并等待静止后再关闭账本。

<a id="further-exploration"></a>
## 进一步阅读

- [包组](../README.zh.md)
- [Eval 契约](../../../docs/subsystems/eval.zh.md)
- [架构](../../../docs/architecture.zh.md)

<a id="model-experience"></a>
## 模型体验

### Goal 续跑提示

#### 模型看到的内容

一次已授权轮次向同一 Session 追加标准 `<goal_round>` 提示和 Host 固定的续跑文本。已有历史保留不变。

#### Token 影响

每轮增加目标、固定指令和续跑文本的 token；本轮内的模型及工具请求仍受原预算约束。

#### KV Cache 影响

既有 Session 前缀保持不变；续跑时只追加本轮输入。检查器不发起模型请求。

## 已知限制与后续工作

不发布 invariant companion，因为公开状态直接派生自已有 owner 或唯一账本，没有独立缓存的投影。

<a id="known-limitations-and-deferred-work"></a>

- 恢复途中重启或无法证实投递时保持 needs-attention，不会自动重发。读取回执不会唤醒 Agent。owner 在静止后释放冷句柄，并把缺失的持久化标记为不确定。共享自动 Goal 驱动器、通用产物存储和自开发授权不在本生产者范围内。视图直接派生自账本，不发布 invariant companion。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
