# Runtime Awareness + User Preference Plane — Search Provider Vertical Slice（R2）

> 第一条完整 vertical slice：把"默认搜索 API/provider"从 composition 字段变成用户偏好 + 有效状态投影 + 按需诊断。决策依据：`architecture-decision.md`（B2/B3/B5/B6/B13/B14/B15）；实现细节：`implementation-spec.md` §3/§5/§7。R2 变更：主示例改用仓库已有 provider **exa**（Tavily 仅作 third-party 扩展示例，V1 不实现）；状态词取代 "ready"；projection 走 async assembly。

## 0. 目标状态（一图）

```text
用户编辑 $DSH_HOME/settings.yaml
        │  web.searchProvider: exa
        ▼
ctx.settings（settings seam：schema defaults → base(cordis.yml) → user layer）
        │  settings/updated 热发布 → WebRuntime.setSource 更新
        ▼
search owner = ctx.web（WebRuntime）：每次 search() 读 source() 得 preference
        ▼
provider selection = WebRuntime.resolveProvider()：preference × registered × locally-available → selected
        │  失败 → WebError（不自动 fallback）
        ▼
credential resolution = ctx.credentials.resolve(apiKeyEnv)（每 search 一次；key 在 .credentials.yaml）
        ▼
runtime state = registry facts：registered / local-available / credential-configured / search-selected / search-operable
        ▼
tool execution = tool-web 的 web_search → ctx.web.search()（无 provider 认知，只问查询）
        ▼
Agent runtime context = system-prompt/assemble（async waterfall）+ RuntimeContextProjection
        → "web.search-selected: exa; web.search-operable: true"（web_search 可见时投影）
```

## 1. 用户编辑什么

用户编辑 `$DSH_HOME/settings.yaml` 的 `web` section（唯一持久位置；R2-P4：用仓库已有 provider）：

```yaml
web:
  searchProvider: exa          # 默认搜索 provider（preference；exa/perplexity/deepseek）
  fetchProvider: http          # 默认 fetch provider
```

- namespace `web` 由 **`WebRuntime`（web 包）** 注册，schema 见 `implementation-spec.md §3.1`。字段沿用 `searchProvider`/`fetchProvider`（与 `WebRuntimeConfig` 一致）。
- **precedence**（B4）：schema 缺省 → composition `base`（cordis.yml 的 `searchProvider` + `$DSH_WEB_SEARCH_PROVIDER` 同一字段）→ user 层。
- 用户不需要编辑：`$DSH_WEB_SEARCH_PROVIDER`（操作级覆盖）、provider 的 API key（走 credentials）、`cordis.patch.yml`（部署层）。
- **Tavily 不在 V1**：V1 只支持仓库已有 provider（exa/perplexity/deepseek）。Tavily 可作为第三方插件示例演示"如何贡献新 provider + settings namespace + facts"，但本 slice 不实现它。

## 2. 谁注册这个 namespace（ONE OWNER）

**`ctx.web`（`packages/web/web` 的 `WebRuntime`）**。理由（R1 保留）：provider selection 语义（执行时 resolve + `WebError` 码）已是它的职责；它是"选择哪个 provider"的唯一 owner。**不是**：tool-web（consumer，只问查询）、各 provider（只管自身内部配置）、generic settings（不解释语义）。

接线（`installSettingsSection`，`implementation-spec.md §3.2`）：`WebRuntime` 构造时以 `{searchProvider, fetchProvider}` 为 entry（base），注册 `web` namespace，`setSource` 把内部 `source()` thunk 指向 `scope.get()`。settings 服务不存在时照常按 composition 运行（agent-default-model 同构，`packages/core/agent-default-model/src/index.ts:64-105`）。

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

- **禁止**：model / tool 直接解析 settings.yaml；tool-web 仍只调 `ctx.web.search()`。
- settings 读取一律经 `ctx.settings`（source thunk / scope.get），与仓库纪律一致。

## 4. Effective Search Provider（状态词，R2-B14）

| 状态 | 含义 | 观察 | 来源 | 位置 |
|---|---|---|---|---|
| **Preference** | 用户希望用谁 | sync | settings `web.searchProvider`（user 或 base） | `source()` |
| **registered** | provider 是否已注册到 ctx.web | sync | `WebRuntime` 注册表 | `web-search.exa.registered` |
| **locally-available** | 本地配置可解析（非网络） | sync | `provider.available()` | `web-search.exa.local-available` |
| **selected** | 当前实际选中谁 | sync | `WebRuntime.resolveProvider()` | `web.search-selected` |
| **credential-configured** | API key 引用是否有值 | **async** | `credentials.describe(ref).configured` | `web-search.exa.credential-configured` |
| **reachable** | 网络可达 | **async**（inspect-only） | 网络探针 | `net.reachable`（V1 仅 inspect） |
| **operable** | 具备执行前提（selected + credential-configured；**仅操作边界权威**） | async | 综合判定 | `web.search-operable` |

**不合并成一个字段、不用 "ready"（B14）**：`web.searchProvider` 只表达 preference；effective 由 selection 计算。选不出来时 effective = 错误码（`WEB_PROVIDER_CONFIGURED_UNAVAILABLE` 等），模型看到的是"operable: false + reason"，不是被改写的 preference。

**关键事实（R2-B1）**：`web-search-exa` 的 `available()` 只证明本地配置可解析（`apiKey` 非空或 `apiKeyEnv` 有引用），**不证明 credential 实际存在**；credential 缺失在 `search()` 才 `WEB_PROVIDER_CREDENTIAL_MISSING`（web-search-deepseek 先例，`packages/web/web-search-deepseek/src/provider.ts:189-191,283,298`）。因此投影的 `credential-configured` 是 **async** 观察（await `credentials.describe`），由 `system-prompt/assemble` async waterfall 求值。

## 5. Fallback 如何工作（V1 决策）

- **不引入自动 silent fallback**（仓库决策"绝不静默换 provider"，`repository-facts.md §5.3`；B12）。
- preference 指向的 provider 不可用 → `web.search-operable: false` + `unavailable: WEB_PROVIDER_CONFIGURED_UNAVAILABLE (exa)`，模型据错误码行动（配置/换 provider）。
- 未配置 preference 且恰好一个可用 → 自动选（现状语义保留）。
- 未配置且多个可用 → `WEB_PROVIDER_AMBIGUOUS`，模型明确被告知"配置一个"。
- **V2**：`web.searchFallbackProviders` 列表 + availability 过滤 + transient failure 重试策略——需要真实使用证据，V1 不做。

## 6. API Key 放哪里（B3）

- **`ctx.credentials`**。`settings.yaml` 只存 `apiKeyEnv`（reference 名字）：

```yaml
# 各 provider 自己的 settings section（迁移后）
web-search-exa:
  apiKeyEnv: EXA_API_KEY        # 非 secret：环境变量名
  baseURL: https://api.exa.ai
```

```yaml
# $DSH_HOME/.credentials.yaml —— secret 唯一持久位置
refs:
  EXA_API_KEY: sk-…
```

- 每次 `search` 经 `ctx.credentials.resolve(apiKeyEnv)`（每操作一次 = 热更新机制，`repository-facts.md §4.1`）。
- **迁移**：exa/perplexity 从 "config `apiKey` + `process.env` 直读" 迁移到 `apiKeyEnv` + settings namespace（web-search-deepseek 同构，`repository-facts.md §4.4`）。`apiKey` 保留 `role('secret')` 兼容（显式非空 wins）；`.env` 既有 `$EXA_API_KEY` 继续作为 credentials-local 环境层。
- **Runtime Context 永不暴露 secret**：只投影 `credential-configured`（async，派生自 `credentials.describe`），不投影值。

## 7. 热修改 settings.yaml 后发生什么（B5 全解）

场景：用户把 `web.searchProvider: exa` 改成 `deepseek`（保存文件）。

1. `settings-file` watcher 检测外部编辑 → 解析 → 热发布 `settings/updated (web, {searchProvider:'deepseek',…}, …, 'provider')`。
2. `WebRuntime` 的 `installSettingsSection` 接线：`source()` thunk 指向的 `scope.get()` 返回新值（live 语义）。
3. **下一次 `web_search`**：`search()` 读 `source().searchProvider = 'deepseek'` → `resolveProvider` 命中 deepseek（若 `registered` 且 `locally-available`）→ 执行。**立即生效，无需重启、无需重注册 tool、不改 tool schema**。
4. **正在执行中的调用**：本次调用的 provider 已 resolve（执行边界快照），外部编辑不打断（旧 snapshot 至本次结束）。
5. **Runtime Context 更新**：`web.search-selected` 渲染从 `exa` 变 `deepseek`（`credential-configured` 经 async waterfall 重新 describe）→ 下一次 assembly 的 snapshot 文本变化 → `RuntimeContextProjection` 注入新 snapshot（dedupe：未变则不注入）。Agent 在下一请求看到新 effective 状态。
6. 若 deepseek 未配置 → `web.search-operable: false` + `unavailable: WEB_PROVIDER_CONFIGURED_UNAVAILABLE (deepseek)`，模型据实处理，不猜。

**一致性边界**：一次 `search` 执行边界 resolve 一次 preference + credential；热改在边界之间生效。

## 8. Runtime State → Tool → Agent（链路验证）

- **runtime state**（registry facts，owner 闭合 B5）：`web-search.exa.registered`（web 包）、`web-search.exa.local-available`（web-search-exa 包）、`web-search.exa.credential-configured`（web-search-exa 包，async）、`web.search-selected`（web 包）、`web.search-operable`（web 包，async）。
- **tool execution**：`tool-web` 的 `web_search` 不感知 provider（只调 `ctx.web.search`，`packages/web/tool-web/src/search.ts:364-372`）——provider 交换不改变模型提问方式（`repository-facts.md §5.1`）。
- **Agent runtime context**（async assembly projection）：`system-prompt/assemble` waterfall 中 await credential describe → 渲染 → `RuntimeContextProjection` 注入。Agent 看到：

```text
Current runtime context. This snapshot supersedes earlier runtime-context snapshots.

Current DSH file policy: workspace-write. …
Host runtime facts:
- host.os: win32
- host.arch: x64
- runtime.execution-world: local
- web-search.exa.registered: true
- web-search.exa.local-available: true
- web-search.exa.credential-configured: true
- web.search-selected: exa
- web.search-operable: true
```

- Agent 从此**不猜**"用什么搜索、能不能用"——`web.search-selected`/`operable` 已在 context；要查"exa 配在哪 / command 解析到哪"走 `runtime_inspect`（`kind=facts` / `kind=command`）。

## 9. 验收标准

1. 用户改 `settings.yaml` 的 `web.searchProvider` → 下一次 `web_search` 用新 provider（live，无重启）。
2. 改后的 `web.search-selected` 出现在下一个 runtime-context snapshot（`credential-configured` 经 async describe）。
3. preference 指向未配置 provider → 模型看到 `operable: false` + `unavailable: <WebError code>`，不自动 fallback、不猜。
4. secret（API key）不进任何模型可见输出；`runtime_inspect` 只回 `credential-configured`，`kind=command` 只回 `resolved`/`world`。
5. 既有 `$DSH_WEB_SEARCH_PROVIDER` 与 cordis.yml `searchProvider` 继续工作（base 层语义不变）。
6. `runtime_inspect` 返回 baseline + requested；未知 key 标注 `unknown`；async probe 失败标注 `probe-failure`。
7. secret-leak 测试通过（输出不含 `user:pass@`、不含 apiKey 值、不含 proxy raw URL）。
8. 全部 `verify-*` 门、单测、e2e 绿；runtime-context snapshot 测试覆盖 replay 重建一致性。
