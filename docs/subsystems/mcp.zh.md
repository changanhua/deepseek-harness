# MCP 能力端点

[English](mcp.md) | 中文

MCP 子系统有两个方向。[`mcp-client`](../../packages/mcp/mcp-client/README.zh.md)消费外部 MCP 工具服务器，并将它们的工具注册到 DSH。[`dsh-mcp-server`](../../packages/mcp/mcp-server/README.zh.md)向本地 MCP 客户端公开固定的 DSH 能力目录。服务器将每个已声明工具绑定到惰性 agent preset；发现不会挂载它，而调用会创建新的真实 Agent 并运行原生工具流水线。

能力端点只监听回环地址、使用 bearer 认证且没有 Origin 的 Streamable HTTP。它公开工具和 `dsh_capabilities`，不桥接 Resources 或 Prompts。声明摘要会防止已加载工具与已发布 schema 静默漂移。每次调用都会写入并 flush `mcp/invocation-start` 和 `mcp/invocation-end`；终态 `unknown` 不可回放。

端点只接受原生且被动的 preset。PTC 展示方式、非文本内容、附加模型上下文或结束轮次都会返回有界失败。[capabilities bundle](../../packages/bundle/capabilities/README.zh.md)提供一个独立 Profile，其中有两个绑定：有界候选选择和本地文件系统 glob。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmcpserver--mcpserver"></a>

### `ctx.mcpServer` — `McpServer`

One Host-owned MCP endpoint; each stateless HTTP exchange owns its SDK transport.

Source: [`packages/mcp/mcp-server/src/index.ts`](../../packages/mcp/mcp-server/src/index.ts)
<!-- END GENERATED cordis-surface -->
