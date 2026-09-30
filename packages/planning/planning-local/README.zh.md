---
description: "具备单写者、来源采集与恢复能力的本地计划 Board Provider。"
kind: "package-reference"
---

# @changanhua/dsh-planning-local

[English](README.md) | 中文

## 概述

挂载此 Provider 可在 Storage Domain 中为每个 Workspace 持久保存一个受 CAS 保护的计划 Board。它把手工和链接来源标记为未验证，校验 Workspace 所属会话事件，并在已组合 Content 时读取精确保存版本。

Agent 直接创建或修订计划时，Provider 还会在缺少当前用户消息来源的情况下，自动附上经过校验的会话事件来源。若输入已达 20 条来源上限，则拒绝写入而不丢弃这条消息；同一请求的重放仍使用原请求身份。

Focus、资源链接及固定 Session 绑定保存在同一个 Board 记录中。对象修改在同一事务中发布不可变修订；delta 采纳在校验精确代次和基础修订后使用该事务。已绑定 Session 可以提出变更，但不能直接采纳或修改正式状态。

## 配置

`ownershipRoot` 是必填的绝对本地目录，用于单 Host owner lock。`maxBoardBytes` 限制一个序列化 Board，写入会在丢失数据前被拒绝。

Windows 使用进程内命名管道监听器，POSIX 使用内核 `flock`；崩溃会释放 OS 资源，正常关闭只关闭当前持有的资源。

## 不变量策略

不发布 invariant 伴随模块，因为每个 Board 都通过唯一的 Storage Domain 记录读取和校验，没有另一份缓存投影可供比较。

## 模型体验

### 无直接模型上下文

#### 模型看到什么

无直接内容。`planning-local` 只在可信 Consumer 调用后采集来源并提交 Board。

#### Token effect

无。

#### KV Cache effect

无。

## 已知限制与延后工作

- 未组合 Content Provider 时 Content 来源会被拒绝。
- Provider 不执行 Delivery，也不把复盘结果视为交付接纳证明。
