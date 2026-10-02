---
description: "单 Host Candidate 持久化及仅人工可做的 pending Planning 晋升。"
kind: "package-service"
---

# @changanhua/dsh-initiative-local

[English](README.md) | 中文

## 概述

单 Host Candidate 持久化及仅人工可做的 pending Planning 晋升。

## 使用此包

显式配置 ownershipRoot 和稳定 operatorId；maxWorkspaceBytes 限制完整 Workspace 记录，包含历史、receipt 和晋升完成预留空间。maxCandidateViewBytes 默认 48 KiB，拒绝无法装入完整单 revision 投射的写入；入口输出上限须高于此值。Storage Domain 负责原子发布；本地 provider 持有由 OS 释放的 ownership lock，串行提交，并复核 live Session、Agent、Workspace、exact active Human command 或 open Agent turn。flush 失败会中止持久化；即使成功，origin 引用仍标记为 unverified。

参见[配置与命令](../README.zh.md)及 [Initiative 子系统](../../../docs/subsystems/initiative.zh.md)。

## 不变量策略

不发布 invariant 伴随模块：所有 Candidate 事实均由同一个经过 schema 验证的原子记录导出，没有要对齐的独立投射。

## 模型体验

### 无直接模型上下文

#### 模型看到什么

无直接模型上下文；此包通过 `ctx.initiative` 不添加模型 prompt 或 tool。

#### Token 影响

无直接 token 影响。

#### KV Cache 影响

无直接 KV-cache 影响。

## 已知限制与后续工作

- prepared promotion 冻结 Candidate，直到原 key 恢复。仅调用 Planning propose：聚合 Board version 改变，canonical items 与 Delivery 状态不变。真实 RIR 不可用。不提供外部引用自动解析、秘密识别或调查执行。
