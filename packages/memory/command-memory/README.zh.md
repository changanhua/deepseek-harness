---
description: "人工复核项目记忆，查看来源预览，并接纳、拒绝或撤回精确版本。"
kind: "package-reference"
---

# @changanhua/dsh-command-memory

[English](README.md) | 中文

## 概述

`/memory` 命令让用户查看项目记忆及来源，对精确版本作出决策，并撤回已接纳命题。它通过 Commands 执行，不启动模型回合。每次决策都绑定到已准入命令的持久身份。

## 目录

- [使用此包](#use-this-package)
- [实现](#implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## 使用此包

<a id="use-this-package"></a>

将它与 Commands 和项目记忆 provider 一起挂载，或使用 [personal-memory bundle](../../bundle/personal-memory/README.zh.md)。`maxOutputBytes` 默认为 16384，完整命令结果可配置为 1024–16384 字节。

| 命令 | 结果 |
| --- | --- |
| `/memory` or `/memory list [page]` | 每页 20 条项目记忆身份和状态，排序稳定 |
| `/memory show <id>[@revision]` | 带来源预览的候选与生效内容，或一个历史版本 |
| `/memory accept <id>@<revision>` | 来源检查后接纳或重新确认精确版本 |
| `/memory accept <id>@<revision> --review-after <ISO-time>` | 指定未来的 UTC 复核截止时间，例如 `2099-09-08T00:00:00Z` |
| `/memory reject <id>@<revision>` | 拒绝待处理候选 |
| `/memory retire <id>@<revision>` | 撤回生效版本并保留历史 |

来源改变或不可读时不能接纳。过期决策目标会失败，不会改为选择更新版本。没有命令可以批量接纳候选或覆盖来源检查。

## 实现

<a id="implementation"></a>

[解析](src/parse.ts) 只接纳规定的命令语法。处理函数从人工授权的查看结果中取得记录版本条件，并向 provider 传递精确的调用身份。[呈现](src/render.ts) 引用记忆与来源原文，约束完整结果，并提供历史版本导航。没有对应的活动 Commands 记录时，直接调用处理函数也会被 provider 拒绝。

## Model Experience

无，因为此人工命令通过 Commands 直接呈现，不增加模型提示词或工具。

#### KV Cache effect

无，因为命令结果不修改模型请求前缀。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 撤回保留历史，不会擦除 Session 日志或来源文档。
- 查看结果超限时需要选择一个记忆版本；不会返回不完整命题正文。
- 接纳允许复用，但不证明事实真实。

### 开发备注

无。
