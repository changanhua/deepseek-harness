---
description: "以 exact event 确定权限的人工直接 Candidate 命令。"
kind: "package-plugin"
---

# @changanhua/dsh-command-initiative

[English](README.md) | 中文

## 概述

以 exact event 确定权限的人工直接 Candidate 命令。

## 使用此包

/initiative 命令接受严格 JSON。Human propose、investigate、disposition 和 promote 共用持久 owner；assess 请求对精确不可变 Candidate 版本进行一次真实 RIR review。其他命令不调用模型。read 返回有界分页。owner 在提交前将规范化 payload 与尚未完成的 Commands command/run event 匹配；过期或虚构 command id 会被拒绝。maxOutputBytes 限制完整结果。

参见[配置与命令](../README.zh.md)及 [Initiative 子系统](../../../docs/subsystems/initiative.zh.md)。

## 不变量策略

不发布 invariant 伴随模块：Commands registry 拥有可撤销注册。

## 模型体验

### 无直接模型上下文

#### 模型看到什么

无直接模型上下文；此包通过 `ctx.initiative` 不添加模型 prompt 或 tool。

#### Token 影响

无直接 token 影响。

#### KV Cache 影响

无直接 KV-cache 影响。

## 已知限制与后续工作

- 入口使用 JSON，而非专门 dashboard。maxOutputBytes 须高于 provider 的 maxCandidateViewBytes 加响应封装；列表超限时缩小分页。此命令不能接纳 Planning Proposal 或派发 Delivery。
