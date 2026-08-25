# Client UI Capability

[English](README.md) | 中文

Capability 模块的浏览器面：侧栏的一级 Capability 导航入口（位于 Queue 入口正上方，带计数徽标），以及基于 `capabilityRegistry` Remote 的中心列只读 Capability 工作区。

工作区一屏回答一个问题：当前 Harness 向 agent 暴露了哪些 Skills、MCP 服务器和工具。它是**只读投影** —— 没有 CRUD、没有策略编辑、没有连接控制。三个标签页（Skills / MCP Servers / Tools）从单个快照渲染，带搜索框、汇总卡片和逐行详情抽屉。

## 壳层契约

- `sidebar.modules` —— 导航入口（`id: capability-module`，`order: 5`），注册进侧栏壳的模块座位，位于 Queue 模块（`order: 10`）正上方。徽标（`nav.badge`）显示合并计数（`N skills + M tools`），加载中/失败时显示 `0`。
- `shell.view` —— 中心列模块视图（`id: capability`），当 `capability` 模块激活时由框架的模块环渲染。会话保持在下方挂载，切回时状态不丢。

## 数据流

一个 `CapabilityStore`（snapshot/subscribe）同时服务两个入口。在当前会话上调用 `ctx.remote.capabilityRegistry.list({ sessionId })`，用代际守卫缓存宿主投影，使过期响应不会覆盖更新的加载。store 暴露 `load` / `retry` / `reset`；视图渲染 `status: loading | ready | error`。缺失的 Remote 命名空间回退为显式 `{ ok: false }` 错误，使 UI 显示"读取能力失败"并提供重试，而不是静默渲染空数据。

## 只读契约

宿主 `CapabilityRegistryGateway` 镜像三个实时注册表，只返回投影字段：

- **Skills** 来自 `ctx.skills.managementSnapshot({ scope })`，按查看会话的 scope —— 名称、描述、调用策略、来源/提供方、路径、来源与选择状态。
- **Tools** 来自 `ctx.tools.schemas(scope)` —— 公开名称与描述，MCP 桥接工具（`mcp__<serverName>__<rawName>`）标记其服务器。
- **MCP 服务器** 来自 module 为 `@deepseek-ai/dsh-mcp-client` 的 Loader 条目 —— 配置的 `serverName`、`transport`，以及当前在该命名空间下注册的工具数。

MCP 的 env、headers、command 与 args 永不返回浏览器。

## 模型体验

无。Capability 视图是纯客户端展示面；加载快照读取有界的宿主注册表，从不触发模型请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- 尚未转发 `capability/*` 刷新事件：store 在挂载与会话变更时加载，并提供手动重试；宿主注册表在打开的视图下变化时没有实时推送。
- Skills 与 Tools 是 **scope 感知** 的：投影解析当前会话的 scope。对预设尚未挂载（无活动 agent）的会话，回退到全局层，可能显示更少 —— 或零 —— 条目。
- MCP 状态局限于运行时能证明的范围：已配置的服务器 + 已注册工具数。连接生命周期（connected / reconnecting / last sync）是 MCP client supervisor 的内部细节，不暴露；没有配置 `mcp-client` 行的宿主如实地显示 0 个服务器。
- 无效 skill 诊断不展示；视图显示 skill 注册表在运行时报告的任何内容。
