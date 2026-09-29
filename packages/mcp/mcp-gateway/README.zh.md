---
description: "在既有 Harness Host 内提供固定 Workspace 的 Planning MCP 端点。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-gateway

[English](README.md) | 中文

## 概述

这个可选 Host 插件通过 Streamable HTTP 提供三个 Planning 工具。它使用 Host 已有的 Planning provider，把原始想法保存为待处理提案，未知的范围、验收和估算保持为空。它不启动另一个 Harness，也不调用模型。

## 目录

- [使用此包](#use-this-package)
- [工具契约](#tool-contract)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

将此包安装到已经组合 Planning 和回环 Web 服务器的 `dsh` profile。Loader 条目必须与 Planning 使用同一个 Workspace Registry realm：

```yaml
- id: planning-mcp
  name: '@deepseek-ai/dsh-mcp-gateway'
  isolate:
    workspaceRegistry: web-host
  config:
    planningWorkspaceId: '<existing Workspace id>'
    tokenEnv: DSH_PLANNING_MCP_TOKEN
```

通过 `dsh --profile <name>` 启动 profile 前，向 Host 提供指定的环境变量。MCP 客户端使用 `http://127.0.0.1:<host-port>/mcp/planning` 和同一个 bearer 凭据。不要将凭据写入版本控制配置。插件拒绝非回环监听和带浏览器 Origin 的请求。移除插件会关闭活动调用并注销端点。

包补丁提供 Workspace Registry realm，但不选择 Workspace 或凭据。这些值必须由部署配置提供。默认 profile 不启用此包。

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `planningWorkspaceId` | 必填 | 此端点公开的既有 Workspace。 |
| `tokenEnv` | 必填 | 包含 bearer 凭据的 Host 环境变量名。 |
| `path` | `/mcp/planning` | 不带末尾斜杠的绝对 HTTP 路由。 |
| `requestMaxBytes` | `65536` | 输入 JSON 请求体的最大字节数。 |
| `resultMaxBytes` | `262144` | 完整工具结果的最大字节数，包含文本与结构化内容，不含 JSON-RPC 传输封装。最小值为 `512`。 |
| `callTimeoutMs` | `12000` | 断开连接并取消操作前的最长请求时间。 |
| `maxPendingCalls` | `8` | 最大并发 MCP 交互数。 |

<a id="tool-contract"></a>
## 工具契约

| 工具 | 输入与结果 |
| --- | --- |
| `dsh_planning_list` | 列出配置 Workspace 内的对象和提案摘要，并返回当前 Board 版本。 |
| `dsh_planning_read` | 读取该 Workspace 内一个精确 item 或 proposal id。 |
| `dsh_planning_propose` | 接收幂等请求 id、已观察的 Board 版本、原始想法和可选建议泳道。创建细节字段留空的待处理提案。 |

收录前同时搜索 item 和 proposal 摘要以避免语义重复。原样重试保留请求 id 和全部输入；同一 id 下更改内容会被 Planning 拒绝。Board 版本过期时，先重新读取再提交新请求。按返回的 proposal id 读回以确认收录。调用者不能选择其他 Workspace、actor 或 Session。端点不提供采纳、修订、Memory 或 Delivery 操作。

<a id="dev-note"></a>
## 开发备注

网关拥有传输生命周期与准入；Planning 拥有持久化、版本检查和回执。此包没有可独立比较的持久投影，因此不发布 invariant companion。Loader 组合测试覆盖真实 provider、重复收录、Workspace 隔离与端点清理。

<a id="model-experience"></a>
## 模型体验

### Planning 工具

#### 模型看到什么

模型看到 `dsh_planning_list`、`dsh_planning_read` 和 `dsh_planning_propose`，以及有大小限制的 JSON 结果。原始想法文本是来源资料，不是执行指令或已经确认的范围。细化和明确采纳仍在 Planning 内完成。

#### Token 影响

工具定义和返回记录消耗上下文 token。收录与读取操作本身不调用模型。超过端点大小限制的结果会被拒绝，不会静默截断。

#### KV Cache 影响

工具 schema 不随 Board 变化。每次调用追加返回数据，不重写之前的工具结果。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 一次部署只公开一个 Workspace。凭据仅授予这三个 Planning 操作。
- 语义查重仍由调用者负责；Planning 强制执行相同请求的幂等去重。
- 列表与读取有大小限制，尚不分页。超大结果返回明确错误。
- 原始收录不推断范围、验收、非目标、拆解或执行权限。
