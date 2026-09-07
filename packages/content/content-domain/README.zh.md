---
description: "个人内容持久化提供方：配置字节上限、诊断不可用存储并恢复原文和草稿。"
kind: "package-reference"
---

# @changanhua/dsh-content-domain

[English](README.md) | 中文

## 概述

保存原文、编辑独立草稿，并在重新打开内容库后恢复已提交版本。每个成功命令将回执与完整条目一并提交，包括未经核实的提供文本或网页来源。文本编辑发生冲突时会被拒绝，不覆盖另一份草稿。提供方使用 Storage Domain，要求专用后端提供单写者、同步提交和私有目录保证。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

将此提供方与 Storage 和 Storage Domain 一同挂载。把 `content_library` 路由到专用后端；该领域要求 `single-writer`、`commit-sync` 和 `private-root`。现有 SQLite 提供方通过独占所有权、显式同步和私有目录执行这些保证。本包不选择文件系统路径，也不注册传输入口。

配置拥有全部大小策略：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `bodyBytes` | 1048576 | 每份保留草稿或版本正文的 UTF-8 字节数 |
| `entryBytes` | 8388608 | 序列化条目，包含全部版本、回执和元数据字段 |
| `libraryBytes` | 134217728 | 序列化逻辑 Domain 封装，包含记录键 |

写入前检查上限。将上限调低至小于已有用量时，内容库仍可读取与导出，状态为 `ready/capacity_exceeded`；恢复合适配置前拒绝全部新写入。历史永不截断。已知命令的无副作用重试仍可查询结果。

提供方在打开时检查来源摘要和记录身份。坏记录使内容不可用，但不会移除 Storage Domain 服务或阻断普通领域。提交状态不确定的写入失败会丢弃内容读取视图，并关闭自身 Domain 句柄。恢复时重新创建提供方及其专用后端，再查询或重试原操作身份。后端插件拥有物理连接，并在 dispose（资源释放）时关闭它。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

每次激活拥有一个 Domain 句柄、已准入的来源准备操作和短写入链。释放时停止新准入，等待准备操作结算，排空写入并关闭句柄。`get`、`snapshot` 和 `receipt` 在授权后返回独立数据副本。逻辑导出包含原文版本和当前草稿。

提供方在每条内容中保留最近 256 个修改回执。创建和版本操作另行永久保留自身回执。相同请求重试返回原结果；保留身份对应不同载荷时会被拒绝。已淘汰的临时请求仍须满足预期修订。再次捕获同一来源返回最初创建结果，不同来源即使文本相同也保持独立条目。

</details>

<a id="further-exploration"></a>
## 进一步阅读

- [内容定义](../content/README.zh.md) — schema 和可信调用方责任。
- [内容子系统](../../../docs/subsystems/content.zh.md) — 共享记录语义。
- [SQLite 提供方](../../storage/storage-sqlite/README.zh.md) — 私有数据库所有权。

<a id="model-experience"></a>
## 模型体验

无，因为该提供方保存人类内容，不注册模型工具或上下文。

#### KV Cache 影响

无直接影响：这些存储操作不发起模型请求。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

提供方实现内容后端，目前有以下限制：

- 本包不提供人类 Remote、真实 Session 来源授权、UI 或浏览器导入。
- 全领域加载和聚合替换要求内容库有界；没有附件存储、物理删除、索引或跨设备同步。
- 可信消费方可以获得逻辑快照；恢复导入和自动备份尚未实现。
- 关闭 Domain 句柄不会释放后端的 SQLite 独占连接。恢复还必须释放专用后端；本提供方不能越层关闭共享后端。

<a id="dev-note"></a>
### 开发备注

无。
