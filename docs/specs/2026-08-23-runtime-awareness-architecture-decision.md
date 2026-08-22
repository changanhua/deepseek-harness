# Runtime Awareness + User Preference Plane — Architecture Decision（R2）

> 前置：`repository-facts.md`（现状盘点，全部判断带证据）。本文件只做决策，不再重复举证；个别关键证据会内联缩写。版本：R2（2026-08-23，R1 基础上按 findings 修订，见 `R2-CHANGELOG.md`）。状态：待架构评审（本轮不落实现代码）。

## 0. Blocking Questions 结论（先读这里）

| # | 问题 | 结论 |
|---|---|---|
| B1 | settings.yaml 是否已足以作为唯一 user preference file？ | **是**（R1 结论保留）。settings seam 的 litmus test（"personal config page 应编辑它吗"）已把 user-editable subset 定义为 namespace 内容，precedence 已定（settings 在 composition 之上）。缺的不是新文件，而是"默认 search provider"等字段尚未通过 namespace 接入。 |
| B2 | 默认 search provider 的 authoritative owner 应是谁？ | **`ctx.web`（`WebRuntime`，`packages/web/web`）**（R1 结论保留）。它是 selection 语义的既有 owner（执行时 resolve + `WebError` 码）。由它注册 `web` settings namespace，composition entry 作 base。provider 与 tool-web 都不得另设选择源。 |
| B3 | Search API secret 应由哪里拥有？ | **`ctx.credentials`**（R1 结论保留）。settings 只存 `apiKeyEnv`（CredentialRef 名字），值在 `$DSH_HOME/.credentials.yaml`。仓库纪律（configuration-source-ownership / request-level-llm-config-credentials），llm-deepseek 与 web-search-deepseek 已是正例；web-search-exa / perplexity 迁移到该模式。 |
| B4 | Profile config 与 user settings 的 precedence 到底是什么？ | 已定死（R1 结论保留）：**`explicit > user settings(settings.yaml) > composition(profile/bundles/--patch) > shell env > .env > defaults`**。settings 在 composition 之上。本方案不改任何一行。 |
| B5 | Settings 热更新后从哪一次调用开始生效？ | **下一次操作**（R1 结论保留）：settings watch 热发布 → domain owner 的 source thunk 变化 → 下一次 `search`/`fetch` 的 resolve 用新值。无需重启、无需重注册 tool、不改 tool schema。正在执行中的调用保持旧 snapshot。 |
| B6 | Effective provider 是否应该自动告诉 Agent？ | **应该**，但**不再使用"ready"**（R2 修订）。只投影**当前可判定**的状态词（`selected` / `credential-configured` / `operable`），capability-visible（`web_search`/`web_fetch` 可见时）。"operable"仅在操作边界权威，投影值是"当前可判定为具备执行前提"。 |
| B7 | 哪些 runtime facts 应 always-on？ | 少量高价值、cheap baseline（R1 结论保留）：OS / arch / execution world、sandbox policy（已有 `sandbox:policy`）、session cwd / workspace root（已有）、`DSH_*` shell 事实（已有）。host PID / web port / network 属 inspect。 |
| B8 | Tool visibility 是否应该驱动 runtime fact projection？ | **是**（R2 修订 authority）：capability visibility 唯一 authority = **`ctx.tools`**（`get(name, scope)` / `schemas(scope)` / `view(scope)`，`packages/core/tools/src/index.ts:1152-1236`）。fact owner 经 `ctx.tools` 判定可见性；**不得从 systemPrompt 内部反查工具名、不得复制 visibility resolver**。prompt assembly owner = `ctx.systemPrompt`。 |
| B9 | Mode/Preset 在 projection 中拥有多大权力？ | **只影响 relevance，不改变事实值**（R1 结论保留）。Preset 经 agent scope 影响 tool/capability 集合，进而经 `ctx.tools` 改变 capability-visible projection；任何 mode/preset 不得改写 fact 的客观值（ONE FACT ONE OWNER）。 |
| B10 | 是否真的需要新增 ctx.runtime，还是扩展现有 runtime-context contributor 足够？ | 新增**轻量 registry（`ctx.runtimeFacts`）**，投影走现有 extension point（R2 修订）：**`system-prompt/assemble` async waterfall** 作为 projection consumer（`packages/core/system-prompt/src/index.ts:532-535` 返回权威 assembly；agent-loop `preStep` 已 `await assemble()`，`packages/core/agent-loop/src/agent.ts:230`）。**不改 Agent Loop、不新建注入路径**；`RuntimeContextProjection` 不变。 |
| B11 | V1 最小实现边界 | (a) `ctx.runtimeFacts` registry（declaration / observation kind / relevance / inspect）+ host facts 包；(b) `runtime_inspect` tool（tagged union：facts / command）；(c) `web` settings namespace + `WebRuntime` live resolve；(d) web-search-exa/perplexity 迁移 apiKeyEnv→credentials；(e) async assembly projection（`registered`/`locally-available`/`selected`/`credential-configured`/`operable` 中当前可判定的状态）。不引入通用 fallback、不做 Doctor。 |
| B12 | 哪些内容明确推迟到 V2 | 通用 provider fallback（preference ordering × availability × transient failure）、OS keychain credential provider、runtime fact 进程外查询面（SDK/ACP）、Docker/GPU/MCP/浏览器 fact 类型、per-fact 自动过期 TTL、settings value indirection、`reachable`（网络探针）自动进 projection（V1 仅 inspect）。 |
| B13 | Runtime Fact projection 是否需要 async？ | **需要（部分）**（R2 新增，对应 finding R2-B1）。`registered` / `locally-available` / `selected` 是 sync（本地注册表 + `available()`）；`credential-configured` / `reachable` 是 async（`credentials.describe` / 网络探针）。**采用 `system-prompt/assemble` async waterfall** 承载 projection，sync 与 async 事实在同一 assembly 内 resolve，await 后注入。不使用纯 sync `systemPrompt.context().text`（它无法 await credential describe）。 |
| B14 | "ready" 在 DSH 中的正式定义是什么？ | **无正式定义，R2 起不引入该术语**（R2 新增）。仓库现状：`WebSearchProvider.available()` 是 cheap local sync 检查（`packages/web/web/src/types.ts:105`），web-search-deepseek 的 `available()` 只证明存在 credential resolver、不证明 credential 存在（`packages/web/web-search-deepseek/src/provider.ts:189-191`，缺失在 `search()` 才 `WEB_PROVIDER_CREDENTIAL_MISSING`，:298）。用状态词表（§2）替代 ready：`registered` / `locally-available` / `selected` / `credential-configured` / `reachable` / `operable`。 |
| B15 | capability visibility 的唯一 authority 是谁？ | **`ctx.tools`**（R2 新增，对应 finding R2-B2）。`ToolRuntime.get(name, scope)` / `schemas(scope)` / `restrict` / `view(scope)` 是可见工具集合的唯一来源（含 inherited + scoped own + restrictions + reserved transport）。`ctx.systemPrompt` 是 prompt assembly 的 owner，不是 visibility resolver。 |
| B16 | parameterized inspection 是否属于 Fact Registry？ | **部分属于**（R2 新增，对应 finding R2-B3）。parameterized inspector（如 command resolution）是 registry 的 inspect 能力，但**不是 fact key**（禁止为每个 command 预注册 fact）。`runtime_inspect` 用 tagged union `{kind:"facts"} | {kind:"command"}`；command 走 `ctx.subprocess.resolveExecutable`（`packages/subprocess/subprocess/src/index.ts:107-122`）。 |

---

## 1. 问题定义

**P1 — Agent Runtime Awareness 不足。** Agent 对自身宿主/运行环境缺乏结构化认知：OS/arch/execution world、实际 shell/runtime、command 权威解析结果、系统代理/网络 route、DSH 自身 PID/端口、capability 真实运行状态，均无统一、有 owner、可查询的事实来源（`repository-facts.md §7.4`：`host.describe` 无 pid/port；`cordis_inspect` 只覆盖 cordis 契约）。Agent 只能经 `$DSH_*` shell 变量或 shell 考古间接获取，容易猜测并产生错误诊断。

**P2 — User Preference / Settings 使用不足。** 用户需要持久表达长期能力偏好（默认搜索 provider、搜索 fallback、默认浏览器、模型/provider 偏好等），且 Agent 应知道"当前真正生效的结果"。仓库已有完整 settings substrate（`ctx.settings` + `installSettingsSection` + `settings-file` + UI + wire），但：(a) 默认 search provider 仍是 composition 字段 `WebRuntimeConfig.searchProvider`；(b) exa/perplexity 的 key 绕过 credentials seam；(c) effective state 不投影给 Agent；(d) 无 fallback 语义。

**约束（不得违反的已定死仓库底线）**：precedence 单一顺序；secret 只留 reference；动态事实只走尾部 cache-safe snapshot 投影（DeepSeek 完整前缀 KV-cache，改 system section 会打爆缓存）；everything-is-a-plugin；ONE FACT ONE OWNER；**prompt assembly 是 async waterfall（`system-prompt/assemble`），不新建注入路径**。

---

## 2. Ownership Matrix（ONE FACT → ONE OWNER，R2 闭合版）

> Current = 现状；Proposed = 本方案落点。Persistence 栏 `–` 表示派生/运行期值（不持久，由 owner 计算）。fact key 统一小写 kebab（R2-B4：每段 `^[a-z][a-z0-9-]*$`，段以 `.` 分隔）。 **状态词（B14，取代 ready）**：`registered`（已注册到 ctx.web，sync）/ `locally-available`（provider.available()，sync）/ `selected`（WebRuntime.resolveProvider 选中，sync）/ `credential-configured`（credentials.describe(ref).configured，async）/ `reachable`（网络探针，async，inspect-only）/ `operable`（selected + credential-configured + 操作边界确认，仅执行时权威）。

| Fact / Preference | Authoritative Owner | Persistence | Runtime Resolver | Model Visibility | Secret? | Current State | Proposed State |
|---|---|---|---|---|---|---|---|
| default search provider | `ctx.web` (`WebRuntime`) | settings `web` ns user layer (+ composition base) | `WebRuntime` 每次 search/fetch resolve | capability-visible（`web_search` 可见时） | 否 | `WebRuntimeConfig.searchProvider`（composition） | settings ns + live resolve |
| search fallback providers | `ctx.web` | settings `web` ns | `WebRuntime` selection | capability-visible | 否 | 无（无 fallback） | V1：不引入自动 fallback；V2：显式 ordering 列表 |
| search endpoint | 各 provider 包 | provider 自有 settings ns / config | provider 每次调用 | 一般不投影 | 否 | exa/pplx config；deepseek settings | 保留各自 namespace，统一 apiKeyEnv |
| search API credential（值） | `ctx.credentials` (`credentials-local`) | `$DSH_HOME/.credentials.yaml` | `credentials.resolve(ref)` 每操作 | **E：永不进模型** | **是** | exa/pplx config+env；deepseek apiKeyEnv | exa/pplx 迁移 apiKeyEnv |
| `web-search.exa.registered` | `web` 包（`WebRuntime` 注册表） | –（注册态） | `WebRuntime` 注册表查询 | capability-visible | 否 | 无结构化来源 | registry fact（sync） |
| `web-search.exa.local-available` | `web-search-exa` 包（provider 自判） | –（派生） | `provider.available()` | capability-visible | 否 | 无 | registry fact（sync） |
| `web-search.exa.credential-configured` | `web-search-exa` 包（provider 知道自身 `apiKeyEnv` ref） | –（派生） | `credentials.describe(ref).configured`（async） | capability-visible（安全事实） | 否 | 无 | registry fact（async probe） |
| `web.search-selected` | `web` 包（`WebRuntime` selection） | –（派生） | `resolveProvider()` 结果 | capability-visible | 否 | 无 | registry fact（sync，派生） |
| `web.search-operable` | `web` 包（`WebRuntime` effective） | –（派生） | selected × credential-configured；操作边界权威 | capability-visible | 否 | 无 | registry fact（async，派生；仅在操作边界保证） |
| `net.reachable` | `runtime-facts-host`（probe） | – | inspect 时 probe | **D：仅 inspect** | 否 | 无 | inspect fact（async probe） |
| `host.os` / `host.arch` | `runtime-facts-host` | –（静态） | `process.platform` / `process.arch` | always-on baseline | 否 | 无结构化来源 | registry fact（sync） |
| `runtime.execution-world` | `runtime-facts-host`（owner 委托 subprocess） | –（派生） | subprocess provider 自述（local/remote） | always-on baseline | 否 | 隐式 | registry fact（sync） |
| `host.pid` | `runtime-facts-host` | –（静态） | `process.pid` | **D：仅 inspect** | 否 | 分散使用 | registry fact（sync，inspect） |
| `host.shell` | `runtime-facts-host`（委托 shell provider） | –（派生） | shell provider 自述 | **D：仅 inspect** | 否 | `DSH_SHELL` env | registry fact（sync，inspect） |
| `host.proxy`（sanitized） | `runtime-facts-host`（委托 launch-environment） | –（启动快照） | 环境事实 → sanitized `{configured,scheme,host,port,source}` | **D：仅 inspect** | **潜在（URL 可含凭据）→ sanitize** | proxy 变量在 `scrubbedParentEnv` 保留 | registry fact（sync，inspect，**永不 raw URL**） |
| `web.server-url` | `runtime-facts-host`（owner 委托 `ctx.webServer.port`） | cordis.yml + CLI | `webServer.port` | **D：仅 inspect** | 否 | `webServer.get port` | registry fact（sync，inspect，owner 委托 webServer） |
| workspace / session cwd | `SessionHeader`（session 包） | session header | `session.header.cwd` | `sandbox:policy` 已含 workspaceRoot | 否 | 已存在 | **复用，不重复注册** |
| command resolution | `ctx.subprocess`（subprocess-local） | – | `resolveExecutable` | **D：仅 inspect（runtime_inspect kind=command）** | 否 | 已存在 | **复用，不重复注册；不预注册 per-command fact** |
| sandbox mode / root | `ctx.sandboxPolicy` | session event fold + config | `sandboxPolicy.resolve({session})` | always-on（已有 `sandbox:policy`） | 否 | 已存在 | **复用，不重复注册** |

**强制规则**（R1 保留）：同一值不得同时在 `.env`、`settings.yaml`、`cordis.patch.yml`、tool config、prompt 各自维护一份而无明确 owner。上表每个 Fact/Preference 恰好一行 owner。凡现状在多个位置出现（如 provider 选择：config + env 两处），收敛到唯一 owner + 明确 precedence（config 作 base、env 作同一字段的启动覆盖，`packages/web/web/src/index.ts:76-93`）。

**R2-B5 闭合**：provider 专属状态（`local-available`、`credential-configured`）的 owner 是**各 provider 包**（它们知道自身配置与 `apiKeyEnv` ref）；selection / effective（`web.search-selected`、`web.search-operable`）的 owner 是 **`web` 包（WebRuntime）**。不留"web 包或各 provider"二选一。

---

## 3. 发散：User Preference 方案比较

（R1 结论保留，未受 findings 推翻。）仓库事实：settings seam 已存在（namespace/schema/base/user/watch/redact/UI/wire），已有 4 个 capability 用 `installSettingsSection` 消费。方案 A/B/C/D 比较见 R1 版（本文件 §3 历史）。**收敛：方案 C（分布式声明、领域 owner 求值、统一 settings substrate）**——settings 只管"存/解析/热发布/redact"；credentials 只管"值"（settings 只留 reference）；domain owner（`WebRuntime`）在操作边界把 preference → effective state。B/C/D 拒绝理由不变（中央模块/双源/precedence 冲突）。

---

## 4. Runtime Fact / Context Projection 决策（P1 的收敛，R2 修订为 async assembly projection）

**B10/B13 的展开**。仓库现状：`systemPrompt.context()` 贡献者（sync `text` 函数）+ `RuntimeContextProjection`（dedupe/replay/清除）已存在；sandbox-policy 用无条件 sync context 贡献（`packages/sandbox/sandbox-policy/src/index.ts:112-123`）。但 P1 需要：(1) fact 唯一 home/跨插件冲突检测；(2) 分类（static/dynamic、baseline/inspect、**sync observation / async probe**）；(3) relevance 编排（经 `ctx.tools` 判定可见性）；(4) inspect 查询（含 parameterized inspector）。

**投影机制决策（R2-B1）**：新增 `ctx.runtimeFacts` registry；**投影通过 `system-prompt/assemble` async waterfall 消费**（`packages/core/system-prompt/src/index.ts:532-535` 的 `ctx.waterfall(scopeTarget(...), 'system-prompt/assemble', ...)` 返回权威 assembly；`agent-loop` 的 `preStep` 已 `await assemble()`，`packages/core/agent-loop/src/agent.ts:230`）。runtimeFacts 注册一个 agent-scope waterfall 监听器：`await next()` 后，await 各 async fact（credential describe / probe），把结果写入/替换 `assembly.contexts` 的 `runtime-facts` 项（order 固定）。**不改 Agent Loop、不新建注入路径、不改 `RuntimeContextProjection`**（project 在 assemble 之后照常消费渲染文本）。

**为什么不用纯 sync `systemPrompt.context().text`**：context `text` 是 sync 函数（`system-prompt/src/index.ts:77-85,527`），无法 await `credentials.describe`（async，`docs/subsystems/credentials.md`）或网络探针。若强制 sync，`credential-configured`/`reachable` 只能 inspect、无法 projection，B6 的"告诉 Agent 当前真正生效的结果"退化为只报 `selected`。R2 起以 `system-prompt/assemble` waterfall 为 projection consumer。

**relevance（B8/B15）**：fact 声明 `relevantWhen`（capability 名集合）。投影时，fact owner 经 **`ctx.tools.get(name, scope)`** 判定该 capability 当前可见（authority = `ctx.tools`，非 systemPrompt 反查）。preset/mode 只过滤 relevance（B9）。

**async projection 的七项语义（R2 额外要求 4）**：
1. **deterministic ordering**：runtimeFacts 的 context 项 order 固定（在 `sandbox:policy` 之后）；waterfall 监听器按注册顺序执行；fact 渲染按 key 排序。
2. **error containment**：监听器内每个 async fact 独立 try/catch；失败 contained + logged，记为 `unavailable`/`probe-failure`，**不炸 assemble**。
3. **cancellation**：`AssembleContext.signal` 传入；async probe 用 `abortable()`（`web-search-deepseek/src/provider.ts:283` 同款）响应。
4. **replay**：async 结果最终仍是渲染文本 → `RuntimeContextProjection.project()` 以 `user/message` 注入并可从 session log 恢复；replay 与 sync 方案无差异。
5. **snapshot dedupe**：`project(current, sections)` 按 retained 文本去重；async 结果不变则不重复注入。
6. **token budget**：baseline 恒短（≤6 个 fact）；capability-scoped 命中才加行；`reachable` 等长尾走 `runtime_inspect`。
7. **scope visibility**：waterfall 是 scope-filtered dispatch（`scopeTarget(this, scope)`，scope = agent）；agent-scope 注册的监听器只处理该 agent 的 assembly。

**为什么不复用 `ctx.shellEnv` 直接扩**（R1 保留）：shell-env 面向"每次 shell 调用的 `DSH_*` env 快照"，产物（env 映射）与消费方（context 投影 + inspect）不同契约；合一个 registry 会让 shell-env 承担两套职责。**共享结构、分开注册表**。

---

## 5. Prompt / Settings / Runtime Context / Tool 边界（决策表）

| 内容 | 应进入哪里 | 机制（owner） |
|---|---|---|
| 稳定行为规则（"不要猜宿主事实；有权威 runtime fact 时优先查询"等） | **System Prompt**（section，静态） | `ctx.systemPrompt.section()` |
| 用户长期偏好（默认搜索 provider 等） | **Settings**（namespace user layer） | `installSettingsSection` |
| 秘密凭据 | **Credentials**（`CredentialRef`，值在 store） | `ctx.credentials.resolve` 每操作 |
| 当前客观事实（OS/arch/execution world…） | **Runtime Facts**（registry，带 owner） | `ctx.runtimeFacts` |
| 当前有效状态（`web.search-selected`、`web.search-operable` 等） | **Runtime Context**（尾部 cache-safe snapshot） | `system-prompt/assemble` waterfall + `RuntimeContextProjection` |
| 昂贵/长尾诊断（network reachability、command 解析结果、sanitized proxy） | **runtime_inspect**（tool，按需查询） | `ctx.runtimeFacts.inspect` + tagged-union tool |
| 部署组成（bundle/patch/preset/profile） | **Profile / Bundle / Patch** | composition plane |

**"默认搜索 provider"拆解（R2，以仓库已有 provider exa 为例；Tavily 仅 third-party 扩展示例，V1 不实现）**：

- **settings**：`web.searchProvider: 'exa'`（用户偏好）。
- **credentials**：`EXA_API_KEY`（`apiKeyEnv` 引用，值在 `.credentials.yaml`）。
- **runtime facts**：`web-search.exa.registered: true`、`web-search.exa.local-available: true`、`web-search.exa.credential-configured: true`（安全事实）。
- **runtime context**（effective，async projection）：`Search: selected=exa, credential-configured=true`（capability-visible；不叫 ready）。
- **prompt**：搜索行为规则（用 `web_search` 工具；provider 由 harness 决定，不猜、不查 settings.yaml）。

---

## 5.1 内容进入模型的五级分类（A/B/C/D/E，R2 更新）

| 级 | 定义 | 内容 | 机制 |
|---|---|---|---|
| **A 永远自动进入 Runtime Context** | 少量高价值、cheap、事实恒真的基线 | OS、arch、execution world、sandbox policy（已有 `sandbox:policy`）、`DSH_*` shell 事实（已有） | baseline cost fact 恒投影；async assembly 中 sync 求值 |
| **B capability-visible 时进入** | 事实只在对应 capability/tool 可见时投影 | `web-search.<id>.registered` / `local-available` / `credential-configured`、`web.search-selected` / `web.search-operable` | fact `relevantWhen` + owner 经 `ctx.tools` 判定可见性；B8/B15 |
| **C mode/preset relevant 时进入** | 由 mode/preset 过滤 relevance（不改事实值） | V1 无具体实例；机制保留 | scope 链 + preset 影响 tool 集合 → 经 `ctx.tools` 生效；B9 |
| **D 只能 runtime_inspect 查询** | 昂贵/长尾/低使用率，不进常驻 context | `host.pid`、`web.server-url`、`net.reachable`、`host.proxy`（sanitized）、command resolution 结果 | inspect cost fact；`runtime_inspect` tagged union |
| **E 永远不能进入模型** | secret 或机密配置全文 | credential 值、完整 settings.yaml、`apiKey` 值、`.credentials.yaml` 内容、proxy URL 的凭据段 | `role('secret')` redact + 事实契约禁止 secret 值 + proxy sanitize；B3/B6 |

**"默认搜索 exa"映射到五级**：settings 的 `web.searchProvider` 不进模型（属用户偏好）；`EXA_API_KEY` 值属 E；`web-search.exa.registered` / `local-available` / `credential-configured` 属 B；`web.search-selected` / `web.search-operable` 属 B；`runtime_inspect` 可查的 provider 详情与 command 解析属 D。

---

## 6. Consequences

- **正面**（R1 保留）：Agent 不再猜宿主事实（baseline + inspect 双通道）；用户偏好有唯一持久位置且 live 生效；有效状态可被 Agent 感知；第三方插件可贡献 settings namespace 与 runtime facts 而无中央枚举；全部复用既有机制（settings/credentials/assemble-waterfall/RuntimeContextProjection）。
- **R2 修正的代价**：
  1. projection 需要 async waterfall 监听器——比纯 sync context 贡献者多一个并发维度（但 assemble 本就 async，`preStep` 已 await）。
  2. `credential-configured` / `reachable` 的异步性要求 fact owner 区分 `sync observation` / `async probe`，API 复杂度上升（见 implementation-spec §2）。
  3. capability-visible 判定依赖 `ctx.tools` 查询（`get(name, scope)`），fact owner 需能拿到 agent scope（assemble 的 `AssembleContext.scope` = agent）。
  4. package 组归属调整（tool-runtime-inspect 移入 extensions、baseline 改名 host）带来 file-map 修订（见 implementation-file-map R2）。
- **风险**：waterfall 监听器的错误若未 contained 会炸 assemble——用逐 fact try/catch + probe-failure 语义约束（§4 七项语义第 2 条）。

---

## 7. Rejected Alternatives（及其理由，R2 更新）

| 方案 | 拒绝理由 |
|---|---|
| B：中央 preferences plugin | 违反 everything-is-a-plugin；中央模块知道所有 capability；第三方无法扩展；双源风险（§3-B）。 |
| D：以 Profile/patch 为主、settings 仅 UI | 与已定 precedence 冲突；用户偏好被混入部署组成；无 user 层热更新语义（§3-D）。 |
| 纯 systemPrompt.context() 贡献者，不建 registry | 缺 fact 唯一 home/冲突检测、分类、relevance 编排、inspect 查询；十几个 fact 各自写胶水会碎片化（B10）。 |
| **纯 sync `systemPrompt.context()` 投影**（R2 新增 rejected） | context `text` 是 sync 函数，无法 await `credentials.describe`/网络探针；`credential-configured`/`reachable` 只能 inspect、无法投影，B6 退化为只报 `selected`（B13）。 |
| 扩展现有 ctx.shellEnv 承担全部 runtime facts | 产物（env 映射）与消费方（context 投影 + inspect）不同契约；一个 registry 扛两套会破坏 shell-env 的单职责（§4）。 |
| 新建 ctx.runtime 平行投影注入路径 | 违反"new behavior goes on documented extension points"；改动 agent-loop 需改 architecture.md；现有 `RuntimeContextProjection` 已承担注入/dedupe/replay（B10）。 |
| runtimeFacts 从 systemPrompt 内部反查"已收集工具名" | 复制 visibility resolver；`ctx.tools` 已是可见性唯一 authority（`get`/`schemas`/`view`），反查会双源且随 scope/restrict/preset 漂移（B15）。 |
| 把 command resolution 预注册为 per-command fact | command 空间无限，无法枚举；应为 parameterized inspector（`runtime_inspect kind=command` → `resolveExecutable`），不是 fact key（B16）。 |
| V1 就实现通用 provider fallback 引擎 | 仓库决策"绝不静默换 provider"是审慎的；fallback 的 ordering×availability×failure 三态语义需要真实使用证据支撑，V1 只做显式状态投影，V2 再做自动选择（B12）。 |
