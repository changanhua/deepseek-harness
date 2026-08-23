# @deepseek-ai/dsh-web-search-exa

[English](README.md) | 中文

由 [Exa](https://exa.ai) 支持的 `WebSearchProvider`，用于 harness [web 能力 seam](../web/README.zh.md)（`ctx.web`）。它调用 Exa 的 `POST /search` 端点并请求高亮摘要内容，把扁平 `results[]` 映射为 seam 规范化的 `WebSearchResult`。

这是一个**实现**包：它向 `ctx.web` 注册提供方，经可选的 `ctx.credentials` seam 在每次搜索时解析凭证，且不注册面向模型的工具（后者属于 `@deepseek-ai/dsh-tool-web`）。与 `@deepseek-ai/dsh-llm-deepseek` 一样，它是函数／命名空间插件（`inject: ['web']`），负责注册后端，而非默认导出服务。挂载 runtime-facts 服务时，它贡献两个仅 inspect 的提供方 fact（`web-search.exa.local-available` 与 `web-search.exa.credential-configured`）——投影是可选的，没有该服务时提供方行为与此前完全一致。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | （省略） | 字面量 Exa API 密钥。优先用 `apiKeyEnv`，使配置不含 secret；非空字面量优先。 |
| `apiKeyEnv` | `EXA_API_KEY` | 每次搜索经 `ctx.credentials` 解析的凭证引用；该 seam 缺席时回退进程环境。缺失值使调用以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败。 |
| `baseURL` | `https://api.exa.ai` | 端点基址；追加 `/search`。无法解析时提供方不可用。 |
| `searchType` | `auto` | 以 Exa `type` 发送的检索模式：`auto`（由 Exa 决定）、`keyword` 或 `neural`。 |
| `numResults` | （未设置） | 请求不含 `maxResults` 时使用的默认结果数。未设置时不发送默认值。必须是正整数。 |
| `highlightsPerResult` | `1` | 每个结果请求的 highlight 句子数（Exa `highlightsPerUrl`）。必须是正整数。 |

```yaml
- id: web-search-exa
  name: '@deepseek-ai/dsh-web-search-exa'
  config:
    apiKeyEnv: EXA_API_KEY
```

上述条目是 `web-search-exa` Settings section 的 base 层：覆盖它的 user 层会在**下一次**搜索生效，因为提供方按调用投影 section 而非在注册时捕获。因此端点或检索模式变化时，seam 的提供方选择不会闪烁。`apiKey` 带有 `role('secret')`，因此在任何层都不会出现在 `describe()` 响应中——配置界面只能得知 `apiKeyEnv` 所命名的凭证域是否持有值，永远不会得知某层是否携带字面量密钥。

## 映射

Exa 返回扁平 `results[]`，不返回生成答案，因此省略 `content`。每项结果映射为 `WebSearchSource`：`url` ← `url`、`title` ← `title`、`snippet` ← 第一个非空的 `highlights[]` 条目（没有高亮摘要的结果缺少可移植的 snippet，会被丢弃）、`publishedAt` ← `publishedDate`。请求的 `maxResults` 优先于已配置的默认 `numResults`，并作为 Exa `numResults` 发送，以优化成本和延迟；最终上限由 seam 强制执行。提供方失败（HTTP 错误、网络失败、响应体无法解析或结构不符）以 `WebError` `WEB_PROVIDER_ERROR` 呈现；凭证缺失以 `WEB_PROVIDER_CREDENTIAL_MISSING` 呈现；中止请求以 `WEB_ABORTED` 呈现。HTTP 重定向会在访问 `Location` 指向的目标之前被拒绝，并以 `WEB_PROVIDER_ERROR` 呈现。

## 模型体验

通过 [`dsh-tool-web`](../tool-web/README.zh.md) 间接影响；该工具保留此提供方经 `maxResults` 限制的 URL、标题、首条 highlight 与发布日期，或将确切的错误消息 `Exa search aborted`、`Exa search request failed: <error>`、`Exa search credential resolution failed: <error>`、`Exa search has no API key for "<ref>"; store it through the credentials service (the web Models page writes it), export it in the launching environment, or set a literal "apiKey" in the web-search-exa config` 和 `Exa returned an unprocessable response body: <error>` 置于消费方的错误包装层内；生成答案与提供方私有字段不进入上下文。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与暂缓事项

- **没有非空白高亮摘要的结果会被整个丢弃**：没有可映射的可移植 snippet，因此返回源可能少于请求数量。
- **动态凭证可用性在操作内解析**：同步 `available()` 契约只能确认存在解析器，无法查询异步凭证存储。因此被选中的无密钥提供方会以 `WEB_PROVIDER_CREDENTIAL_MISSING` 使搜索失败；稳定的 `web_search` schema 仍保持注册。调用方取消会在本地与本次 preflight 竞争，但无法强制任意凭证后端本身停止工作。
- **只公开 `searchType`／`numResults`／`highlightsPerResult`**：Exa 的其他控制项（livecrawl、category、域名／日期过滤条件、全文内容）等待提供方无关的 Service Definition 字段（见 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md)）。
- **按错误形状分类中止**：只有 `DOMException` 且名为 `AbortError` 时才映射为 `WEB_ABORTED`；携带自定义原因的中止（例如 `dsh-timeout` 的 `TimeoutReason`）会呈现为 `WEB_PROVIDER_ERROR`。
