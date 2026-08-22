# Runtime Awareness + User Preference Plane — Architecture Decision

> 前置：`repository-facts.md`（现状盘点，全部判断带证据）。本文件只做决策，不再重复举证；个别关键证据会内联缩写。日期：2026-08-23。状态：待架构评审（第一轮不落实现代码）。

## 0. Blocking Questions 结论（先读这里）

| # | 问题 | 结论 |
|---|---|---|
| B1 | settings.yaml 是否已足以作为唯一 user preference file？ | **是**。settings seam 的 litmus test（"personal config page 应编辑它吗"）已把 user-editable subset 定义为 namespace 内容，precedence 已定（settings 在 composition 之上）。缺的不是新文件，而是"默认搜索 provider"等字段尚未通过 namespace 接入。 |
| B2 | 默认 search provider 的 authoritative owner 应是谁？ | **`ctx.web`（`WebRuntime`，`packages/web/web`）**。它是 selection 语义的既有 owner（执行时 resolve + `WebError` 码）。由它注册 `web` settings namespace，composition entry 作 base。provider 与 tool-web 都不得另设选择源。 |
| B3 | Search API secret 应由哪里拥有？ | **`ctx.credentials`**。settings 只存 `apiKeyEnv`（CredentialRef 名字），值在 `$DSH_HOME/.credentials.yaml`。这是仓库纪律（configuration-source-ownership / request-level-llm-config-credentials），llm-deepseek 与 web-search-deepseek 已是正例；web-search-exa / perplexity 迁移到该模式。 |
| B4 | Profile config 与 user settings 的 precedence 到底是什么？ | 已定死：**`explicit > user settings(settings.yaml) > composition(profile/bundles/--patch) > shell env > .env > defaults`**。settings 在 composition 之上。本方案不改任何一行。 |
| B5 | Settings 热更新后从哪一次调用开始生效？ | **下一次操作**（live 语义）：settings watch 热发布 → domain owner 的 source thunk 变化 → 下一次 `search`/`fetch` 的 resolve 用新值。无需重启、无需重注册 tool、不改 tool schema、不改 system prompt。正在执行中的调用保持旧 snapshot（执行边界已 resolve）。 |
| B6 | Effective provider 是否应该自动告诉 Agent？ | **应该**，作为 capability-visible runtime context（如 `Search provider: Tavily (ready)`），仅当 `web_search`/`web_fetch` 可见时投影。它是 Preference/Reality/Effective 三态分离后的 effective state 投影。V1 纳入。 |
| B7 | 哪些 runtime facts 应 always-on？ | 少量高价值、cheap baseline：OS / arch / execution world、sandbox policy（已有 `sandbox:policy`）、session cwd / workspace root（已有）、`DSH_*` shell 事实（已有）、DSH_HOME。host PID / web port / network 属 capability-visible 或 inspect。 |
| B8 | Tool visibility 是否应该驱动 runtime fact projection？ | **是**。capability-scoped facts（如 search provider readiness）只在对应 tool 可见时投影；always-on 只保留基线。这是 relevance 层，见 §5。 |
| B9 | Mode/Preset 在 projection 中拥有多大权力？ | **只影响 relevance，不改变事实值**。Preset 经 agent scope 影响 tool/capability 集合，进而改变 capability-visible projection；任何 mode/preset 不得改写 fact 的客观值（ONE FACT ONE OWNER）。 |
| B10 | 是否真的需要新增 ctx.runtime，还是扩展现有 runtime-context contributor 足够？ | **新增一个轻量 registry（`ctx.runtimeFacts`），但投影完全委托现有机制**（`systemPrompt.context()` + `RuntimeContextProjection`）。纯 contributor 够投影，但缺 fact 唯一 home/跨插件冲突检测、static/dynamic/cost 分类、relevance 编排、inspect 查询。registry 不新建任何 context 注入路径。 |
| B11 | V1 最小实现边界 | (a) `ctx.runtimeFacts` registry（declaration/relevance/inspect）+ baseline facts；(b) `runtime_inspect` tool；(c) `web` settings namespace（searchProvider/fetchProvider）+ `WebRuntime` live resolve；(d) web-search-exa/perplexity 迁移 apiKeyEnv→credentials；(e) capability-visible projection（search provider ready）。不引入通用 fallback 引擎、不做 full Doctor。 |
| B12 | 哪些内容明确推迟到 V2 | 通用 provider fallback（preference ordering × availability × transient failure 自动选择）、OS keychain credential provider、runtime fact 的进程外查询面（SDK/ACP）、Docker/GPU/MCP/浏览器场景 fact 类型、per-fact 自动过期 TTL、settings value indirection（`${env:VAR}`）。 |

---

## 1. 问题定义

**P1 — Agent Runtime Awareness 不足。** Agent 对自身宿主/运行环境缺乏结构化认知：OS/arch/execution world、实际 shell/runtime、command 权威解析结果、系统代理/网络 route、DSH 自身 PID/端口、capability 真实运行状态，均无统一、有 owner、可查询的事实来源（`repository-facts.md §7.4`：`host.describe` 无 pid/port；`cordis_inspect` 只覆盖 cordis 契约）。Agent 只能经 `$DSH_*` shell 变量或 shell 考古间接获取，容易猜测并产生错误诊断。

**P2 — User Preference / Settings 使用不足。** 用户需要持久表达长期能力偏好（默认搜索 provider、搜索 fallback、默认浏览器、模型/provider 偏好等），且 Agent 应知道"当前真正生效的结果"。仓库已有完整 settings substrate（`ctx.settings` + `installSettingsSection` + `settings-file` + UI + wire），但：(a) 默认 search provider 仍是 composition 字段 `WebRuntimeConfig.searchProvider`；(b) exa/perplexity 的 key 绕过 credentials seam；(c) effective state 不投影给 Agent；(d) 无 fallback 语义。

**约束（不得违反的已定死仓库底线）**：precedence 单一顺序；secret 只留 reference；动态事实只走尾部 cache-safe snapshot 投影；everything-is-a-plugin；ONE FACT ONE OWNER。

---

## 2. Ownership Matrix（ONE FACT → ONE OWNER）

> Current = 现状；Proposed = 本方案落点。Persistence 栏 `–` 表示派生/运行期值（不持久，由 owner 计算）。

| Fact / Preference | Authoritative Owner | Persistence | Runtime Resolver | Model Visibility | Secret? | Current State | Proposed State |
|---|---|---|---|---|---|---|---|
| default search provider | `ctx.web` (`WebRuntime`) | settings `web` ns user layer (+ composition base) | `WebRuntime` 每次 search/fetch resolve | capability-visible（`web_search` 可见时） | 否 | `WebRuntimeConfig.searchProvider`（composition） | settings ns + live resolve |
| search fallback providers | `ctx.web` | settings `web` ns | `WebRuntime` selection | capability-visible | 否 | 无（无 fallback） | V1：不引入自动 fallback；V2：显式 ordering 列表 |
| search endpoint | 各 provider 包 | provider 自有 settings ns / config | provider 每次调用 | 一般不投影 | 否 | exa/pplx config；deepseek settings | 保留各自 namespace，统一 apiKeyEnv |
| search API credential | `ctx.credentials` (`credentials-local`) | `$DSH_HOME/.credentials.yaml` | `credentials.resolve(ref)` 每操作 | 只暴露 `configured=true/false` | **是** | exa/pplx config+env；deepseek apiKeyEnv | exa/pplx 迁移 apiKeyEnv |
| OS | `runtime-facts`（baseline） | –（静态） | `process.platform` 静态解析 | always-on baseline | 否 | 无结构化来源 | registry fact |
| arch | `runtime-facts`（baseline） | –（静态） | `process.arch` | always-on baseline | 否 | 无结构化来源 | registry fact |
| shell / execution world | `runtime-facts`（baseline，owner 委托 subprocess） | –（派生） | `resolveExecutable` / provider 自述 | always-on baseline | 否 | `DSH_SHELL` env、执行 world 隐式 | registry fact |
| workspace / session cwd | `SessionHeader`（session 包） | session header | `session.header.cwd` | `sandbox:policy` 已含 workspaceRoot | 否 | 已存在 | **复用，不重复注册** |
| command resolution | `ctx.subprocess`（subprocess-local） | – | `resolveExecutable` | 不投影；`runtime_inspect` 查询 | 否 | 已存在 | **复用**，inspect 走它 |
| system proxy | `launch-environment`（继承 env） | –（启动快照） | 环境事实 | inspect | 否 | proxy 变量在 `scrubbedParentEnv` 保留 | registry fact（inspect） |
| network reachability | `runtime-facts`（probe） | – | inspect 时 probe（cheap 缓存） | inspect（昂贵/长尾） | 否 | 无 | inspect fact |
| DSH host PID | host 进程（`process.pid`）→ `runtime-facts` | –（静态） | `process.pid` | inspect / 调试上下文 | 否 | 分散使用 | registry fact（owner 委托 host 侧） |
| DSH web port | `ctx.webServer`（webserver） | cordis.yml + CLI | `webServer.port` | capability-visible（web 场景）/ inspect | 否 | `webServer.get port` | registry fact（owner 委托 webServer） |
| sandbox mode / root | `ctx.sandboxPolicy` | session event fold + config | `sandboxPolicy.resolve({session})` | always-on（已有 `sandbox:policy`） | 否 | 已存在 | **复用，不重复注册** |
| active search provider（effective） | `ctx.web`（派生） | –（派生） | selection 结果 | capability-visible | 否 | 无 | projection fact（派生，不持久） |
| provider readiness | 各 provider `available()` + credential describe | –（派生） | `available()` + `credentials.describe(ref)` | capability-visible（只暴露安全事实） | 否 | 无 | projection fact（派生） |

**强制规则**：同一值不得同时在 `.env`、`settings.yaml`、`cordis.patch.yml`、tool config、prompt 各自维护一份而无明确 owner。上表每个 Fact/Preference 恰好一行 owner。凡现状在多个位置出现（如 provider 选择：config + env 两处），方案收敛到唯一 owner + 明确 precedence（config 作 base、env 作同一字段的启动覆盖，与仓库"operational overrides feed the SAME fields"决策一致，`packages/web/web/src/index.ts:76-93`）。

---

## 3. 发散：User Preference 方案比较

仓库事实决定了比较的锚点：settings seam 已存在（namespace/schema/base/user/watch/redact/UI/wire），且已有 4 个 capability 用 `installSettingsSection` 消费。因此问题不是"造不造配置系统"，而是"现有 settings seam 如何成为统一 User Preference Plane + 具体 capability 如何正确消费"。

### 方案 A：每个 capability/plugin 直接注册自己的 ctx.settings namespace

- **是否符合 everything-is-a-plugin**：是——分布式声明，插件自治。
- **ownership 是否清晰**：是——namespace owner = 注册者。
- **第三方插件能否扩展**：能——注册即加入，无需中央枚举。
- **中央模块知道所有 capability 的问题**：无——没有中央模块。
- **两个 source of truth 风险**：低——namespace 唯一；但若 capability 内部既有 config 字段又注册同义 settings 字段且不做 base/user 分层，会造出双源。`installSettingsSection` 的 base=entry 正是防此（§2.2 repo-facts）。
- **hot reload**：好——`watch` + `onChange` 已成熟。
- **replay/diagnostics**：settings 变化经 `settings/updated` 事件可观测。
- **model visibility**：无内建——namespace 只是配置，谁投影谁负责。
- **配置迁移**：combo entry → base 层，天然兼容。
- **测试难度**：低——单包单 namespace。
- **缺点**：无"relevance/effective-state"编排；capability 自己写"偏好→有效状态→投影"的胶水，容易各自为政。

### 方案 B：中央 preferences plugin 集中拥有所有用户设置

- **everything-is-a-plugin**：名义是插件，但语义是中央模块。
- **ownership**：中央一个 owner——但"用户偏好"跨 domain，一个 owner 无法判定每个字段的 domain 语义。
- **第三方扩展**：差——新 capability 要改中央 schema/枚举。
- **中央模块知道所有 capability 的问题**：严重——正是仓库刻意避免的（settings seam 的 litmus test 就是反中央）。
- **两个 source of truth**：高——中央 preferences 与各 capability 自己的 config 必然打架。
- **hot reload / replay / model visibility / 迁移 / 测试**：均劣于 A（中央聚合破坏 per-namespace 生命周期与并发写入）。
- **结论**：与仓库架构直接冲突，拒绝。

### 方案 C：Settings 只保存 preference，具体 domain router/service 注册 namespace 并负责 resolution（**收敛**）

- 即"**分布式声明、领域 owner 求值、统一 settings substrate**"。
- 声明：每个 capability（domain）注册自己的 namespace（`installSettingsSection`），只存用户可编辑的 preference 子集。
- 求值：domain owner（如 `WebRuntime`）在每次操作边界把 preference → effective state（结合 reality：`available()`、`credentials.describe`）。
- 统一 substrate：settings 只管"存/解析/热发布/redact"，不解释语义；credentials 只管"值"，settings 只留 reference。
- 与仓库事实完全一致：llm 系（A/D 的简化）、agent-default-model、web-search-deepseek 已按此工作。本方案只是**把"默认 search provider"也接入**，并补上"effective state → runtime context 投影"这一段（现状缺失）。
- **相对 A 的增量**：明确 domain owner 负责 resolution（防各自为政）+ effective state 投影（A 没管 model visibility）。

### 方案 D：继续主要通过 Profile/cordis.patch.yml 配置，settings 只用于 UI convenience

- **precedence 冲突**：precedence 已定 settings 在 composition 之上；把用户偏好放 cordis.patch.yml 等于把"用户长期偏好"混入"部署组成"，且 profile 随 bundle 走、不可按用户热改、每 profile 各一份。
- **hot reload**：composition patch 热重载只针对 config 树，不是 user-preference 语义。
- **第三方扩展**：patch 可加行，但语义仍是部署层。
- **结论**：拒绝。Profile/Bundle/Patch 属于"部署组成"（P 决策表第 6 行），不是用户偏好 plane。

### 收敛：方案 C

理由（why）：与仓库全部既有资产对齐（settings seam、`installSettingsSection`、credentials 纪律、`ctx.web` selection owner）；分布式声明天然支持第三方；domain owner 求值把"偏好 vs reality vs effective"的归位责任放进 domain（B6）；统一 substrate 避免第二个 source of truth。

---

## 4. Runtime Fact / Context Projection 决策（P1 的收敛）

**B10 的展开**。仓库现状：投影机制已存在且成熟（`systemPrompt.context()` 贡献者 + `RuntimeContextProjection` 的 dedupe/replay/清除），sandbox-policy 已示范"owner 直接注册 context 贡献"。但 P1 需要的不只是投影，还有：

1. **fact 的唯一 home 注册表**——"OS"只有一个 owner；两个插件声明同一 fact 必须 fail loud（shell-env 的 keyOwners 已示范）。
2. **分类**——static/dynamic、cheap baseline / expensive inspect（决定投影还是按需查询）。
3. **relevance 编排**——当前可见 tools/capabilities + preset/mode 决定投影哪些 fact（sandbox:policy 无条件，新层要条件化）。
4. **inspect 查询**——long-tail facts 的 model-facing 查询入口（现状只有 cordis_inspect 且覆盖 cordis 契约）。

因此新增一个**轻量 registry 包** `dsh-runtime-facts`（`ctx.runtimeFacts`），承担 1-4；**投影仍委托 `systemPrompt.context()` + `RuntimeContextProjection`**，不新建 context 注入路径、不改 agent-loop。理由：agent-loop 的 runtime-context 注入是"Model-visible ⟺ logged"的 enforce 点，改它必须改 architecture.md；而 registry 是纯插件侧扩展点，符合"new behavior goes on documented extension points"（`docs/architecture.md:106-131`）。

**为什么不复用 `ctx.shellEnv` 直接扩**：shell-env 面向"每次 shell 调用的 `DSH_*` env 快照"，其 `resolve(execution)` 产出 env 字符串映射；而 runtime facts 面向"模型 context 投影 + inspect 查询"，产出可以是布尔/枚举/短文本，且需要 relevance 维度。两者结构同源（声明所有权 + 逐执行求值）但产物与消费方不同，合一个 registry 会让 shell-env 承担两套契约。**共享结构、分开注册表**；若未来证据表明需要合并，可再演进（V2 讨论项）。

**Relevance 声明**（B8/B9 的实现）：fact 声明 `relevant(capabilityContext)` 或声明式 `{ capabilities?: string[], modes?: string[] }`。投影算法在每次 assembly 求值：always-on baseline 恒投影；capability-scoped 仅在当前 agent 的可见 tool 集合命中时投影；preset/mode 只过滤 relevance（不碰 fact 值）。

**Freshness**：static fact 启动即定；dynamic cheap fact 每次 assembly 求值（与 sandbox:policy 同）；expensive probe 只在 `runtime_inspect` 触发，V1 不做自动过期（V2: per-fact TTL）。**Secret 边界**：fact 值永远不含 secret；只允许 `credentialConfigured: true/false` 这类安全事实（§2 矩阵 Secret 列）。

---

## 5. Prompt / Settings / Runtime Context / Tool 边界（决策表）

| 内容 | 应进入哪里 | 机制（owner） |
|---|---|---|
| 稳定行为规则（"不要猜宿主事实；有权威 runtime fact 时优先查询"等） | **System Prompt**（section，静态） | `ctx.systemPrompt.section()` |
| 用户长期偏好（默认搜索 provider 等） | **Settings**（namespace user layer） | `installSettingsSection` |
| 秘密凭据 | **Credentials**（`CredentialRef`，值在 store） | `ctx.credentials.resolve` 每操作 |
| 当前客观事实（OS/arch/execution world…） | **Runtime Facts**（registry，带 owner） | `ctx.runtimeFacts` |
| 当前有效状态（`Search provider: Tavily (ready)`） | **Runtime Context**（尾部 cache-safe snapshot） | `systemPrompt.context()` + `RuntimeContextProjection` |
| 昂贵/长尾诊断（network reachability、command 解析结果） | **runtime_inspect**（tool，按需查询） | `ctx.runtimeFacts.inspect` + model-facing tool |
| 部署组成（bundle/patch/preset/profile） | **Profile / Bundle / Patch** | composition plane |

**"默认搜索 Tavily"拆解**：

- **settings**：`web.searchProvider: 'tavily'`（用户偏好）。
- **credentials**：`TAVILY_API_KEY`（`apiKeyEnv` 引用，值在 `.credentials.yaml`）。
- **runtime facts**：`web-search.tavily.available: true`、`web-search.tavily.credentialConfigured: true`（安全事实）。
- **runtime context**（effective）：`Search provider: Tavily (ready)`（capability-visible）。
- **prompt**：搜索行为规则（用 `web_search` 工具；provider 由 harness 决定，不猜、不查 settings.yaml）。

### 5.1 内容进入模型的五级分类（A/B/C/D/E）

| 级 | 定义 | 内容 | 机制 |
|---|---|---|---|
| **A 永远自动进入 Runtime Context** | 少量高价值、cheap、事实恒真的基线 | OS、arch、execution world、sandbox policy（已有 `sandbox:policy`）、`DSH_*` shell 事实（已有） | baseline cost fact 恒投影；`RuntimeContextProjection` 去重 |
| **B capability-visible 时进入** | 事实只在对应 capability/tool 可见时投影 | search provider readiness（`available`/`credentialConfigured`）、effective provider（`web.searchEffective`） | fact `projectWhen` 由 owner 自判（`web_search` 可见时）；B8 |
| **C mode/preset relevant 时进入** | 由 mode/preset 过滤 relevance（不改事实值） | V1 无具体实例；机制保留（`projectWhen` 可读 scope/mode） | scope 链 + preset 影响 tool 集合 → 经 B 生效；B9 |
| **D 只能 runtime_inspect 查询** | 昂贵/长尾/低使用率，不进常驻 context | host PID、web server URL、network reachability、command resolution 结果、system proxy | inspect cost fact；`runtime_inspect` tool 按需 |
| **E 永远不能进入模型** | secret 或机密配置全文 | credential 值、完整 settings.yaml、`apiKey` 值、`.credentials.yaml` 内容 | `role('secret')` redact + 事实契约禁止 secret 值；B3 |

**"默认搜索 Tavily"映射到五级**：settings 的 `web.searchProvider` 不进模型（E 之外，属"用户偏好"，模型看到的是投影后的 effective，不是原始偏好文件）；`TAVILY_API_KEY` 值属 E；`web-search.tavily.available` 属 B；`web.searchEffective: Tavily (ready)` 属 B；`runtime_inspect` 可查的 provider 详情属 D。

---

## 6. Consequences

- **正面**：Agent 不再猜宿主事实（baseline + inspect 双通道）；用户偏好有唯一持久位置且 live 生效；effective state 可被 Agent 感知；第三方插件可贡献 settings namespace 与 runtime facts 而无中央枚举；全部复用既有机制（settings/credentials/context projection），改动面小。
- **负面/代价**：
  1. 新增一个 core registry 包 + 一个 tool（schema 固定成本进每请求）。
  2. baseline facts 增加 runtime-context snapshot 体积（控制：只放少量 cheap facts；长尾走 inspect）。
  3. web-search-exa/perplexity 的配置迁移有兼容成本（apiKey→apiKeyEnv；`apiKey` 以 `role('secret')` 兼容保留）。
  4. "WebRuntime 注册 settings namespace" 让 seam owner 兼任 preference owner——需要明确 `ctx.web` 的注册职责在 `web` 包（Service Definition）而非 provider/tool。
- **风险**：relevance 计算若依赖 tool 可见集枚举，可能随 agent scope 复杂化；V1 用"可见 tool 名集合命中"这一简单模型，保持 capability-neutral 精神（只按命中的 capability 投影，不盘点缺失能力）。

---

## 7. Rejected Alternatives（及其理由）

| 方案 | 拒绝理由 |
|---|---|
| B：中央 preferences plugin | 违反 everything-is-a-plugin；中央模块知道所有 capability；第三方无法扩展；双源风险（§3-B）。 |
| D：以 Profile/patch 为主、settings 仅 UI | 与已定 precedence 冲突；用户偏好被混入部署组成；无 user 层热更新语义（§3-D）。 |
| 纯 systemPrompt.context() 贡献者，不建 registry | 缺 fact 唯一 home/冲突检测、static/dynamic/cost 分类、relevance 编排、inspect 查询；十几个 fact 各自写胶水会碎片化（B10）。 |
| 扩展现有 ctx.shellEnv 承担全部 runtime facts | 产物（env 映射）与消费方（context 投影 + inspect）不同契约；一个 registry 扛两套会破坏 shell-env 的单职责（§4）。 |
| 新建 ctx.runtime 平行投影注入路径 | 违反"new behavior goes on documented extension points"；改动 agent-loop 需改 architecture.md；现有 `RuntimeContextProjection` 已承担注入/dedupe/replay，重复实现必导致 replay 分叉（B10）。 |
| V1 就实现通用 provider fallback 引擎 | 仓库决策"绝不静默换 provider"是审慎的；fallback 的 ordering×availability×failure 三态语义需要真实使用证据支撑，V1 只做显式失败 + 模型可见，V2 再做自动选择（B12）。 |
