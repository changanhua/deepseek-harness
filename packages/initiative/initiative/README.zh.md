---
description: "共享 Candidate Service Definition 与严格 durable schema。"
kind: "package-library"
---

# @changanhua/dsh-initiative

[English](README.md) | 中文

## 概述

共享 Candidate Service Definition 与严格 durable schema。

## 使用此包

消费者将 exact live Agent 传给 ctx.initiative。人工调用另携带 active command identity；输入不能指定 actor、Workspace 或核验权限。CandidateId 是跨边界品牌身份。读取投射使用独立 CandidateSummary 类型，另含所选 revision、revision count、对应调查和最新 disposition；旧版本必须明确请求。

参见[配置与命令](../README.zh.md)及 [Initiative 子系统](../../../docs/subsystems/initiative.zh.md)。

读取分页携带覆盖 Workspace 全部 Candidate 记录的 `snapshotDigest`，不受过滤条件或分页影响，且不包含外部 RIR 关联。propose 和 investigate 可提供 `expectedSnapshotDigest`，在 owner 队列内、持久回执回放之后检查。可信 Host 可传入 `invocation.validateIntake`，核对其他 owner 后拒绝新的入口提交；该回调不授予权限，且不得重入 Initiative。模型 JSON 不能提供该回调。

## 不变量策略

不发布 invariant 伴随模块：此包仅拥有定义与 schema，不拥有运行时投射。

## 模型体验

### 无直接模型上下文

#### 模型看到什么

无直接模型上下文；此包通过 `ctx.initiative` 不添加模型 prompt 或 tool。

#### Token 影响

无直接 token 影响。

#### KV Cache 影响

无直接 KV-cache 影响。

## 已知限制与后续工作

- Definition 不提供 provider 或 evaluator。Candidate assessment subject 保留精确 revision 和内容 digest；不透明来源引用不证明其内容。
