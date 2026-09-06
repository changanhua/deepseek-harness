---
description: "内容库的浏览器认证、来源捕获与持久命令结果。"
kind: "package-reference"
---

# @changanhua/dsh-content-remote

[English](README.md) | 中文

## 概述

通过经过认证的浏览器请求，保存已完成的纯文本会话回复，读取或编辑已保存内容。Host 自行读取来源并返回已提交回执。响应丢失后重试时，应保留原命令身份。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在 Cordis 组合中将本服务与 Connection、Content 和会话来源桥接一起挂载。本包没有配置。生成的 `./remote` 导出提供浏览器使用的 Typert 方法；`./typert` 提供严格 Host 描述。本服务不安装 Profile 或 UI。

包括状态查询在内，每个方法都要求来自 [Connection](../../client/connection/README.zh.md) 的当前 HTTP 请求的原始取消信号。读取返回独立内容副本；条目或回执不存在时返回 null。回执为 null 表示结果未知，不表示未提交。捕获仅接受来源引用；手工文本保持未核实状态。类型化失败不携带正文、文件系统路径或凭据详情。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

Remote 从 Connection 的活动请求绑定派生同步授权回调。排队命令进入提交准入点时，Content 再次调用该回调。捕获将来源读取交给 [content-session](../content-session/README.zh.md)，再使用同一 Content 修改路径。写入已经提交后，不会因响应或连接丢失而回滚。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [内容定义](../content/README.zh.md) — 记录、修订与回执。
- [内容子系统](../../../docs/subsystems/content.zh.md) — 共享职责。
- [内容提供方](../content-domain/README.zh.md) — 持久化与失败恢复。

<a id="model-experience"></a>
## 模型体验

无，因为本浏览器 Remote 不注册模型工具或模型上下文。

#### KV Cache 影响

无直接影响：内容请求不调用模型。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 访问使用本地操作者的浏览器凭据；没有逐项目 ACL，也不区分持有同一凭据的人与自动化程序。
- WebSocket 和直接进程内调用者没有经过认证的 HTTP 请求绑定，因此会被拒绝。浏览器 UI 和随附 Profile 组合属于独立消费方。
- 清除浏览器 cookie 不会撤销已经发出的请求；适用 Connection 的凭据激活和过期规则。

<a id="dev-note"></a>
### 开发备注

无。
