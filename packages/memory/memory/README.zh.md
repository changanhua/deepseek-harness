---
description: "供调用者保存、复核和召回有来源命题的项目记忆契约。"
kind: "package-reference"
---

# @changanhua/dsh-memory

[English](README.md) | 中文

## 概述

使用此 Definition，通过所选 provider 提出可复用项目命题、读取当前可用记忆并记录精确的人工决策。候选不会因为由 agent（智能体）生成就自动生效。接纳与来源有效性是不同事实。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

Consumer 依赖此包并使用 `ctx.projectMemory`；组合挂载 [memory-local](../memory-local/README.zh.md) 等具体 provider。抽象类没有配置，也不是完整的应用组合。

[子系统参考](../../../docs/subsystems/project-memory.zh.md) 定义记录字段、决策权限、幂等和召回语义。调用者传入发起操作的 Agent；项目身份与人工权限不能来自模型参数。

<a id="understand-the-implementation"></a>
## 理解实现

[Schema](src/schema.ts) 分开校验来源定位与已观察的来源指纹。持久记录校验根据有序回执和人工决策重建生效与候选指针，拒绝孤立版本，并检查不可变历史的身份。[服务](src/index.ts) 分开提供普通召回与命令授权的历史查看。

<a id="model-experience"></a>
## Model Experience

无，因为此 Definition 不注册工具或提示词，记忆结果由 consumer 呈现。

#### KV Cache effect

无，因为此包不组装模型请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Definition 不提供存储、自动提炼、语义检索或外部知识同步。
- 人工接纳允许复用，但不证明命题真实，也不覆盖当前用户指令。

<a id="dev-note"></a>
### 开发备注

无。
