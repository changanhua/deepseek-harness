---
description: "通过经过认证的回环 MCP 端点公开选定的 DSH 原生工具，并且只按调用加载所需 preset。"
kind: "package-reference"
---

# @changanhua/dsh-mcp-server

[English](README.md) | 中文

## 概述

此包让本地 MCP 客户端调用选定的 DSH 工具，而无需在 Host 启动时加载全部 agent preset。它发布固定的能力目录，在首次调用时加载工具所属 preset，并返回带有 DSH 回执的有界结构化结果。当一个 DSH Host 是工具所有方且外部 MCP 客户端需要受控子集时使用它。它只监听回环地址，并要求已配置的 bearer token。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

将它挂载到已经提供 Web Server、Agent factory、session store、ToolRuntime、Loader 和 agent-presets 服务的 Host 组合中。

### 能力目录和配置

每个 `catalog` 行指定一个受信声明模块及其所属 preset。声明模块导出 `describe(options)`，并返回工具名称、描述、对象根输入 schema 和输出 schema。发现会导入声明，但不会挂载 preset 或创建 agent。

```yaml
- id: local-capabilities
  name: '@changanhua/dsh-mcp-server'
  config:
    path: /mcp
    tokenEnv: DSH_CAPABILITIES_TOKEN
    workspace: C:/work/project
    catalog:
      - preset: selector
        declaration: ./capabilities/select.declaration.js
        options: {}
    requestMaxBytes: 65536
    resultMaxBytes: 65536
    callTimeoutMs: 30000
    maxPendingCalls: 8
```

`path`、`tokenEnv`、`workspace`、每个限制以及 `catalog` 都是必填项。Web Server 必须监听 `127.0.0.1`；此包会拒绝其他监听地址、缺失或为空的 token 环境变量、相对 workspace 和无效路由。生成的[配置目录](../../../docs/config-catalog.zh.md#changanhuadsh-mcp-server)提供全部字段参考。

### 调用和恢复

端点只接受经过认证且不带 Origin 的 `POST` 请求。每个请求创建无状态 MCP exchange；无效凭据返回 `401`，提供 `Origin` 返回 `403`，其他方法返回 `405`。`tools/list` 公开 `dsh_capabilities` 和固定目录。调用 `dsh_capabilities` 会报告每项能力的 unloaded、loading、ready 或 failed 状态，但不激活它。

普通调用等待目标 preset 的共享 standing mount，创建一个新的真实 DSH Agent，验证已加载原生工具仍与声明元数据匹配，再通过 `ToolRuntime` 执行它。Agent 会获得调用专属 guard，因此配套工具不能执行。session 在返回回执前记录 `mcp/invocation-start` 和 `mcp/invocation-end` 并完成 flush，且不含模型请求、轮次、步骤或 assistant 事件。

调用回执包含 session id、call id、preset id 和耗时。调用方必须将 `unknown` 终态视为不确定，且不得自动回放。取消和超时是协作式的：它们停止准入并传播信号，但已开始工作的工具必须结算后才能得知结果。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>展开查看实现内部</summary>

目录在 Host 激活后不可变。每个 preset 的 single-flight 加载防止并发的首次调用挂载重复组合；失败挂载会清除该加载，使修复后的配置可由后续调用重试。同一 preset 的调用在加载后串行，不同 preset 可以独立加载。

端点只将 JSON 值和文本内容块转换为 MCP 结果。它在持久化终态值前测量完整 MCP 响应。超限、富内容或失败结果会变成有界错误回执；终态事件会存储 `null`，而不存储被拒绝的值。Host dispose 会停止准入、中止活跃调用、关闭 exchange 和未完成 HTTP 请求，然后等待自有工作结算。

此包不发布 runtime invariant 配套项。`dsh_capabilities` 是异步运行时观察：它在被读取后、另一个调用挂载 preset 前可能改变状态。静态 invariant 无法证明该观察等于之后的挂载，因此空报告器不会增加检查。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Agent presets](../../preset/agent-presets/README.zh.md) — standing preset 组合和 scope 所有权。
- [工具运行时](../../core/tools/README.zh.md) — 工具策略、输出校验和取消。
- [MCP client](../mcp-client/README.zh.md) — DSH 消费外部 MCP 工具。
- [Session 持久化](../../session/session-persistence/README.zh.md) — 持久 session 所有权。

-----

<a id="model-experience"></a>
## 模型体验

### 外部 MCP 目录

#### 模型看到的内容

外部 MCP 客户端会收到已配置的能力名称、描述、输入 schema 和 `dsh_capabilities`。此包不会创建 DSH 模型请求，也不会添加提示词文本。

#### Token 影响

外部客户端决定是否以及如何将已发现工具放入其模型上下文。此包只返回被调用工具的有界文本和结构化结果。

#### KV Cache 影响

DSH 中没有影响。外部客户端的缓存行为不属于此包；能力目录变化可能改变该客户端的工具前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **仅原生工具** — 暴露 `run_code` 的 preset 会被拒绝；外部调用不会进入 PTC mode。
- **仅被动 preset** — preset 必须可在没有模型轮次或用户输入时安全挂载。启动后台工作、要求交互 channel 或把挂载视为 agent 任务的 preset 不能作为能力绑定。
- **不自动回放** — 超时、断开和取消可能令已发送操作处于 unknown。
- **仅文本和 JSON** — 非文本内容块返回有界 `UNSUPPORTED_CONTENT` 错误。
- **不控制模型轮次** — 附加模型上下文和结束轮次信号返回 `UNSUPPORTED_EXECUTION_SEMANTICS`；外部工具调用没有可更新的模型轮次。
- **一个本地 Host** — 此版本支持一个经过认证的回环 Streamable HTTP 端点，不支持远程监听、stdio transport、Resources、Prompts 或长时任务控制。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>供维护者查看的工作上下文</summary>

无。

</details>
