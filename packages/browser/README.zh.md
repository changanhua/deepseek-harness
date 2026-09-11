---
description: "为会话寻址的浏览器操作和经认证 Chrome 扩展提供方提供说明的 browser 包组。"
kind: "package-group"
---

# browser/ — 会话寻址的浏览器访问

[English](README.md) | 中文

## 摘要

本包组定义显式指明会话、安装、页面和元素目标的浏览器操作。消费方可以选择 `ctx.browser` 背后的提供方，而不将扩展连接视为对每个页面执行操作的许可。扩展提供方通过 Host 网关和由所有者批准的授权连接经认证的 Chrome worker，而工具消费方准备并批准面向模型的页面操作。原生批准会为可见且同 Session 的 Chrome peer 委托既有 Approval 服务。监控消费方持有持久计划与比较状态，将每次有限读取交给 Queue，并保留通知直到收到确认。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

定义及其 Host 提供方职责分离，可以独立组合。

| 包 | 作用 |
|---|---|
| [`@changanhua/dsh-browser`](browser/README.zh.md) | 在 `ctx.browser` 上定义会话寻址的实例、操作和会过期的准备操作 ticket。 |
| [`@changanhua/dsh-browser-extension`](browser-extension/README.zh.md) | 通过经认证的 HTTP 和 WebSocket 路由连接已批准的 Chrome worker。 |
| [`@changanhua/dsh-tool-browser`](tool-browser/README.zh.md) | 注册面向模型的检查工具和需要批准的页面操作工具。 |
| [`@changanhua/dsh-browser-monitor`](browser-monitor/README.zh.md) | 持有持久监控计划、有限 Queue 检查和可恢复的通知投递。 |

<a id="related-documentation"></a>
## 相关文档

- [架构](../../docs/architecture.zh.md) — 说明 Cordis 组合中的服务定义、提供方和消费方。
- [Web Client 子系统](../../docs/subsystems/web-client.zh.md) — 说明提供浏览器路由的 Host Web 应用。
- [存储子系统](../../docs/subsystems/storage.zh.md) — 说明凭据提供方使用的持久存储边界。
- [Host Web Server](../host/webserver/README.zh.md) — 负责 HTTP 和 WebSocket 路由注册。
- [Client Connection](../client/connection/README.zh.md) — 负责 Host authority 和已登录所有者检查。

<a id="dev-note"></a>
## 开发备注

无。
