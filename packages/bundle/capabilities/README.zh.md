---
description: "运行本地 MCP 能力 Profile：发现固定的小目录，并且只在调用时挂载对应 preset。"
kind: "package-bundle"
---

# `@changanhua/dsh-capabilities`

[English](README.md) | 中文

## 概述

capabilities Profile 向本地 MCP 客户端提供固定目录：`dsh_capabilities`、`choose_candidate` 与 `glob`。它会在匹配调用发生时才挂载模型选择或文件搜索 preset。该 Profile 服务于本地工作中心，不会暴露所有已安装的 DSH 能力。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

已验证的 Profile 入口是 `node apps/cli/lib/bin.js --profile capabilities`。对外 MCP 工具是 `dsh_capabilities`、`choose_candidate` 和 `glob`；`grep` 保持 search preset 私有，不是外部目录项。第一次选择调用会挂载拥有 provider 的 preset，第一次 glob 调用会挂载本地搜索 preset。

启动前，将 `DSH_HOME` 设为独立 Harness 数据目录，`DSH_MCP_WORKSPACE` 设为绝对工作目录，`DSH_MCP_TOKEN` 设为本机密钥。`DSH_MCP_PORT` 默认为 `8765`。需要模型的选择使用已有 `DEEPSEEK_API_KEY`；候选全部禁用时直接弃选，不调用模型。客户端使用期间需保持 Host 运行。

Streamable HTTP MCP 客户端连接 `http://127.0.0.1:8765/mcp`，发送 `Authorization: Bearer <DSH_MCP_TOKEN>`，不发送 `Origin` 头。客户端使用 HTTP 代理时，在 `NO_PROXY` 中加入 `127.0.0.1,localhost`。客户端的工具审批策略需单独配置。工作目录用于解析相对路径，不代表启用了文件系统沙箱。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

bundle 持有封闭的按需 preset roster 和一个面向 MCP 的目录。发现阶段读取声明而不挂载 preset。choice preset 拥有模型配置，search preset 拥有本地文件搜索；在加载前，实现与基础 Host 隔离。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [选择工具](../../llm/tool-choice/README.zh.md) — 有界模型选择。
- [架构](../../../docs/architecture.zh.md) — Profile 组合。

-----

<a id="model-experience"></a>
## 模型体验

### 按需能力目录

#### 模型看到的内容

根 Host 不发送模型请求。`choose_candidate` 调用会在真实 Agent Session 中创建一次有界选择请求；`dsh_capabilities` 和 `glob` 不会发送模型请求。

#### Token 影响

只有 `choose_candidate` 消耗模型 Token，并受其 preset 配置限制。

#### KV Cache 影响

选择调用是独立辅助请求，不创建 Agent 回合缓存前缀。

<a id="known-limitations-and-deferred-work"></a>
## 限制与延期工作

- 目录是固定的；preset 挂载后会在 Host 生命周期内保持可用；此 bundle 不跨 Profile 路由调用。

未发布运行时 invariant companion，因为该 bundle 只拥有组合，其可观察行为由 Profile 测试覆盖。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
