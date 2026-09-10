---
description: "为 Content 捕获提供已核实的完成会话消息来源。"
kind: "package-reference"
---

# @changanhua/dsh-content-session

[English](README.md) | 中文

## 概述

这个仅 Host 使用的 Cordis 服务会把一条已完成的助手消息解析为 Content 捕获所需的已核实来源。它没有配置，也不注册 Remote 方法、模型工具或模型上下文。

## 使用本包

与 `dsh-session-query` 一起挂载。受信任的消费者将访问回调和请求取消信号传给 `resolve()`，再把该解析器交给 `Content.capture()`。

请求中的 `messageId` 是 `assistant/message` 事件的规范十进制序号。服务仅接受追加的、未中断的消息：其中至少有一个文本块，且拼接后的正文非空。它不会裁剪或规范化文本。

## 行为

服务通过 `sessionQuery.readSession(id)` 读取：它重放校验完整逻辑日志并返回脱离的快照，调用方取消会与该读取竞争。它不会恢复或激活 Agent。没有工作目录的会话会被隐藏；来源为子 Agent 的会话会被拒绝。读取前后都会检查访问权限。

解析后的来源使用 `event:<seq>` 作为 `captureId`，并带有 `full-message` 的 `scope` 和 `completed-text` 的 `boundary`。缺失会话返回 `not_found`；格式错误的请求返回 `invalid_request`；未完成或混合输出返回 `invalid_transition`；其他读取失败返回 `unavailable`；取消返回 `closed`。

## 进一步探索

- [Content 定义](../content/README.zh.md) — 捕获契约和持久化记录。
- [会话查询](../../session-query/session-query/README.zh.md) — 实时优先的观察租约。

## 模型体验

无，因为这个会话来源桥接既不注册模型工具，也不注入模型上下文。

#### KV Cache 影响

无。解析来源不会调用模型。

## 已知限制与暂缓事项

- 捕获仅识别纯文本助手消息。推理、工具、图像或未来的非文本块都会使整条消息被拒绝。
- 本包读取一个持久会话切面。Content 负责字节限制、重复检测和持久化。

### 开发备注

不需要运行时不变量，因为一次 resolve 调用在读取完成后不保留状态。
