---
description: "定义不可变 Quick Review 记录与可信 Host 评估服务。"
kind: "package-library"
---

# @changanhua/dsh-requirement-assessment

[English](README.md) | 中文

## 概述

定义不可变 Quick Review 记录与可信 Host 评估服务。

## 使用方式

消费者传入 Host 派生的 Workspace 与 actor 权限。严格 schema 要求八个不重复的维度、三个不重复的压力测试、三类完整的投资分配 owner，以及五类建议性 route 中的一种。不接受总分或执行命令。完成记录保留实际输入、基线、评估器身份与原始响应；重新评估创建关联旧记录的新记录。资源引用保持 opaque，不授予检索权限。`reserve` 区分新预留、未确定结果的请求和已完成评估。`get` 与 `snapshot` 返回独立副本。

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

- 本定义不解析引用，也不计算当前 Planning drift。评估消费者负责授权的 subject 捕获与读取时比较。未知基线身份以明确字符串保留，不伪造版本。
