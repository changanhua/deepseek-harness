---
description: "内容 schema 与编辑约定：原文、不可变版本、草稿和幂等命令。"
kind: "package-reference"
---

# @changanhua/dsh-content

[English](README.md) | 中文

## 概述

保存下来的文本保持完整，编辑发生在独立草稿中。消费方使用同一套记录与命令 schema，并区分已确认保存和结果未知的响应。可信宿主消费方提供授权与来源解析；已保存内容不会自动成为 agent（智能体）能力。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

实现提供方或可信宿主消费方时导入此定义。将 [content-domain](../content-domain/README.zh.md) 挂载为具体服务；抽象定义不是可独立存储的插件，也没有配置项。

每次读取与修改都接收可信的同步授权回调。调用者无权访问时，回调必须抛错。协议适配器根据已认证连接构造回调，请求字段不能提供回调。修改命令在执行时再次检查权限，包括异步来源准备完成后。手动文本命令不能提供已核实的来源事实。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[Schema](src/schema.ts) 派生记录与命令类型。持久聚合记录保留原文版本、独立草稿和已提交命令回执。严格解析拒绝未知字段及损坏引用，不对文本进行正规化。提供方另行核验每段正文按原样编码为 UTF-8 后的 SHA-256 摘要。

[服务](src/index.ts) 返回独立数据副本和不含载荷的错误。回执查询可能返回未知结果；这不允许使用新重试身份。消费方保留原命令，直到核对出其持久结果。

</details>

<a id="further-exploration"></a>
## 进一步阅读

- [内容子系统](../../../docs/subsystems/content.zh.md) — 记录所有权和共享语义。
- [存储提供方](../content-domain/README.zh.md) — 限制与恢复。
- [存储子系统](../../../docs/subsystems/storage.zh.md) — 持久记录访问。

<a id="model-experience"></a>
## 模型体验

无，因为该定义不注册模型工具，也不提供模型上下文。

#### KV Cache 影响

无直接影响：保存或编辑内容不会增加模型请求 token。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

定义不提供用户入口。

- 会话授权、远程传输和 UI 由消费方负责，本包不注册这些能力。
- 同进程任意插件仍属可信代码；回调不是恶意插件的沙箱。

<a id="dev-note"></a>
### 开发备注

无。
