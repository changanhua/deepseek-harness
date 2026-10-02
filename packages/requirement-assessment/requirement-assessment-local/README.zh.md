---
description: "通过现有 Storage Domain 服务持久化有界、不可变的评估历史。"
kind: "package-reference"
---

# @changanhua/dsh-requirement-assessment-local

[English](README.md) | 中文

## 概述

通过现有 Storage Domain 服务持久化有界、不可变的评估历史。

## 使用方式

与 `storageDomain`、`workspaceRegistry` 一同挂载。共享同一存储命名空间的每个 Host 都必须将 `ownershipRoot` 配置为同一个绝对本地目录；`maxWorkspaceBytes` 默认 4 MiB，约束包含预留与元数据的完整保留记录。由操作系统释放的独占所有权锁防止多个 Host 竞争。Provider 内串行化操作，在同一 Workspace 记录中原子提交评估并移除预留。写入与返回读取结果前重新检查权限和 Workspace 可用性。拒绝的写入不发布局部结果。相同的完整提交输入重放原始评估；摘要冲突或完成记录改变则拒绝。预留恢复在再次调用模型前匹配 request id 与 digest。重新评估必须保持相同 Workspace 与 subject。调用者的后续修改不能重写已提交输入，持久化前取消会阻止发布。

## 不变量策略

不发布 invariant companion：持久化记录是唯一权威观测，本包不维护可能独立漂移的投影。严格验证与原子写入在提交点强制维护其拥有的关系。

## 模型体验

### 不直接提供模型上下文

#### 模型看到什么

没有直接内容。`ctx.requirementAssessment` 不注册模型提示或工具；评估消费者选择输入。

#### Token effect

不直接增加 token。保存评估历史不代表将其注入模型请求。

#### KV Cache effect

没有直接缓存影响。本包不创建或改写模型请求。

## 已知限制与延后工作

- 本 Provider 只支持单 Host，每个 Workspace 最多保留 200 份完成记录与 200 个未确定结果的预留。未确定的预留在崩溃后仍保留，防止自动重复调用评估器。恢复需要先检查该不确定操作，再显式使用新 request id。没有自动裁剪、分布式写入协议或归档操作。所有权目录必须对应真实存储命名空间；不同目录不能保护同一个 backend。
