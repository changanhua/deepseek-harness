# @deepseek-ai/dsh-web-search-perplexity

[English](README.md) | 中文

由 [Perplexity](https://perplexity.ai) 支持的 `WebSearchProvider`，用于 harness [web 能力 seam](../web/README.zh.md)（`ctx.web`）。它调用 Perplexity 的 OpenAI 兼容 `POST /chat/completions` 端点，把生成答案与引用映射为 seam 规范化的 `WebSearchResult`。

这是一个**实现**包：它向 `ctx.web` 注册提供方，经可选的 `ctx.credentials` seam 在每次搜索时解析凭证，且不注册面向模型的工具。与 `@deepseek-ai/dsh-llm-deepseek` 一样，它是函数／命名空间插件（`inject: ['web']`）。OpenAI 兼容协议格式（wire format）是提供方私有细节，并**不**使该提供方依赖 `ctx.llm`。挂载 runtime-facts 服务时，它贡献两个仅 inspect 的提供方 fact（`web-search.perplexity.local-available` 与 `web-search.perplexity.credential-configured`）——投影是可选的，没有该服务时提供方行为与此前完全一致。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | （省略） | 字面量 Perplexity API 密钥。优先用 `apiKeyEnv`，使配置不含 secret；非空字面量优先。 |
| `apiKeyEnv` | `PERPLEXITY_API_KEY` | 每次搜索经 `ctx.credentials` 解析的凭证引用；该 seam 缺席时回退进程环境。缺失值使调用以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败。 |
| `baseURL` | `https://api.perplexity.ai` | 端点基址；追加 `/chat/completions`。无法解析时提供方不可用。 |
| `model` | `sonar` | 搜索模型名称。 |
| `maxTokens` | `1024` | 生成答案 token 上限（`max_tokens`）。必须是正整数。 |
| `searchRecency` | （未设置） | 以 `search_recency_filter` 发送的新近程度窗口：`day`、`week`、`month` 或 `year`。未设置时不发送过滤条件。 |

```yaml
- id: web-search-perplexity
  name: '@deepseek-ai/dsh-web-search-perplexity'
  config:
    apiKeyEnv: PERPLEXITY_API_KEY
```

上述条目是 `web-search-perplexity` Settings section 的 base 层：覆盖它的 user 层会在**下一次**搜索生效，因为提供方按调用投影 section 而非在注册时捕获。因此端点或模型变化时，seam 的提供方选择不会闪烁。`apiKey` 带有 `role('secret')`，因此在任何层都不会出现在 `describe()` 响应中——配置界面只能得知 `apiKeyEnv` 所命名的凭证域是否持有值，永远不会得知某层是否携带字面量密钥。

## 映射

`content` ← `choices[0].message.content`（生成答案）。`sources[]` 优先使用结构化 `search_results[]`（`url`、`title`、`snippet`、`publishedAt` ← `date`），否则回退到只含 URL 的 `citations[]` 数组；仅当不存在 `search_results` 时才采取这条回退路径。这些源只携带 `url`，因此 seam 上的 `title`／`snippet`／`publishedAt` 是可选字段。提供方失败以 `WebError` `WEB_PROVIDER_ERROR` 呈现；凭证缺失以 `WEB_PROVIDER_CREDENTIAL_MISSING` 呈现；中止请求以 `WEB_ABORTED` 呈现。HTTP 重定向会在访问 `Location` 指向的目标之前被拒绝，并以 `WEB_PROVIDER_ERROR` 呈现。Perplexity 没有结果数量控制，因此 seam 会强制执行 `maxResults`（截断 `sources[]` 并设置 `truncated`）。

## 模型体验

### 辅助 Perplexity 请求

#### 模型看到的内容

独立的 Perplexity 模型通过 chat-completions 端点将 `<query>` 原样作为唯一用户消息接收。该请求不属于会话模型上下文。

#### Token 影响

每次搜索会产生独立的提供方 token；`maxTokens` 限制生成答案。

#### KV Cache 影响

与会话请求缓存相互独立。同一模型路由下的相同查询可能复用提供方缓存；查询或路由改变会建立不同前缀。

### 间接的会话工具结果

#### 模型看到的内容

通过 [`dsh-tool-web`](../tool-web/README.zh.md)，会话模型会看到生成答案及结构化结果元数据，或只含 URL 的引用。该提供方确切的错误消息为 `Perplexity search aborted`、`Perplexity search request failed: <error>`、`Perplexity search credential resolution failed: <error>`、`Perplexity search has no API key for "<ref>"; store it through the credentials service (the web Models page writes it), export it in the launching environment, or set a literal "apiKey" in the web-search-perplexity config` 和 `Perplexity returned an unprocessable response body: <error>`；HTTP 失败保留提供方消息。错误包装层属于消费方。

#### Token 影响

注册不会直接产生会话 token。答案与源 token 取决于数据，源数量受服务限制；保留的结果或错误会重复发送，直到发生压缩（compaction）。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **引用回退源只含 URL**：Perplexity 省略结构化 `search_results[]` 时，源不含 `title`／`snippet`／`publishedAt`，因此工具只渲染纯主机名标签。
- **动态凭证可用性在操作内解析**：同步 `available()` 契约只能确认存在解析器，无法查询异步凭证存储。因此被选中的无密钥提供方会以 `WEB_PROVIDER_CREDENTIAL_MISSING` 使搜索失败；稳定的搜索 schema 仍保持注册。调用方取消会在本地与本次 preflight 竞争，但无法强制任意凭证后端本身停止工作。
- **超量返回的来源仍会增加 token 消耗和延迟**：协议没有结果数量控制，`maxResults` 只能由 seam 在事后截断。
- **只公开 `model`／`maxTokens`／`searchRecency`**：Perplexity 的其他搜索控制项（域名过滤条件、`web_search_options` 上下文大小、图片）有待提供方无关的 Service Definition 字段支持（见 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md)）。
- **按错误形状分类中止**：只有 `DOMException` 且名为 `AbortError` 时才映射为 `WEB_ABORTED`；携带自定义原因的中止（例如 `dsh-timeout` 的 `TimeoutReason`）会呈现为 `WEB_PROVIDER_ERROR`。
