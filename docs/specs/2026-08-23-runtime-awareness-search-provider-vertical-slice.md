# Runtime Awareness + User Preference Plane — Search Provider Vertical Slice

> 第一条完整 vertical slice：把"默认搜索 API/provider"从 composition 字段变成用户偏好 + 有效状态投影 + 按需诊断。决策依据：`architecture-decision.md`（B2/B3/B5/B6）；实现细节：`implementation-spec.md` §3/§7。

## 0. 目标状态（一图）

```text
用户编辑 $DSH_HOME/settings.yaml
        │  web.searchProvider: tavily
        ▼
ctx.settings（settings seam：schema defaults → base(cordis.yml) → user layer）
        │  settings/updated 热发布 → WebRuntime.setSource 更新
        ▼
search owner = ctx.web（WebRuntime）：每次 search() 读 source() 得 preference
        ▼
provider selection = WebRuntime.resolveProvider()：preference × availability → effective
        │  失败 → WebError（WEB_PROVIDER_CONFIGURED_UNAVAILABLE 等，不自动 fallback）
        ▼
credential resolution = ctx.credentials.resolve(apiKeyEnv)（每 search 一次；key 在 .credentials.yaml）
        ▼
runtime state = 派生 fact：web-search.<id>.available / credentialConfigured / web.searchEffective
        ▼
tool execution = tool-web 的 web_search → ctx.web.search()（无 provider 认知，只问查询）
        ▼
Agent runtime context = systemPrompt.context('runtime-facts') + RuntimeContextProjection
        → "Search provider: Tavily (ready)"（web_search 可见时投影）
```

## 1. 用户编辑什么

用户编辑 `$DSH_HOME/settings.yaml` 的 `web` section（唯一持久位置）：

```yaml
web:
  searchProvider: tavily    # 默认搜索 provider（preference）
  fetchProvider: http       # 默认 fetch provider（preference）
```

- namespace `web` 由 **`WebRuntime`（web 包）** 注册，schema 见 `implementation-spec.md §3.1`。字段名沿用 `searchProvider`/`fetchProvider`（保持与 `WebRuntimeConfig` 一致，避免双词汇）。
- **precedence**（B4）：schema 缺省 → composition `base`（cordis.yml 的 `searchProvider` + `$DSH_WEB_SEARCH_PROVIDER` 同一字段）→ 用户 layer。用户显式写 `tavily` 即覆盖 base。
- 用户不需要、也不应该编辑：`$DSH_WEB_SEARCH_PROVIDER` 环境变量（操作级覆盖，保持现状语义）、provider 的 API key（走 credentials）、`cordis.patch.yml`（部署层，除非要钉死部署默认）。

## 2. 谁注册这个 namespace（ONE OWNER）

**`ctx.web`（`packages/web/web` 的 `WebRuntime`）**。理由：
- provider selection 语义（执行时 resolve + `WebError` 码）已是它的职责（`repository-facts.md §5.2`）。
- 它同时是"选择哪个 provider"这一事实的唯一 owner（Ownership Matrix 第一行）。
- **不是**：tool-web（consumer，只问查询，不读 settings）；各 provider（只管自身内部配置，如 endpoint/model——它们各自的 `web-search-<id>` namespace 在 §6 迁移中补齐）；generic settings（settings seam 不解释语义）。

接线（`installSettingsSection`，`implementation-spec.md §3.2`）：`WebRuntime` 构造时以 `{ searchProvider, fetchProvider }` 为 entry（base），注册 `web` namespace，`setSource` 把内部 `source()` thunk 指向 `scope.get()`。settings 服务不存在时照常按 composition 运行（与 agent-default-model 完全同构，`packages/core/agent-default-model/src/index.ts:64-105`）。

## 3. 谁读取它

**只有 `WebRuntime` 读**。`search()`/`fetch()` 每次调用：

```ts ignore-check
async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
  const section = this.source()          // ← live 读 effective preference
  const provider = resolveProvider({
    providers: this.searchProviders,
    ...section.searchProvider !== undefined ? { configuredId: section.searchProvider } : {},
  })
  return provider.search(request, signal)
}
```

- **禁止**：model / tool 直接解析 settings.yaml（"model/tool 自己解析"是不允许的）；tool-web 仍只调 `ctx.web.search()`。
- settings 读取一律经 `ctx.settings`（scope.get / source thunk），与仓库纪律一致（"Model-visible ⟺ logged"之下，配置读取也要有 owner）。

## 4. Effective Search Provider（三态分离）

| 态 | 含义 | 来源 | 位置 |
|---|---|---|---|
| **Preference** | 用户希望用谁 | settings `web.searchProvider`（user layer 或 base） | `source()` |
| **Reality** | 该 provider 是否已注册 + 可用 | `provider.available()`（本地检查）+ `credentials.describe(ref).configured` | `WebRuntime` + `credentials` |
| **Effective** | 当前实际选谁 | `WebRuntime.resolveProvider()` 结果 | 派生，不持久 |

**不合并成一个字段**：`web.searchProvider` 只表达 preference；effective 由 selection 计算。选不出来时 effective = 错误码（`WEB_PROVIDER_CONFIGURED_UNAVAILABLE` 等），模型看到的是"unavailable: 原因"，不是被改写后的 preference。

## 5. Fallback 如何工作（V1 决策）

- **不引入自动 silent fallback**（仓库既有决策"绝不静默换 provider"，`repository-facts.md §5.3`）。
- 三态分开后，fallback 只有在用户**显式声明 ordering**时才可能发生；V1 不提供该声明，所以：
  - 用户 preference 指向的 provider 不可用 → `web.searchEffective: unavailable: WEB_PROVIDER_CONFIGURED_UNAVAILABLE (tavily)`，模型据错误码行动（装/配置该 provider，或请用户换）。
  - 未配置 preference 且恰好一个可用 → 自动选（现状语义保留）。
  - 未配置且多个可用 → `WEB_PROVIDER_AMBIGUOUS`，模型明确被告知"配置一个"。
- **V2**（B12）：`web.searchFallbackProviders: [brave, browser]` 列表 + availability 过滤 + transient failure 重试策略——需要真实使用证据支撑，V1 不做。

## 6. API Key 放哪里（B3）

- **`ctx.credentials`**。`settings.yaml` 只存 `apiKeyEnv`（reference 名字）：

```yaml
# 各 provider 自己的 settings section（迁移后）
web-search-exa:
  apiKeyEnv: EXA_API_KEY        # 非 secret：这是环境变量名
  baseURL: https://api.exa.ai
web-search-perplexity:
  apiKeyEnv: PERPLEXITY_API_KEY
```

```yaml
# $DSH_HOME/.credentials.yaml —— secret 的唯一持久位置
refs:
  EXA_API_KEY: sk-…
  PERPLEXITY_API_KEY: sk-…
```

- 每次 `search` 经 `ctx.credentials.resolve(apiKeyEnv)`（每操作一次 = 热更新机制，`repository-facts.md §4.1`）。
- **迁移**：exa/perplexity 从"config `apiKey` + `process.env` 直读"迁移到 `apiKeyEnv` + settings namespace（与 web-search-deepseek 同构，`repository-facts.md §4.4`）。`apiKey` 保留为 `role('secret')` 兼容（显式非空 wins），`.env` 既有 `$EXA_API_KEY` 继续作为 credentials-local 的环境层。
- **Runtime Context 永不暴露 secret**：投影只回 `credentialConfigured: true/false`（派生自 `credentials.describe`）。

## 7. 热修改 settings.yaml 后发生什么（B5 全解）

场景：用户把 `web.searchProvider: exa` 改成 `tavily`（保存文件）。

1. `settings-file` watcher 检测外部编辑 → 解析 → 热发布 `settings/updated (web, {searchProvider:'tavily',…}, …, 'provider')`。
2. `WebRuntime` 的 `installSettingsSection` 接线：source thunk 指向的 `scope.get()` 返回新值；`onChange`（空实现）无需动作——因为**每次调用都重读 source**（live 语义，`implementation-spec.md §3.2`）。
3. **下一次 `web_search`**：`search()` 读 `source().searchProvider = 'tavily'` → `resolveProvider` 命中 tavily（若 `available()`）→ 执行。**立即生效，无需重启、无需重注册 tool、不改 tool schema、不改 system prompt。**
4. **正在执行中的调用**：本次调用的 provider 已 resolve（执行边界快照），外部编辑不打断它（旧 snapshot 至本次结束）。
5. **Runtime Context 更新**：`web.searchEffective` 的渲染从 `exa (ready)` 变 `tavily (ready)` → 下一次 assembly 的 snapshot 文本变化 → `RuntimeContextProjection` 注入新 snapshot（dedupe：未变则不注入）。Agent 在下一请求看到新 effective provider。
6. 若 tavily 未安装/未配置 → `web.searchEffective: unavailable: WEB_PROVIDER_CONFIGURED_UNAVAILABLE (tavily)` + `web-search.tavily.credentialConfigured: false`，模型据实处理，不猜。

**一致性边界**：一次 `search` 的执行边界 resolve 一次 preference + credential；热改在边界之间生效。

## 8. Runtime State → Tool → Agent（链路验证）

- **runtime state**：`web-search.tavily.available`、`web-search.tavily.credentialConfigured`（owner web 包，cost baseline，`projectWhen` = `web_search` 可见）；`web.searchEffective`（派生 effective）。
- **tool execution**：`tool-web` 的 `web_search` 不感知 provider（只调 `ctx.web.search`，`packages/web/tool-web/src/search.ts:364-372`）——provider 交换不改变模型提问方式（`repository-facts.md §5.1`）。
- **Agent runtime context**：`systemPrompt.context('runtime-facts')` 在 assembly 时渲染 → `RuntimeContextProjection` 注入。Agent 看到：

```text
Current runtime context. This snapshot supersedes earlier runtime-context snapshots.

Current DSH file policy: workspace-write. …
Host runtime facts:
- host.os: win32
- host.arch: x64
- web-search.tavily.available: true
- web-search.tavily.credentialConfigured: true
- web.searchEffective: Tavily (ready)
```

- Agent 从此**不猜**"用什么搜索"——effective 已在 context；要查"tavily 到底配在哪/为什么不可用"走 `runtime_inspect`（`web-search.tavily.credentialConfigured: false` 时）。

## 9. 验收标准

1. 用户改 `settings.yaml` 的 `web.searchProvider` → 下一次 `web_search` 用新 provider（live，无重启）。
2. 改后的 effective provider 出现在下一个 runtime-context snapshot（`web.searchEffective`）。
3. preference 指向未配置 provider → 模型看到 `unavailable: <WebError code>` 而非猜测；不自动 fallback。
4. secret（API key）不进任何模型可见输出；`runtime_inspect` 只回 `configured`。
5. 既有 `$DSH_WEB_SEARCH_PROVIDER` 与 cordis.yml `searchProvider` 继续工作（base 层语义不变）。
6. `runtime_inspect` 返回 baseline + requested facts；未知 key 标注 unknown 不报错。
7. 全部 `verify-*` 门、单测、e2e 绿；runtime-context snapshot 测试覆盖 replay 重建一致性。
