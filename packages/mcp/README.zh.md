---
description: "MCP 包组：让 Harness 连接外部 Model Context Protocol 服务器，并向 MCP 客户端公开有界的 Harness 能力。"
kind: "package-group"
---

# MCP — 模型上下文协议

[English](README.md) | 中文

## 概述

`mcp/` 组让 Harness 双向连接 Model Context Protocol。客户端包挂载外部工具服务器；网关包从一个运行中的 Harness Host 公开有界能力，不启动第二个 Host。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

本组包含客户端、本地能力服务器和 Host 网关；详细信息以各自 README 为准。

| 包 | 提供的能力 |
|---|---|
| [`mcp-gateway/`](mcp-gateway/README.zh.md) | 通过固定 Workspace 的 MCP 端点公开 Host 已有的 Planning provider |
| [`mcp-client/`](mcp-client/README.zh.md) | 挂载一台外部 MCP 服务器，让模型可以把它的工具当作原生工具调用 |
| [`mcp-server/`](mcp-server/README.zh.md) | 通过惰性 preset 向本地 MCP 客户端公开已声明的 DSH 原生工具 |

-----

<a id="related-documentation"></a>
## 相关文档

先用可运行的示例配置体验插件，再阅读 Agent Note 了解其背后的行为决策。

- [MCP 客户端插件 Agent Note](../../.agents/notes/implemented/feature/2026-07-07-mcp-client-plugin.zh.md)——桥接的设计：服务器限定命名、发现、执行与环境清洗。
- [第三方记忆 MCP 指南](../../docs/user/guide/mcp-memory.zh.md)——可运行的 overlay 配置行与设置说明。
- [工具子系统参考](../../docs/subsystems/tools.zh.md)——接收已注册工具的 `ToolRuntime`。
- [MCP 子系统参考](../../docs/subsystems/mcp.zh.md)——客户端消费与本地能力公开。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
