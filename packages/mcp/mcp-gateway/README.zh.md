---
description: "为现有 DSH 连接器和 Host 提供可选择项目的 Planning 工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-gateway

[English](README.md) | 中文

## 概述

这个可选 Host 插件使用 Host 已有的 Planning provider，提供项目发现、搜索、读取和原始想法收录。它的连接器扩展将这些工具加入现有 MCP 服务器，保留该服务器的其他工具。收录结果仍是细节留空的待处理提案；这些操作都不调用模型。

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
    tokenEnv: DSH_PLANNING_MCP_TOKEN
```

通过 `dsh --profile <name>` 启动 profile 前，向 Host 提供指定的环境变量，或者将 `tokenEnv` 替换为私有凭据文件的绝对路径 `tokenFile`。两种来源必须且只能配置一种。文件凭据可在正常重启 Host 后继续使用，不需要修改启动环境。MCP 客户端使用 `http://127.0.0.1:<host-port>/mcp/planning` 和同一个 bearer 凭据。不要将凭据写入版本控制配置。插件拒绝非回环监听和带浏览器 Origin 的请求。移除插件会关闭活动调用并注销端点。

包补丁提供 Workspace Registry realm。操作人配置凭据，并可用 `workspacePaths` 限制项目访问范围。省略此配置时，本地连接可访问全部已注册项目；空数组表示不允许任何项目。调用使用返回的项目 id 或精确路径，不能创建 Workspace。可用项目超过一个而调用没有指定项目时会报错，不会猜测。默认 profile 不启用此包。

现有连接器可以从 `@deepseek-ai/dsh-mcp-gateway/connector` 导入 `registerPlanningTools`，传入其 MCP server 和 `{ url, token }`；其中 `token` 是异步凭据读取函数。这个库扩展没有可执行入口。注册时不发网络请求，因此 Planning Host 离线时，工具发现和连接器其他工具仍可使用。不要用只提供 Planning 的 Host 端点替换已有的浏览器和会话网关。

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `workspacePaths` | 全部已注册项目 | 可选的精确项目路径白名单。空数组表示拒绝访问。 |
| `tokenEnv` | 未设置；无 `tokenFile` 时必填 | 包含 bearer 凭据的 Host 环境变量名。 |
| `tokenFile` | 未设置 | 私有凭据文件的绝对路径，替代 `tokenEnv` 使用。 |
| `path` | `/mcp/planning` | 不带末尾斜杠的绝对 HTTP 路由。 |
| `requestMaxBytes` | `65536` | 输入 JSON 请求体的最大字节数。 |
| `resultMaxBytes` | `262144` | 完整工具结果的最大字节数，不含 JSON-RPC 传输封装。最小值为 `512`。 |
| `callTimeoutMs` | `12000` | 断开连接并取消操作前的最长请求时间。 |
| `maxPendingCalls` | `8` | 最大并发 MCP 交互数。 |

<a id="tool-contract"></a>
## 工具契约

连接器还接受可选的 `currentWorkspace` 回调，提供可信连接上下文中的当前项目 id 或精确路径。每次调用重新读取，只补充省略的项目选择。显式 `workspace` 优先；Host 仍强制校验白名单。没有连接上下文时，Host 使用唯一允许的项目；存在多个项目则要求显式选择。此回调不推断浏览器标签页的当前项目。

| 工具 | 输入与结果 |
| --- | --- |
| `dsh_planning_workspaces` | 分页发现允许访问的已注册项目。 |
| `dsh_planning_list` | 在选定项目内搜索 item 和 proposal 摘要，支持查询、分页和 Board 版本。 |
| `dsh_planning_read` | 读取精确对象或不可变版本；大型 JSON 结果返回受限片段及后续游标。 |
| `dsh_planning_propose` | 接收幂等请求 id、已观察的 Board 版本、原始想法和可选建议泳道。创建细节字段留空的待处理提案。 |

收录前同时搜索 item 和 proposal 摘要以避免语义重复。翻页时携带返回的 Board 版本；版本变化时重新搜索。写入原样重试保留请求 id 和全部输入。Board 版本过期时，先重新读取再提交新请求。按返回的 proposal id 读回以确认收录。未知字段以及调用者提交的 actor、Session 和来源声明均被拒绝。外部原文保持为未验证的手动来源，不伪装成 DSH 用户消息。端点不提供采纳、修订、Memory 或 Delivery 操作。

<a id="dev-note"></a>
## 开发备注

网关拥有传输生命周期与准入；Planning 拥有持久化、版本检查和回执。此包没有可独立比较的持久投影，因此不发布 invariant companion。Loader 组合测试覆盖真实 provider、重复收录、Workspace 隔离与端点清理。

<a id="model-experience"></a>
## 模型体验

### Planning 工具

#### 模型看到什么

模型看到 `dsh_planning_workspaces`、`dsh_planning_list`、`dsh_planning_read` 和 `dsh_planning_propose`，以及有大小限制的 JSON 结果。原始想法文本是来源资料，不是执行指令或已经确认的范围。细化和明确采纳仍在 Planning 内完成。

#### Token 影响

工具定义和返回记录消耗上下文 token。收录与读取操作本身不调用模型。搜索摘要和后续游标限制输出；完整对象读取可分页传递大型 JSON，不丢失文字。数据只返回一份，不在文本和结构化内容中重复同一 JSON。

#### KV Cache 影响

工具 schema 不随 Board 变化。每次调用追加返回数据，不重写之前的工具结果。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 凭据授予部署所允许的已注册项目的 Planning 访问权，不表示远端用户身份或浏览器标签页的当前项目。
- 语义查重仍由调用者负责；Planning 强制执行相同请求的幂等去重。
- 提交后连接器传输失败表示结果未知。连接器不会自动重新提交写入。
- 原始收录不推断范围、验收、非目标、拆解或执行权限。
