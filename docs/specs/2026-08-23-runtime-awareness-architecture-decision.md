# Runtime Awareness + User Preference Plane — Architecture Decision（R3）

> 前置：`repository-facts.md`（现状盘点，全部判断带证据）。本文件只做决策，不再重复举证；个别关键证据会内联缩写。版本：R3（2026-08-23，R2 基础上按 R3 收口 findings 修订，见 `R3-CHANGELOG.md`）。状态：待架构评审（本轮不落实现代码）。

## 0. Blocking Questions 结论（先读这里）

| # | 问题 | 结论 |
|---|---|---|
| B1 | settings.yaml 是否已足以作为唯一 user preference file？ | **是**（R1 结论保留）。settings seam 的 litmus test（"personal config page 应编辑它吗"）已把 user-editable subset 定义为 namespace 内容，precedence 已定（settings 在 composition 之上）。缺的不是新文件，而是"默认 search provider"等字段尚未通过 namespace 接入。 |
| B2 | 默认 search provider 的 authoritative owner 应是谁？ | **`ctx.web`（`WebRuntime`，`packages/web/web`）**（R1 结论保留）。它是 selection 语义的既有 owner（执行时 resolve + `WebError` 码）。由它注册 `web` settings namespace，composition entry 作 base。provider 与 tool-web 都不得另设选择源。 |
| B3 | Search API secret 应由哪里拥有？ | **`ctx.credentials`**（R1 结论保留）。settings 只存 `apiKeyEnv`（CredentialRef 名字），值在 `$DSH_HOME/.credentials.yaml`。仓库纪律（configuration-source-ownership / request-level-llm-config-credentials），llm-deepseek 与 web-search-deepseek 已是正例；web-search-exa / perplexity 迁移到该模式。 |
| B4 | Profile config 与 user settings 的 precedence 到底是什么？ | 已定死（R1 结论保留）：**`explicit > user settings(settings.yaml) > composition(profile/bundles/--patch) > shell env > .env > defaults`**。settings 在 composition 之上。本方案不改任何一行。 |
| B5 | Settings 热更新后从哪一次调用开始生效？ | **下一次操作**（R1 结论保留）：settings watch 热发布 → domain owner 的 source thunk 变化 → 下一次 `search`/`fetch` 的 resolve 用新值。无需重启、无需重注册 tool、不改 tool schema。正在执行中的调用保持旧 snapshot。 |
| B6 | Effective provider 是否应该自动告诉 Agent？ | **应该，但自动投影只含 `selected`**（R3 修订）。`web.search-selected` 是 `WebRuntime` 自己算的 sync 派生值（`resolveProvider` 结果），每次求值反映最新 preference，是唯一进自动 context 的 provider 状态。`credential-configured` / provider `local-availability` 经 `runtime_inspect` 按需查询；`operable` 不在 V1（`WebSearchProvider` 无统一 credential/readiness interface，`WebRuntime` 无法泛化计算 provider-specific credential state，统一 readiness protocol 推迟 V2）。不用 "ready"。 |
| B7 | 哪些 runtime facts 应 always-on？ | 少量高价值、cheap baseline（R1 结论保留，R3 更新清单）：OS / arch / execution world（已有 `sandbox:policy`、`DSH_*` shell 事实照旧）；capability-visible 命中时再加 `web.search-selected`。host PID / web port / proxy / network / provider 状态属 inspect。 |
| B8 | Tool visibility 是否应该驱动 runtime fact projection？ | **是**（R2 结论保留 authority）：capability visibility 唯一 authority = **`ctx.tools`**（`get(name, scope)` / `schemas(scope)` / `view(scope)`，`packages/core/tools/src/index.ts:1152-1236`）。R3 收敛为**声明式 `relevance: { tools: [...] }`**：fact 只声明它依赖哪些 capability，可见性求值统一由 `RuntimeFacts` 集中经 `ctx.tools` 完成，fact owner 不写任何可见性代码（不复制 visibility resolver，不从 systemPrompt 内部反查工具名）。prompt assembly owner = `ctx.systemPrompt`。 |
| B9 | Mode/Preset 在 projection 中拥有多大权力？ | **只影响 relevance，不改变事实值**（R1 结论保留）。Preset 经 agent scope 影响 tool/capability 集合，进而经 `ctx.tools` 改变 capability-visible projection；任何 mode/preset 不得改写 fact 的客观值（ONE FACT ONE OWNER）。 |
| B10 | 是否真的需要新增 ctx.runtime，还是扩展现有 runtime-context contributor 足够？ | 新增**轻量 registry（`ctx.runtimeFacts`）**，投影走现有 extension point（R3 修订）：**注册普通 sync context contributor `ctx.systemPrompt.context({ name: 'runtime-facts', order: 120, text })`**（`system-prompt/src/index.ts:398`，order 升序 join；sandbox `sandbox:policy` 用 order=110，`packages/sandbox/sandbox-policy/src/index.ts:113-115`）。**不改 Agent Loop、不新建注入路径**；`RuntimeContextProjection` 不变。R2 的 `system-prompt/assemble` async waterfall 方案**放弃**（V1 不需要 async projection，见 B13/R3-4）。 |
| B11 | V1 最小实现边界 | (a) `ctx.runtimeFacts` registry（三正交维度 declaration / 声明式 relevance / inspect）+ host facts 包；(b) `runtime_inspect` tool（tagged union：facts / command）；(c) `web` settings namespace + `WebRuntime` live resolve；(d) web-search-exa/perplexity 迁移 apiKeyEnv→credentials；(e) 自动 projection 仅含 `runtime.execution-world` 与 relevance 命中的 `web.search-selected`，`host.os`/`host.arch` 仅 inspect；(f) `SubprocessRuntime.executionWorld` 最小 seam 字段（R3.1-B1）。不引入通用 fallback、不做 Doctor、不做 operable、不做 host.shell、不注册 `web-search.<id>.registered`。 |
| B12 | 哪些内容明确推迟到 V2 | 通用 provider fallback（preference ordering × availability × transient failure）、OS keychain credential provider、runtime fact 进程外查询面（SDK/ACP）、Docker/GPU/MCP/浏览器 fact 类型、per-fact 自动过期 TTL、settings value indirection、`reachable`（网络探针）进 projection（V1 仅 inspect）、**`web.search-operable` 与统一 provider readiness protocol**、provider credential fact 契约公开化、async projection 机制（如需）。 |
| B13 | Runtime Fact projection 是否需要 async？ | **V1 不需要**（R3 修订，反向于 R2-B1）。自动投影只有 sync dynamic 的 `runtime.execution-world` 与 `web.search-selected`，`ctx.systemPrompt.context` 的 `text` 是每 assembly 求值的 sync 函数，天然满足 B5 热 reload。async facts（`web-search.<id>.credential-configured`、`net.reachable`）**不进自动 context**，只在 `runtime_inspect` 查询时求值（`inspect` 是 async 方法，可 await `credentials.describe` / probe）。credential-configured / reachable 不在每次 preStep 自动 probe。 |
| B14 | "ready" 在 DSH 中的正式定义是什么？ | **无正式定义，R2 起不引入该术语**（R2 结论保留）。仓库现状：`WebSearchProvider.available()` 是 cheap local sync 检查（`packages/web/web/src/types.ts:105`），web-search-deepseek 的 `available()` 只证明存在 credential resolver、不证明 credential 存在（`packages/web/web-search-deepseek/src/provider.ts:189-191`，缺失在 `search()` 才 `WEB_PROVIDER_CREDENTIAL_MISSING`，:298）。用状态词表（§2）替代 ready：`registered` / `locally-available` / `selected` / `credential-configured` / `reachable` / `operable`。 |
| B15 | capability visibility 的唯一 authority 是谁？ | **`ctx.tools`**（R2 结论保留）。`ToolRuntime.get(name, scope)` / `schemas(scope)` / `restrict` / `view(scope)` 是可见工具集合的唯一来源（含 inherited + scoped own + restrictions + reserved transport）。`ctx.systemPrompt` 是 prompt assembly 的 owner，不是 visibility resolver。R3 收敛：可见性求值收进 `RuntimeFacts` 一处（声明式 relevance），不复制 visibility logic。 |
| B16 | parameterized inspection 是否属于 Fact Registry？ | **部分属于**（R2 结论保留）。parameterized inspector（如 command resolution）是 registry 的 inspect 能力，但**不是 fact key**（禁止为每个 command 预注册 fact）。`runtime_inspect` 用 tagged union `{kind:"facts"} | {kind:"command"}`；command 走 `ctx.subprocess.resolveExecutable`（`packages/subprocess/subprocess/src/index.ts:107-122`）。 |

---

## 1. 问题定义

**P1 — Agent Runtime Awareness 不足。** Agent 对自身宿主/运行环境缺乏结构化认知：OS/arch/execution world、实际 shell/runtime、command 权威解析结果、系统代理/网络 route、DSH 自身 PID/端口、capability 真实运行状态，均无统一、有 owner、可查询的事实来源（`repository-facts.md §7.4`：`host.describe` 无 pid/port；`cordis_inspect` 只覆盖 cordis 契约）。Agent 只能经 `$DSH_*` shell 变量或 shell 考古间接获取，容易猜测并产生错误诊断。

**P2 — User Preference / Settings 使用不足。** 用户需要持久表达长期能力偏好（默认搜索 provider、搜索 fallback、默认浏览器、模型/provider 偏好等），且 Agent 应知道"当前真正生效的结果"。仓库已有完整 settings substrate（`ctx.settings` + `installSettingsSection` + `settings-file` + UI + wire），但：(a) 默认 search provider 仍是 composition 字段 `WebRuntimeConfig.searchProvider`；(b) exa/perplexity 的 key 绕过 credentials seam；(c) effective state 不投影给 Agent；(d) 无 fallback 语义。

**约束（不得违反的已定死仓库底线）**：precedence 单一顺序；secret 只留 reference；动态事实只走尾部 cache-safe snapshot 投影（DeepSeek 完整前缀 KV-cache，改 system section 会打爆缓存）；everything-is-a-plugin；ONE FACT ONE OWNER；**投影走现有 extension point（`systemPrompt.context` / `RuntimeContextProjection`），不新建注入路径**。

---

## 2. Ownership Matrix（ONE FACT → ONE OWNER，R3 闭合版）

> Current = 现状；Proposed = 本方案落点。Persistence 栏 `–` 表示派生/运行期值（不持久，由 owner 计算）。fact key 统一小写 kebab（每段 `^[a-z][a-z0-9-]*$`，段以 `.` 分隔）。**三正交维度（R3，取代 R2 的 observation+cost）**：`evaluation`（sync/async，怎么求值）、`freshness`（static/dynamic，值会不会变）、`exposure`（baseline/inspect，进不进自动 context）。**状态词（B14，取代 ready）**：`registered`（已注册到 ctx.web）/ `locally-available`（provider.available()）/ `selected`（WebRuntime.resolveProvider 选中）/ `credential-configured`（credentials.describe(ref).configured）/ `reachable`（网络探针，inspect-only）/ `operable`（V2，统一 readiness protocol 后）。

| Fact / Preference | Authoritative Owner | Persistence | Runtime Resolver | Model Visibility | Secret? | Current State | Proposed State |
|---|---|---|---|---|---|---|---|
| default search provider | `ctx.web` (`WebRuntime`) | settings `web` ns user layer (+ composition base) | `WebRuntime` 每次 search/fetch resolve | capability-visible（`web_search` 可见时） | 否 | `WebRuntimeConfig.searchProvider`（composition） | settings ns + live resolve |
| search fallback providers | `ctx.web` | settings `web` ns | `WebRuntime` selection | capability-visible | 否 | 无（无 fallback） | V1：不引入自动 fallback；V2：显式 ordering 列表 |
| search endpoint | 各 provider 包 | provider 自有 settings ns / config | provider 每次调用 | 一般不投影 | 否 | exa/pplx config；web-search-deepseek settings | 保留各自 namespace，统一 apiKeyEnv |
| search API credential（值） | `ctx.credentials` (`credentials-local`) | `$DSH_HOME/.credentials.yaml` | `credentials.resolve(ref)` 每操作 | **E：永不进模型** | **是** | exa/pplx config+env；web-search-deepseek apiKeyEnv | exa/pplx 迁移 apiKeyEnv |
| `web.search-selected` | `web` 包（`WebRuntime` selection） | –（派生） | `resolveProvider()` 结果 | capability-visible（`relevance: web_search`） | 否 | 无 | registry fact（sync / **dynamic** / baseline，relevance 命中时自动投影） |
| `web-search.exa.local-available` | `web-search-exa` 包（provider 自判） | –（派生） | `provider.available()` | **D：仅 inspect** | 否 | 无 | registry fact（sync / dynamic / inspect） |
| `web-search.exa.credential-configured` | `web-search-exa` 包（provider 知道自身 `apiKeyEnv` ref） | –（派生） | `credentials.describe(ref).configured`（async） | **D：仅 inspect** | 否 | 无 | registry fact（**async** / dynamic / inspect） |
| `net.reachable` | `runtime-facts-host`（probe） | – | inspect 时 probe | **D：仅 inspect** | 否 | 无 | inspect fact（async / dynamic / inspect；V1 可选，默认不内置） |
| `host.os` / `host.arch` | `runtime-facts-host` | –（静态） | `process.platform` / `process.arch` | **D：仅 inspect** | 否 | 无结构化来源 | registry fact（sync / static / inspect） |
| `runtime.execution-world` | `runtime-facts-host`（owner 委托 `SubprocessRuntime.executionWorld`） | –（派生） | **`ctx.subprocess.executionWorld`（local/remote，seam 权威字段）** | always-on baseline | 否 | 隐式 | registry fact（sync / **dynamic** / baseline；R3.1-B1 补 seam 自述） |
| `host.pid` | `runtime-facts-host` | –（静态） | `process.pid` | **D：仅 inspect** | 否 | 分散使用 | registry fact（sync / static / inspect） |
| `host.proxy.configured` | `runtime-facts-host`（委托 launch-environment） | –（启动快照） | 环境事实 → sanitize | **D：仅 inspect** | **潜在（URL 可含凭据）→ sanitize** | proxy 变量在 `scrubbedParentEnv` 保留 | registry fact（sync / static / inspect，**永不 raw URL**） |
| `host.proxy.scheme` | `runtime-facts-host`（委托 launch-environment） | –（启动快照） | sanitize 结果 | **D：仅 inspect** | 否 | 同上 | registry fact（sync / static / inspect） |
| `host.proxy.host` | `runtime-facts-host`（委托 launch-environment） | –（启动快照） | sanitize 结果 | **D：仅 inspect** | 否 | 同上 | registry fact（sync / static / inspect） |
| `host.proxy.port` | `runtime-facts-host`（委托 launch-environment） | –（启动快照） | sanitize 结果 | **D：仅 inspect** | 否 | 同上 | registry fact（sync / static / inspect） |
| `host.proxy.source` | `runtime-facts-host`（委托 launch-environment） | –（启动快照） | sanitize 结果 | **D：仅 inspect** | 否 | 同上 | registry fact（sync / static / inspect） |
| `web.server-url` | `runtime-facts-host`（owner 委托 `ctx.webServer.port`） | cordis.yml + CLI | `webServer.port` | **D：仅 inspect** | 否 | `webServer.get port` | registry fact（sync / **dynamic** / inspect，owner 委托 webServer；port 由异步 `init()` 赋值，不得注册时缓存） |
| workspace / session cwd | `SessionHeader`（session 包） | session header | `session.header.cwd` | `sandbox:policy` 已含 workspaceRoot | 否 | 已存在 | **复用，不重复注册** |
| command resolution | `ctx.subprocess`（subprocess-local） | – | `resolveExecutable` | **D：仅 inspect（runtime_inspect kind=command）** | 否 | 已存在 | **复用，不重复注册；不预注册 per-command fact** |
| sandbox mode / root | `ctx.sandboxPolicy` | session event fold + config | `sandboxPolicy.resolve({session})` | always-on（已有 `sandbox:policy`） | 否 | 已存在 | **复用，不重复注册** |

**强制规则**（R1 保留）：同一值不得同时在 `.env`、`settings.yaml`、`cordis.patch.yml`、tool config、prompt 各自维护一份而无明确 owner。上表每个 Fact/Preference 恰好一行 owner。凡现状在多个位置出现（如 provider 选择：config + env 两处），收敛到唯一 owner + 明确 precedence（config 作 base、env 作同一字段的启动覆盖，`packages/web/web/src/index.ts:76-93`）。

**R3-B5 闭合**：provider 专属状态（`local-available`、`credential-configured`）owner 是 **各 provider 包**（R2-B5 不变），V1 全部 `exposure='inspect'`（不自动投影）；selection 的 owner 是 **`web` 包（WebRuntime）**，且 `web.search-selected` 是唯一自动投影的 provider 状态（`exposure='baseline'` + `relevance: web_search`）。`web-search.<id>.registered` **不在 V1**（R3.1-B4）：`WebSearchProvider.id: string` 不保证 kebab segment grammar，动态生成 `web-search.${id}.registered` 与 FactKey 冲突；已注册 provider 清单留给 parameterized inspection（`runtime_inspect kind=web-provider`，V2）。`web.search-operable` 不在 V1：无统一 credential/readiness interface，operability 只有实际 operation 最权威（B6/B12）。`host.shell` **不在 V1**（R3.1-B1）：`ShellExecutor` 无 dialect/shellName 自述，且模型已通过可见 Tool（`bash`/`pwsh`）知道自己有哪种 shell，不为一个 inspect fact 修改 shell seam（V2）。

**R3.1-B1 — execution-world 的唯一 authority = `SubprocessRuntime.executionWorld`**：`SubprocessRuntime` seam 补最小自述字段 `abstract readonly executionWorld: ExecutionWorldKind`（`'local' | 'remote'`；`LocalSubprocessRuntime = 'local'`，`E2BSubprocessRuntime = 'remote'`），禁止 RuntimeFacts 用 `instanceof` / `process.platform` / plugin name 猜。`runtime.execution-world` 读该字段；`runtime_inspect kind=command` 的 `world` 也来自同一字段。扩展 `describeExecutionWorld()`（remote backend/platform/arch）V2 不做。

**R3.1-B2 — freshness 默认规则**：凡值来自另一个**可热加载 Service Provider** 的 fact，一律 `freshness='dynamic'`（不得注册时缓存）——`web.server-url`（WebServer.port 异步 init 赋值）、`runtime.execution-world`（subprocess 可热换）、`web.search-selected`（settings 热改）。V1 真正的 `static` 只有进程常量/启动快照：`host.os` / `host.arch` / `host.pid` / `host.proxy.*`（launch-environment 快照）。

---

## 3. 发散：User Preference 方案比较

（R1 结论保留，未受 findings 推翻。）仓库事实：settings seam 已存在（namespace/schema/base/user/watch/redact/UI/wire），已有 4 个 capability 用 `installSettingsSection` 消费。方案 A/B/C/D 比较见 R1 版（本文件 §3 历史）。**收敛：方案 C（分布式声明、领域 owner 求值、统一 settings substrate）**——settings 只管"存/解析/热发布/redact"；credentials 只管"值"（settings 只留 reference）；domain owner（`WebRuntime`）在操作边界把 preference → effective state。B/C/D 拒绝理由不变（中央模块/双源/precedence 冲突）。

---

## 4. Runtime Fact / Context Projection 决策（P1 的收敛，R3：sync baseline + async inspect）

**B10/B13 的展开**。仓库现状：`systemPrompt.context()` 贡献者（sync `text` 函数，`system-prompt/src/index.ts:77-85,398`）+ `RuntimeContextProjection`（dedupe/replay/清除）已存在；sandbox-policy 用无条件 sync context 贡献（order=110，`packages/sandbox/sandbox-policy/src/index.ts:113-115`）。P1 需要：(1) fact 唯一 home/跨插件冲突检测；(2) 三正交维度分类（evaluation / freshness / exposure）；(3) 声明式 relevance 编排（经 `ctx.tools` 判定可见性）；(4) inspect 查询（含 parameterized inspector）。

**三正交维度（R3-1）**：`evaluation`（sync/async）与 `freshness`（static/dynamic）是正交的——"sync fact 注册时缓存一次"会冻结 `web.search-selected`（sync 但 dynamic），违反 B5 settings 热 reload。因此：

- `evaluation: 'sync' | 'async'` — 怎么求值（本地同步可得 / 需要 await）。
- `freshness: 'static' | 'dynamic'` — 值会不会变。`static` 可缓存一次；`dynamic` 每次求值重新 resolve，**不得缓存**。
- `exposure: 'baseline' | 'inspect'` — 进不进自动 runtime context / 仅按需查询。

**V1 投影机制（R3-4）**：`ctx.runtimeFacts` registry 注册一个普通 **sync context contributor**（`systemPrompt.context`），不是 async waterfall 监听器：

```ts ignore-check
// runtimeFacts 构造内（scope 过滤经 text 收到的 AssembleContext.scope）
ctx.systemPrompt.context({
  name: 'runtime-facts',
  order: 120,   // sandbox:policy=110 之后；context 按 order 升序 join，天然有序（R3-6）
  text: (ac) => this.render({ scope: ac.scope }),
})
```

- **自动投影只含 `evaluation='sync'` 且 `exposure='baseline'` 的 fact**。`host.os` / `host.arch`（static）+ `runtime.execution-world` / `web.search-selected`（dynamic，relevance 命中时）。
- **async facts 不进自动 context**（R3-4/B13）：`credential-configured` / `reachable` 只在 `runtime_inspect` 查询时求值（`inspect` 是 async 方法，可 await `credentials.describe` / probe）。不在每次 preStep 自动 probe。
- **不改 Agent Loop、不新建注入路径**：`RuntimeContextProjection` 在 assemble 之后照常消费渲染文本；replay / snapshot dedupe / model-visible⟺logged 语义不变（`packages/core/agent-loop/src/runtime-context.ts`）。
- **B5 热 reload 天然满足**：`text` 是每 assembly 求值的函数，`web.search-selected` 每次求值读 `resolveProvider()` 最新结果；settings 热改后下一次 assembly 的 snapshot 变化 → `RuntimeContextProjection` 注入新 snapshot。

**relevance（R3-3，B8/B15）**：fact 声明式表达 `relevance?: { tools: readonly string[] }`（它依赖哪些 capability），缺省 = 无条件投影（baseline always-on）。可见性求值**统一收进 `RuntimeFacts`**（`ctx.get('tools').get(toolName, scope) !== undefined`），fact owner 不写任何可见性代码。scope 不可判定（非 agent 上下文）且声明了 relevance → 保守不投影。preset/mode 只经 scope 影响 `ctx.tools` 结果，不改事实值（B9）。

**为什么不进 `ctx.shellEnv`**（R1 保留）：shell-env 面向"每次 shell 调用的 `DSH_*` env 快照"，产物（env 映射）与消费方（context 投影 + inspect）不同契约；合一个 registry 会让 shell-env 承担两套职责。**共享结构、分开注册表**。

**V2 备选（记录约束，R3-6）**：若未来需要 async 事实进自动 context，**waterfall append 无法实现 order=120**（追加到 `assembly.contexts` 尾部，破坏既有顺序）。必须注册 order=120 的 **ordered placeholder**（空 text 的 context 项）后异步替换其 text。V1 不采用。

---

## 5. Prompt / Settings / Runtime Context / Tool 边界（决策表）

| 内容 | 应进入哪里 | 机制（owner） |
|---|---|---|
| 按需检查规则 | **Tool description**（仅工具可见时） | `runtime_inspect` definition |
| 用户长期偏好（默认搜索 provider 等） | **Settings**（namespace user layer） | `installSettingsSection` |
| 秘密凭据 | **Credentials**（`CredentialRef`，值在 store） | `ctx.credentials.resolve` 每操作 |
| 当前客观事实（OS/arch/execution world…） | **Runtime Facts**（registry，带 owner） | `ctx.runtimeFacts` |
| 当前有效状态（`web.search-selected`） | **Runtime Context**（尾部 cache-safe snapshot） | `systemPrompt.context(order=120)` + `RuntimeContextProjection` |
| 昂贵/长尾/async 诊断（provider 状态、网络 reachability、command 解析结果、sanitized proxy） | **runtime_inspect**（tool，按需查询） | `ctx.runtimeFacts.inspect`（async）+ tagged-union tool |
| 部署组成（bundle/patch/preset/profile） | **Profile / Bundle / Patch** | composition plane |

**"默认搜索 provider"拆解（R3，以仓库已有 provider exa 为例；Tavily 仅 third-party 扩展示例，V1 不实现）**：

- **settings**：`web.searchProvider: 'exa'`（用户偏好）。
- **credentials**：`EXA_API_KEY`（`apiKeyEnv` 引用，值在 `.credentials.yaml`）。
- **runtime facts（自动）**：`web.search-selected: 'exa'`（relevance 命中 `web_search` 时投影）。
- **runtime facts（inspect）**：`web-search.exa.local-available`、`web-search.exa.credential-configured`（async）。
- **runtime context**：`Search: selected=exa`（capability-visible；不叫 ready）。
- **prompt**：搜索行为规则（用 `web_search` 工具；provider 由 harness 决定，不猜、不查 settings.yaml）。

---

## 5.1 内容进入模型的五级分类（A/B/C/D/E，R3 更新）

| 级 | 定义 | 内容 | 机制 |
|---|---|---|---|
| **A 永远自动进入 Runtime Context** | 少量高价值、cheap、静态的基线 | OS、arch、execution world、sandbox policy（已有 `sandbox:policy`）、`DSH_*` shell 事实（已有） | baseline cost fact 恒投影；sync 求值 |
| **B capability-visible 时进入** | 事实只在对应 capability/tool 可见时投影 | `web.search-selected` | fact `relevance: {tools}` + `RuntimeFacts` 经 `ctx.tools` 集中判定可见性；B8/B15 |
| **C mode/preset relevant 时进入** | 由 mode/preset 过滤 relevance（不改事实值） | V1 无具体实例；机制保留 | scope 链 + preset 影响 tool 集合 → 经 `ctx.tools` 生效；B9 |
| **D 只能 runtime_inspect 查询** | 昂贵/长尾/低使用率/async，不进常驻 context | `host.pid`、`web.server-url`、`host.proxy.*`（5 个 sanitized）、`web-search.<id>.local-available` / `credential-configured`、`net.reachable`、command resolution 结果 | inspect cost fact；`runtime_inspect` tagged union（async 求值） |
| **E 永远不能进入模型** | secret 或机密配置全文 | credential 值、完整 settings.yaml、`apiKey` 字面量值、`.credentials.yaml` 内容、proxy URL 的凭据段 | `role('secret')` redact + 事实契约禁止 secret 值 + proxy sanitize；B3/B6 |

**"默认搜索 exa"映射到五级**：settings 的 `web.searchProvider` 不进模型（属用户偏好）；`EXA_API_KEY` 值属 E；`web.search-selected` 属 B；`web-search.exa.local-available` / `credential-configured` 与 `runtime_inspect` 可查的 provider 详情、command 解析属 D。

---

## 6. Consequences

- **正面**（R1/R2 保留）：Agent 不再猜宿主事实（baseline + inspect 双通道）；用户偏好有唯一持久位置且 live 生效；有效状态（`selected`）可被 Agent 感知；第三方插件可贡献 settings namespace 与 runtime facts 而无中央枚举；全部复用既有机制（settings/credentials/systemPrompt.context/RuntimeContextProjection）。
- **R3 收敛的代价**：
  1. 自动 context 从 R2 的 async assembly projection 降级为 sync baseline：`credential-configured` / provider `local-availability` 不再常驻模型上下文，Agent 需要时经 `runtime_inspect` 查询（多一次工具调用，但避免每步 preStep 的 async probe 延迟与 KV-cache snapshot 尾部漂移）。
  2. `web.search-operable` 从 V1 删除：模型看到的 provider 状态只剩 `selected`；"能不能用"交给实际 `search()` 的 `WebError`（`WEB_PROVIDER_CREDENTIAL_MISSING` / `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`），不在投影层预判。
  3. `host.proxy` 拆成 5 个 scalar fact（`configured`/`scheme`/`host`/`port`/`source`），`RuntimeFactValue` 保持 `string | boolean | number`，typecheck 可过。
  4. `projectWhen` 回调删除，改声明式 `relevance`：可见性求值收进 `RuntimeFacts` 一处，fact owner 零可见性代码。
  5. **R3.1-B1**：`SubprocessRuntime` seam 补 `executionWorld` 最小字段（`SubprocessRuntime` / `LocalSubprocessRuntime` / `E2BSubprocessRuntime` 三个包微改）；`host.shell` 与 `web-search.<id>.registered` 移出 V1。
  6. **R3.1-B3**：`web` / `web-search-exa` / `web-search-perplexity` 通过 `ctx.inject(['runtimeFacts'], cb)` optional 接线贡献 fact——`runtimeFacts` 缺席时 Web 完整工作，unload 时 disposer 撤回（与 `installSettingsSection` 同构）。
- **风险**：`web.search-selected` 是 dynamic fact，每次 assembly 求值 `resolveProvider()`——必须是 cheap 本地计算（selection 只查注册表 + preference，不网络）；实现时单测锁定。

---

## 7. Rejected Alternatives（及其理由，R3 更新）

| 方案 | 拒绝理由 |
|---|---|
| B：中央 preferences plugin | 违反 everything-is-a-plugin；中央模块知道所有 capability；第三方无法扩展；双源风险（§3-B）。 |
| D：以 Profile/patch 为主、settings 仅 UI | 与已定 precedence 冲突；用户偏好被混入部署组成；无 user 层热更新语义（§3-D）。 |
| 纯 systemPrompt.context() 贡献者，不建 registry | 缺 fact 唯一 home/冲突检测、分类、relevance 编排、inspect 查询；十几个 fact 各自写胶水会碎片化（B10）。 |
| **async waterfall 投影（R2 方案，R3 弃用）** | V1 不需要 async projection：`credential-configured`/`reachable` 改走 inspect（R3-4/R3-5）；其余全是 sync cheap facts。waterfall append 无法实现 order=120（追加到 contexts 尾部破坏顺序，R3-6）；每步 preStep 引入无上限延迟；operable 无统一 interface 支撑（R3-5）。V2 若需要，用 ordered placeholder 替换 text。 |
| 在 R2 的 `projectWhen` 回调里调 `ctx.get('tools')` | `RuntimeFactContext` 只有 `scope`/`signal`，没有 `get()`（断链）；每个 fact owner 复制可见性逻辑违反"不复制 visibility resolver"。改声明式 `relevance`，求值收进 `RuntimeFacts`（R3-3）。 |
| `host.proxy` 作为单一 object fact | `RuntimeFactValue` 只允许 scalar（string/boolean/number），object 值无法 typecheck；拆成 5 个 scalar（R3-2）。 |
| 扩展现有 ctx.shellEnv 承担全部 runtime facts | 产物（env 映射）与消费方（context 投影 + inspect）不同契约；一个 registry 扛两套会破坏 shell-env 的单职责（§4）。 |
| 新建 ctx.runtime 平行投影注入路径 | 违反"new behavior goes on documented extension points"；改动 agent-loop 需改 architecture.md；现有 `RuntimeContextProjection` 已承担注入/dedupe/replay（B10）。 |
| runtimeFacts 从 systemPrompt 内部反查"已收集工具名" | 复制 visibility resolver；`ctx.tools` 已是可见性唯一 authority（`get`/`schemas`/`view`），反查会双源且随 scope/restrict/preset 漂移（B15）。 |
| 把 command resolution 预注册为 per-command fact | command 空间无限，无法枚举；应为 parameterized inspector（`runtime_inspect kind=command` → `resolveExecutable`），不是 fact key（B16）。 |
| V1 就实现通用 provider fallback 引擎 | 仓库决策"绝不静默换 provider"是审慎的；fallback 的 ordering×availability×failure 三态语义需要真实使用证据支撑，V1 只做显式状态投影，V2 再做自动选择（B12）。 |
| V1 就实现 `web.search-operable` | `WebSearchProvider` 无统一 credential/readiness interface；`WebRuntime` 无法泛化计算 provider-specific credential state；third-party provider 不保证贡献 credential fact；operability 只有实际 operation 最权威。统一 readiness protocol 推迟 V2（B6/R3-5）。 |
| V1 实现 `host.shell` fact（R3.1-B1） | `ShellExecutor` seam 无 dialect/shellName 自述；为单个 inspect fact 改 shell seam 不值——模型已通过可见 Tool（`bash`/`pwsh`）知道自己有哪种 shell。推迟 V2（若出现 shell 切换/嵌套 shell 诊断的真实需求再补自述）。 |
| V1 注册 `web-search.<id>.registered` 动态 fact（R3.1-B4） | `WebSearchProvider.id: string` 不保证满足 FactKey kebab grammar；动态拼接 `web-search.${id}.registered` 会把第三方合法 id（`foo/v2`、`my.search`）变成 FactKey 冲突或需 escaping。已注册 provider 清单交给 parameterized inspection（`runtime_inspect kind=web-provider`，V2），不动态造 FactKey。 |
