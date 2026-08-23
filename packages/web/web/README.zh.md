# @deepseek-ai/dsh-web

[English](README.md) | 中文

**`WebRuntime`**（`ctx.web`）定义 harness 具备哪些 web 访问能力（搜索 web、抓取 URL），并通过多个提供方实现，不把模型约定绑定到某个厂商的 API 形状。

本包承担 web 能力的 Service Definition 角色。与 shell/fs 不同，它在一个 seam 上跨越搜索与抓取两种操作，每种操作都可能有多个提供方：

| 包 | 职责 |
|---|---|
| `@deepseek-ai/dsh-web`（本包） | Service Definition：服务、提供方注册表、选择策略、请求／结果词汇、`WebError` 分类体系 |
| `@deepseek-ai/dsh-web-search-exa` | 搜索提供方：Exa |
| `@deepseek-ai/dsh-web-search-perplexity` | 搜索提供方：Perplexity |
| `@deepseek-ai/dsh-web-fetch-http` | 抓取提供方：匿名公共 HTTP(S) |
| `@deepseek-ai/dsh-tool-web` | Consumer：面向模型的 `web_search`／`web_fetch` 工具 schema，构建于 `ctx.web` 之上 |

搜索与抓取没有共享请求 schema 或业务逻辑，但有意共用一个 seam：`ctx.web` 是单一 web 访问中间层，拥有一项提供方选择策略、一套中止／错误词汇和一个面向产品的「该 harness 如何访问 web」配置接口。成对的 `Search`／`Fetch` 方法保持并行是有意为之。

## 服务 API（`ctx.web`）

| 成员 | 语义 |
|---|---|
| `registerSearchProvider(provider)`／`registerFetchProvider(provider)` | 注册后端。同一能力类型下 id 重复时抛出 `WebError` `WEB_DUPLICATE_PROVIDER`。返回 disposer。随调用 fiber 一并 dispose（资源释放）。 |
| `search(request, signal?)` | 解析搜索提供方并运行一次搜索。在结果上强制执行 `request.maxResults`（截断 `sources[]`，设置 `truncated`）。能力无法运行时抛出 `WebError`。 |
| `fetch(request, signal?)` | 解析抓取提供方并获取一个 URL。非 2xx 响应是结果，不会抛出异常。无法安全获取或表示资源时抛出 `WebError`。 |

提供方注册的是**能力**而非工具。`dsh-tool-web` 是面向模型的名称、描述、提示词指引、JSON Schema 和呈现的唯一归属方。

## 选择

选择绝不依赖注册、配置或 HMR（热模块替换）顺序。能力要么具有显式提供方 id（配置 `searchProvider`／`fetchProvider`，或由环境变量 `$DSH_WEB_SEARCH_PROVIDER`／`$DSH_WEB_FETCH_PROVIDER` 提供相同字段），要么在恰好只注册一个可用提供方时自动选择。`search()`／`fetch()` 会在执行时解析提供方：

| 情况 | 执行 |
|---|---|
| 已配置 id 已注册且 `available()` | 运行该提供方 |
| 已配置 id 未注册 | `WEB_PROVIDER_CONFIGURED_MISSING` |
| 已配置 id 已注册但不可用 | `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` |
| 无 id，恰好一个已注册的可用提供方 | 运行该提供方 |
| 无 id，没有可用提供方 | `WEB_PROVIDER_UNAVAILABLE` |
| 无 id，多个可用提供方 | `WEB_PROVIDER_AMBIGUOUS` |

失败分支会抛出 `WebError`；调用方按其结构化 code（加消息细节：缺失 id、歧义候选集合）路由。提供方自身的 `available()` 是便宜的局部检查（凭据是否存在、配置是否可解析），供执行时选择使用，且**禁止发起网络调用**；`dsh-tool-web` 永远不会调用它。工具通过 `ctx.web.search()`／`fetch()` 执行，并按抛出的 code 路由，因此提供方选择只有一个归属方。

## 偏好（`web` settings section）

`searchProvider`／`fetchProvider` 偏好可通过 `web` settings namespace（`settings.yaml`）由用户编辑，并分层叠加于 composition entry（`searchProvider`／`fetchProvider` 配置加同一字段的环境变量覆盖）之上。`WebRuntime` 在每次 `search()`／`fetch()` 调用时实时读取该 section，因此用户层的编辑无需重启或重新注册提供方即可在下次调用生效；正在进行的调用保持其开始时解析的偏好快照。未挂载 settings provider 的部署完全按原来的 composition entry 运行。`WEB_SETTINGS_NAMESPACE`／`WEB_SETTINGS_SCHEMA` 承载该 section；接线遵循 `installSettingsSection`（`@deepseek-ai/dsh-settings`）。

## 运行时 fact（`web.search-selected`）

当可选的 `@deepseek-ai/dsh-runtime-facts` 服务挂载时，`WebRuntime` 注册一个 baseline 运行时 fact：`web.search-selected`（sync、dynamic、owner `web`）。其 resolver 读取实时 settings source，并使用与 `search()` 相同的内部提供方选择策略；若能够明确选中提供方则返回其 id，否则返回 `undefined`（观测为 `unavailable`）。这项派生状态不会扩出第二套 public provider-selection API。

该 fact 声明 `relevance: { tools: ['web_search'] }`，因此仅当 `web_search` 工具对**当前 assembly 的同一个 scope**可见时才投影进 runtime-context snapshot；可见性由 runtime-facts 注册表集中通过 `ctx.tools.get(name, scope)` 求值。settings 偏好或 provider registry 拓扑发生变化时，因为 fact 是 `dynamic`，下一次 assembly 会直接反映新的 effective provider，无需重新注册。

这里对 runtime-facts 的依赖是**可选 peer/type dependency**：`web` 生成的运行时代码不会 import runtime-facts 的值；实际生命周期只由 `ctx.inject(['runtimeFacts'], ...)` 接线。因此 runtimeFacts 未出现时 web seam 完整工作；service unload 时 fact 被撤回但 web 不受影响；service 再次出现时 fact 自动重新注册。投影层不发明 readiness 或 fallback 状态；真正的执行失败仍由 `search()` 的 `WebError` code 负责。

## 词汇

`WebSearchRequest`（`query`、`maxResults?`）→ `WebSearchResult`（`content?`、`sources[]`、`truncated`）；每个 `WebSearchSource` 都有必填 `url` 与可选 `title`／`snippet`／`publishedAt`（Perplexity 引用可能只含 URL）。`WebFetchRequest`（`url`）→ `WebFetchResult`（最终 `url`、`statusCode`、`body`、`truncated`）；取消作为可选的直接 `AbortSignal` 参数传给 `search()`／`fetch()`。`WebFetchBody` 是这里拥有的封闭判别联合（`html` | `text`）；消费方使用 `switch` 实现穷尽检查，因此新增类型会导致编译失败，直到处理完毕。完整约定见 `src/types.ts`，其中也包含 `WebError` code 分类体系。

## 模型体验

`dsh-tool-web` 继续拥有 `web_search`／`web_fetch` 的工具 schema、描述、提示、调用与结果。除此之外，当 runtime-facts 挂载时，本 seam 只会在当前 assembly scope 确实可见 `web_search` 的情况下贡献动态 `web.search-selected` runtime-context 行。模型因此能看到**当前真正生效的搜索提供方身份**，但不会看到 provider readiness、credential value 或 Web 内部实现细节；若无法明确选择提供方，则该 fact 不投影，而不是猜测。

#### KV Cache 影响

`web.search-selected` 属于动态 runtime-context snapshot，而不是稳定 system prompt。effective provider 不变时，其 context 文本保持不变；settings 或 provider 拓扑变化导致 effective selected id 改变时，下一次 assembly 的该段上下文随之变化。本实现没有新增 agent-loop 或第二套 prompt 机制。

## 已知限制与暂缓事项

- **没有观测接口**：没有提供方变更事件或能力状态查询；可用性只能通过执行 `search()`／`fetch()` 并按抛出的 `WebError` code 路由来观测，无提供方失败是通用的 `WEB_PROVIDER_UNAVAILABLE`，不会枚举逐提供方原因（见 [Agent Note](../../../.agents/notes/archived/simplification/2026-07-04-drop-unconsumed-web-observation-surface.md)）。
- **`WebSearchRequest` 只携带 `query` + `maxResults`**：提供方无关的控制项（新近程度、域名过滤条件、区域提示、搜索深度）暂缓至 Exa 与 Perplexity 都能诚实支持时（见 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md)）。
- **`WebFetchBody` 没有 `pdf` 分支**：可提取文本的 PDF 支持属于明确的暂缓工作；封闭联合会使新增该分支成为三个 web 包中由编译强制执行的变更。
- **提供方支持的页面提取不属于 `fetch()` 范围**：Firecrawl/Tavily 风格的 `web_extract` 能力暂缓，而不会扩展抓取操作。
