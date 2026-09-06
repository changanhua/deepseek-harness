---
description: "个人内容包：保存原文、编辑草稿和恢复已提交版本。"
kind: "package-group"
---

# content/ — 个人内容库

[English](README.md) | 中文

## 概述

本组让有用文本独立于来源会话保留下来。定义包拥有共享记录和编辑约定；提供方通过 Storage Domain 提交记录。来源桥接和人类界面使用该约定，不另行拥有一份内容库。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

这些包都使用个人命名空间。

| 包 | 职责 |
|---|---|
| [`content`](content/README.zh.md) | 内容 schema 和 Service Definition |
| [`content-domain`](content-domain/README.zh.md) | 持久聚合记录、修订检查和重试回执 |
| [`content-session`](content-session/README.zh.md) | 经核实的已完成纯文本会话来源 |
| [`content-remote`](content-remote/README.zh.md) | 经过认证的浏览器读取与修改 |

<a id="related-documentation"></a>
## 相关文档

- [内容子系统](../../docs/subsystems/content.zh.md) — 共享数据与权限约定。
- [存储组](../storage/README.zh.md) — 持久化机制。

<a id="dev-note"></a>
## 开发备注

无。
