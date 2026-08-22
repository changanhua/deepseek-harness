# Runtime Awareness + User Preference Plane — Repository Facts

> 文档性质：固定版本调查基线（design 前的事实盘点），供架构评审。调查对象：本仓库工作树（master，`dsh` 0.1.0-rc 系）。调查日期：2026-08-23。证据规则：每条判断都附 `相对路径:行号`；行号以本次调查时的工作树为准，本文不引用也不依赖任何未提交的并行工作（work-observatory 等）。

## 0. 阅读规则与证据边界

本文是"Repository Fact Finding"的交付物：只陈述仓库现状（已实现的事实、已有的 owner、已有的 seam），标注缺口，不做方案收敛（收敛见 `architecture-decision.md`）。

事实来源四类：
- **源码**：`packages/**` 的 Service Definition / Provider / Consumer。
- **子系统文档**：`docs/subsystems/*.md`（含 generated cordis-surface）。
- **决策笔记**：`.agents/notes/implemented/**`（决策理由的唯一 home）。
- **生成目录**：`docs/config-catalog.md`、`docs/capability-seams.md`。

三条已定死的仓库底线（本任务不得违反）：
1. 非 secret 值 precedence 单一顺序已定：`explicit > user settings > composition > shell env > .env > defaults`（[configuration-source-ownership](../../.agents/notes/implemented/architecture/2026-08-04-configuration-source-ownership.md)，见 §4）。
2. secret 永远只以 reference（环境变量名）进入配置/设置，值由 `ctx.credentials` 拥有（"deleting the problem beats mitigating it"）。
3. 动态 policy/运行时事实只能以"尾部 cache-safe 快照"投影给模型，不允许回退到改稳定 system prompt 的方案（DeepSeek 匹配完整前缀，改 system section 会打爆 KV cache）。

---

## 1. DSH 总体架构（本任务相关的部分）

**Everything is a plugin。** Cordis 上一切皆插件：model adapter、tool registry、session log、agent loop 都是可替换的插件（`docs/architecture.md:9-13`）。扩展 dsh = 在旁边挂一个插件，注册是随 fiber 回收的 effect（`AGENTS.md:conventions`）。

**Capability seam 三角色。** 一个可替换能力 = Service Definition（声明接口）+ Service Provider（实现）+ Consumer（通常是 model-facing tool），三角色齐备才是一个 seam（`docs/architecture.md:98-102`；`docs/capability-seams.md` 全文）。包可合并角色，但一个角色不算 seam。

**配置是分层树。** 一个运行中的 dsh 是按序从"空 entry list"叠加各层组成：各 bundle（按 profile 列出顺序）→ profile 的 `cordis.patch.yml` → home-level `cordis.patch.yml` → `--patch` overlay（`docs/architecture.md:15-37`；`packages/boot/app-boot/README.md#profiles`）。

**Model-visible ⟺ logged。** 任何到达模型请求的输入必须能从 session log 重建；新 model-visible input 需要新 session event（`docs/architecture.md:94-96`）。runtime-context snapshot 作为 `user/message`（source `@deepseek-ai/dsh-system-prompt`）进 log，replay 可重建（见 §7）。

**本任务相关的核心 seam（ctx key 索引）**：

| ctx key | Owner 包 | 角色 | 一句话 |
|---|---|---|---|
| `ctx.settings` | `packages/settings/settings` | seam | 用户设置 namespace 注册/分层解析/提交 |
| `ctx.credentials` | `packages/credentials/credentials` | seam | CredentialRef 逐操作 resolve + 授权记录 |
| `ctx.web` | `packages/web/web` | seam | search+fetch 两个操作、provider selection |
| `ctx.systemPrompt` | `packages/core/system-prompt` | core | prompt section / context / tool schema 组装 |
| `ctx.shellEnv` | `packages/shell/shell-env` | core | 每次 shell 调用的 `DSH_*` 可信快照 registry |
| `ctx.sandboxPolicy` | `packages/sandbox/sandbox-policy` | core | sandbox mode + workspace root 的唯一 home，并投影 runtime context |
| `ctx.subprocess` | `packages/subprocess/subprocess` | seam | 进程树/stdio/termination + execution-world executable lookup |
| `ctx.webServer` | `packages/host/webserver` | core | HTTP 端口唯一 owner |
| `ctx.agentDefaultModel` | `packages/core/agent-default-model` | core | 默认模型选择，settings 消费范例 |

证据：`docs/capability-seams.md:437-499`（表格）。

---

## 2. Settings：用户偏好 substrate 的现状

### 2.1 Seam 契约

`ctx.settings` 持有**一份用户拥有的文档**，按注册的 namespace 分节解析：schema defaults → 注册者的 composition `base`（entry-config 子集）→ 用户 section（`docs/subsystems/settings.md:5`；`packages/settings/settings/src/index.ts:1-6`）。三包边界：

| 包 | 角色 |
|---|---|
| `packages/settings/settings` | 抽象 `SettingsProvider`：namespace 注册表、分层解析、schema 校验、deep-equal 变更检测、`settings/updated` 事件 |
| `packages/settings/settings-file` | 默认 `$DSH_HOME/settings.yaml`（`.yaml`/`.yml`/`.json` 按扩展名）；chokidar watch 热发布；跨进程写锁下 0600 temp+rename 原子写；YAML 叶子级 diff 保留注释；内容相等抑制自写 |

证据：`packages/settings/settings-file/README.md:1-30`；`packages/settings/README.md:5-12`。

### 2.2 关键 API（已实现）

- `settingsNamespace(value)`：小写 kebab-case 品牌类型，构造校验（`packages/settings/settings/src/index.ts:19-31`）。
- `SettingsScope<T>`：`get()` / `watch(cb)` / `update(patch)` / `replace(section)`（`docs/subsystems/settings.md:65-94`）。`update` 只 merge user 层；`replace` 是整节替换（reset 路径）；`applies: 'live' | 'restart'` 是 UI 提示非机制。
- `SettingsRegisterOptions.validate`：schema 表达不了的跨字段约束，在**写入时**拒绝（`docs/subsystems/settings.md:24-54`）。
- `describe({ redactSecrets: true })`：wire 面强制；`role('secret')` 字段从 value/base/user 三层剥离，只枚举 `{path, set}` 槽位（`docs/subsystems/settings.md:98-153`）。
- `settings/updated (ns, next, prev, source)` / `settings/document-updated (ns, revision)` 事件（`docs/subsystems/settings.md:259-309`）。
- **`installSettingsSection(ctx, ns, schema, entry, hooks)`**：canonical 消费接线。settings 服务存在时用 entry 作 `base` 注册 namespace 并把 source thunk 指向 `scope.get()`；settings 消失（卸载/重载）回退到 entry，consumer 照常按 composition 运行（`packages/settings/settings/src/index.ts:828-897`）。**这是每个 capability 接入 preference plane 的现成入口。**

### 2.3 热加载语义（settings-file）

- 启动 fail loud；运行中坏外部编辑 warn-and-keep-last-good（`packages/settings/settings-file/README.md:20-21`）。
- 外部编辑经 watcher 热发布 → 每个 namespace `scope.watch` 回调收到 `(next, prev)`；`installSettingsSection.onChange` 是 consumer 的再判定入口（`packages/settings/settings/src/index.ts:863-897`）。
- 写是 read-modify-write + 跨进程写锁；一个 namespace 并发写 last-write-wins（已知限制，`packages/settings/settings-file/README.md:42`）。
- **已知限制**：settings-file 无 value indirection（`${env:VAR}` 引用是 deferred seam 级特性，`packages/settings/settings-file/README.md:45`）——secret 因此不应靠它，走 credentials（§5）。

### 2.4 现有消费范例（都是本任务要推广的模式）

| Consumer | namespace | base（composition entry） | 热变化行为 |
|---|---|---|---|
| `agent-default-model` | `agent-default-model` | `{provider, model}` | `setSource` 换 source thunk，`currentSelection()` 每读解析（`packages/core/agent-default-model/src/index.ts:76-104`） |
| `llm-deepseek` | `llm-deepseek` | plugin `Config`（endpoint/apiKeyEnv/…） | `onChange: ensureRegistrationFacts` 只重建注册期捕获的 retryPolicy；per-request 事实每请求重读（`packages/llm/llm-deepseek/src/index.ts:390-467`） |
| `llm-pi-ai` | `llm-pi-ai` | plugin `Config`（providers profiles） | provider 路由可经 settings `providers.<id>` 声明；`settingsPath: ['providers', provider]` 暴露给 Models UI（`packages/llm/llm-pi-ai/src/index.ts:90,128,228,286`） |
| `web-search-deepseek` | `web-search-deepseek` | plugin `Config`（apiKeyEnv/baseURL/model/…） | **每调用**投影 settings section：user 层改 endpoint/model 直达下一次 search；`apiKey` 带 `role('secret')` 永不进 describe（`packages/web/web-search-deepseek/README.md:21-37`） |

证据补充：llm 侧的 `registerConfigurableProviders(entries)` 把 `{ provider, displayName, settingsNs, settingsPath }` 暴露给 Host，Models 页据此发现"哪个 provider 可配置、配置在哪个 settings 位置"（`packages/llm/llm-pi-ai/src/index.ts:228`；`packages/host/apiproxy/src/api/llm.ts:21-23`）。

### 2.5 Settings 的 wire 面（已存在，无需新建）

`host-apiproxy` 已提供完整 settings/credentials RPC：`settings.describe/openDocument/update/replace/mutate` + `credentials.describe/set/unset`，全部经 redact（`packages/host/apiproxy/src/api/settings.ts:1-4`、`settings.schema.ts`、`credentials.ts`；路由 `packages/host/apiproxy/src/fetch/handler.ts:134-141`）。settings UI 插件已存在：`@deepseek-ai/dsh-client-ui-settings`、`ui-settings-general`、`ui-settings-models`、`ui-settings-plugins`、`ui-settings-skills` 等（`docs/config-catalog.md:3336-3341`）。

### 2.6 两平面 litmus test（决策依据）

settings seam 的命名空间 owner 原则：**"personal config page 应编辑它吗"**——只有为真的用户可编辑子集才进 settings namespace；其余留在 composition plane（`.agents/notes/implemented/architecture/2026-07-28-user-settings-seam.md:15`）。

---

## 3. 配置所有权与 precedence

### 3.1 非 secret 值：一个单一顺序（已定死）

> `explicit-for-this-run(CLI/per-op) > user settings(settings.yaml) > composition(profile bundles/--patch) > this launch's shell(继承 env) > discovered file(<cwd>/.env 再 $DSH_HOME/.env) > defaults`

证据：`.agents/notes/implemented/architecture/2026-08-04-configuration-source-ownership.md:19-29`。含义：settings seam 把 plugin 的 cordis entry config 注册为 `base`、用户 section 叠加其上，所以 **user settings 位于 composition 之上**（:30）；composition 仍高于环境（陈旧 shell 变量改不了已配置值）。

### 3.2 各层的 owner 与机制

| 层 | owner | 持久化 | 关键证据 |
|---|---|---|---|
| CLI/per-run | `packages/boot/cmdline`、bundle `webStartup` | 无 | `dsh --profile web --host/--port` 等（`packages/bundle/web-app/src/startup.ts:46-90`） |
| user settings | `ctx.settings` + `settings-file` | `$DSH_HOME/settings.yaml` | §2 |
| composition | Cordis include + patch 层 | bundle 内 `cordis.patch.yml`、profile `cordis.patch.yml`、home `cordis.patch.yml`、`--patch` | `docs/architecture.md:15-37` |
| shell env | `packages/util/launch-environment`（`launchEnvironment` 快照，`DSH_LAUNCH_ENVIRONMENT_KEY='launchEnvironment'`） | 启动时冻结一次 | `packages/util/launch-environment/src/index.ts:16-106`；`packages/boot/app-boot/README.md:42` |
| `.env` | `loadLayeredEnv`：inherited > project `.env` > user `.env`；拒绝 bootstrap-only 变量（PATH/SHELL/DSH_*/HOME/XDG_*/proxy 等） | `.env` | `packages/boot/app-boot/README.md:42`；configuration-source-ownership:45-47 |

### 3.3 门与校验

`verify-config-source-ownership` 是已执行的门：禁止 shipped cordis 配置内联 apiKey/baseURL/headers 环境值（configuration-source-ownership:51）。

---

## 4. Credentials：secret 的归属

### 4.1 Seam 契约

`ctx.credentials` 两个 key space：
- **CredentialRef**（环境变量名）：回答"这个名字背后是什么"。resolve 是**逐操作**（每次 model request / 每次 search），per-operation read 就是 hot-update 机制；空值全局视为 absent（`docs/subsystems/credentials.md:5,20-30,140`）。
- **CredentialKey**（授权记录）：回答"这个插件为这个 id 持有哪个凭据"；record 不可分层，`modifyRecord` 是唯一写路径（token refresh 的 read-decide-replace under lock）（`docs/subsystems/credentials.md:125-211`）。

### 4.2 Provider：credentials-local 四层

`env(只读、最高) > $DSH_HOME/.credentials.yaml(provider-managed、可写) > <cwd>/.env > $DSH_HOME/.env`（`packages/credentials/credentials-local/README.md:7-14`）。文档"只装凭据，任何偏离即 reject"；0600/0700 权限（:56-68）。**模型进程可读该文件**（同用户），harness 的承诺只是"不给路径、不进进程环境"（:76-78）；OS keychain 是 deferred（:78）。

### 4.3 消费纪律（正例）

配置/设置只携带 **reference 名字**，值由 `ctx.credentials.resolve(ref)` 获得。llm-deepseek：`apiKeyEnv: CredentialRef` 属于 `DeepSeekConnectionOptions`，每请求 `resolveApiKey` 解析，"Configuration carries only this name — a literal key is not a configuration value"（`packages/llm/llm-deepseek/src/adapter.ts:70-79,110-127`；`src/index.ts:411-432`）。llm-pi-ai 同构（`apiKeyEnv` 为 `z.string().role('credential-ref')`，`packages/llm/llm-pi-ai/src/config.ts:308`）。

### 4.4 反例（本任务要修正的）

**web-search-exa / web-search-perplexity 直接以 plugin config 持有 apiKey**（默认 `$EXA_API_KEY` / `$PERPLEXITY_API_KEY`，`packages/web/web-search-exa/README.md:11-24`；`web-search-perplexity/README.md:11-24`），**未走 `ctx.credentials`**，key 因此进入 composition plane（`.env`/`cordis.yml` 引用）。**web-search-deepseek 已是正例**：`apiKeyEnv` 默认 `DEEPSEEK_API_KEY` 每次 search 经 `ctx.credentials.resolve`，无 seam 时回退进程环境（`packages/web/web-search-deepseek/README.md:15-37`）。

---

## 5. Search / Web：默认 provider 现状

### 5.1 一个 seam、两个操作、一个 selection owner

`ctx.web`（`WebRuntime`）同时承载 search 与 fetch（`docs/subsystems/web.md:5-11`）。Provider 注册"capability"（`WebSearchProvider`/`WebFetchProvider`）而非 tool；model-facing 名/schema/prompt 全在单一 consumer `dsh-tool-web`（`tool-web`）。

### 5.2 Provider selection（现状 = 关键缺口）

Selection 在**执行时**解析，永不依赖注册顺序（`packages/web/web/src/index.ts:62-73`）：
- 配置了 id 且注册且 `available()` → 用它。
- 配置了 id 未注册 → `WEB_PROVIDER_CONFIGURED_MISSING`。
- 配置了 id 注册但不可用 → `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`。
- 未配置且恰好一个可用 → 自动选。
- 未配置多个可用 → `WEB_PROVIDER_AMBIGUOUS`。
- 未配置无可用 → `WEB_PROVIDER_UNAVAILABLE`。

**`searchProvider` / `fetchProvider` 是 `WebRuntimeConfig`（composition/config 字段）**，env 覆盖走同一字段（`$DSH_WEB_SEARCH_PROVIDER` / `$DSH_WEB_FETCH_PROVIDER`），不引入隐藏优先级链（`packages/web/web/src/index.ts:55-93`）。**没有 settings namespace 承载"用户默认搜索 provider"**——这是 User Preference 缺口的第一证据。

### 5.3 Fallback 现状 = 无

tool 绝不因 provider 缺失/未配置/歧义而注销；执行期解析并抛结构化 `WebError`，**绝不静默换 provider**（`.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md:32-37`）。因此"用户偏好 ordering + availability + transient failure"三者的 fallback 语义目前**不存在**，是设计空白。

### 5.4 provider 内部配置现状

| Provider | id | API key 读取 | settings namespace | endpoint |
|---|---|---|---|---|
| exa | `exa` | config `apiKey`，默认 `$EXA_API_KEY` | 无 | config `baseURL` 默认 `https://api.exa.ai` |
| perplexity | `perplexity` | config `apiKey`，默认 `$PERPLEXITY_API_KEY` | 无 | config `baseURL` 默认 `https://api.perplexity.ai` |
| deepseek | `deepseek` | config `apiKeyEnv`（默认 `DEEPSEEK_API_KEY`）经 `ctx.credentials` | **有**（`web-search-deepseek`） | config/settings `baseURL` |
| fetch-http | `http` | 无（无凭据） | 无 | — |

证据：`docs/config-catalog.md:3201-3273`；`packages/web/web-search-*/README.md`。

### 5.5 模型可见面

`dsh-tool-web` 注册 `web_search` / `web_fetch` tool + 一条 systemPrompt section 指导（`packages/web/tool-web/src/search.ts:316-375`）。**模型看不到"当前用哪个 provider / 是否 ready"**——tool 描述只谈查询与结果。capability-visible 投影在此为空白。

---

## 6. Runtime Context：动态事实投影的现状

### 6.1 组装与注入机制（已存在、成熟）

- `ctx.systemPrompt.context({name, order, text})` 注册动态 context 贡献者；`text` 可为每次 assembly 求值的函数（`packages/core/system-prompt/src/index.ts:77-85,398-407`）。
- 每次模型请求前 `systemPrompt.assemble()` → `renderContextSections()` → `RuntimeContextProjection.project()` 生成/去重 **user/message**（source `@deepseek-ai/dsh-system-prompt`，form `snapshot`，带 sections 归属）→ append 到 session log（`packages/core/agent-loop/src/agent.ts:230-239`；`packages/core/agent-loop/src/runtime-context.ts:12-75`）。
- `RuntimeContextProjection` 负责：只在新 snapshot 变化时注入、replacement 时发 `CLEARED` 标记、从 log 恢复 retained 状态（replay）、dedupe（`runtime-context.ts:24-75`）。
- 渲染模板：`Current runtime context. This snapshot supersedes earlier runtime-context snapshots.`（`packages/core/system-prompt/src/index.ts:236-240`）——这正是模型侧看到的动态 context。

### 6.2 为什么是尾部快照而不是动态 system section（关键约束）

DeepSeek 匹配完整前缀做 KV-cache；改 system section 会使缓存失效。因此设计定为：稳定 system prompt + **history 尾部追加"所有动态 context 的完整快照 + 显式 supersession 声明"**（`.agents/notes/implemented/feature/2026-07-30-current-sandbox-policy-context.md:19,43`）。本任务必须沿用。

### 6.3 现有 context 贡献者（都是 projection 的范式）

| name | order | owner | 内容 |
|---|---|---|---|
| `sandbox:policy` | 110 | `sandbox-policy` | 每请求 `resolve({session})` 得当前 mode+workspaceRoot，渲染条件化事实（`packages/sandbox/sandbox-policy/src/index.ts:37-51,112-123`） |
| `time-context` | pre-step listener | `time-context` | 时区/经过时间，用同名 `user/message` source 注入（`packages/context/time-context/README.md:27-37`） |
| `harness:source` | — | `app-boot.addHarnessSourceSection` | 告诉模型 checkout 路径、不要从路径推断 cwd（`packages/boot/app-boot/README.md:23`） |
| `tool:web_search` / `tool:*` | 110 | 各 tool | systemPrompt **section**（非 context）稳定指导 |
| workspace instructions | — | `agent-instructions` | 独立 `user/message` baseline + touch 驱动更新（`packages/context/agent-instructions/README.md:9-56`） |

**capability-neutral 演进**：sandbox-policy 曾删掉 family-registration 注册表，context 只陈述所有 enforcement 方言共享的条件化事实（`.agents/notes/implemented/simplification/2026-07-31-capability-neutral-sandbox-policy-context.md:15-19`）——projection 要"陈述事实，不盘点能力"。

### 6.4 shell 环境事实（`ctx.shellEnv`）

- `ShellEnvRegistry`：built-ins `DSH_HOME` / `DSH_SHELL='1'` / `DSH_SESSION_ID`（+`DSH_SESSION_JSONL` 由 contributor 提供）；插件 `register(contributor)` 声明 `{name, variables, resolve(execution)}`，key 冲突 fail loud（`packages/shell/shell-env/src/index.ts:39-145`）。
- 每次模型 shell 调用 `collect(execution)` 重建可信快照；executor 丢弃 ambient `DSH_*` 再注入（`shell-env/src/index.ts:83-87,152-176`）。
- 消费提示：tool-bash 教模型"Current harness environment facts are exposed through managed `$DSH_*` variables; inspect them when needed"（`packages/shell/tool-bash/src/index.ts:77`）。
- **这是"声明所有权 + 逐执行求值"的现成范式**，新 runtime facts 可复用其结构（但注意：它面向 shell env，不面向模型 context 投影）。

---

## 7. Subprocess / Execution World / 宿主进程

### 7.1 Command resolution authority

- `ctx.subprocess.resolveExecutable(command, env?, signal?)`：execution-world 内 executable lookup 的权威。绝对路径验证；裸名按 scrubbed PATH + 显式 env 查找；含分隔符相对路径拒绝（fail loud）（`packages/subprocess/subprocess/src/index.ts:107-122`）。
- 本地实现手写 PATH/PATHEXT 展开 + `stat` + `access(X_OK)`（`packages/subprocess/subprocess-local/src/index.ts:104-144`）。
- 第二个 resolve 模板：`resolvePwshPath`（`packages/shell/pwsh-local/src/resolve.ts:21-79`）。
- **设计含义**：Agent 想知道"某命令解析到哪"的权威来源是 `ctx.subprocess.resolveExecutable`，不是 shell 考古。

### 7.2 Execution world

fs + subprocess 两个 seam 共享一个 execution world 身份（同路径命名空间/可执行/进程/PTY）（`packages/subprocess/subprocess/src/index.ts:81-82`；`.agents/notes/implemented/architecture/2026-07-28-portable-execution-world-consumers.md:17`）。sandbox 不换 world，只做同 world 进程限制（`packages/sandbox/sandbox/src/index.ts:2-4`）。换 world 的范例是 E2B POC（`packages/e2b/`）。

### 7.3 Host port 唯一 owner

`ctx.webServer`（`@deepseek-ai/dsh-host-webserver`）：`{host: '127.0.0.1'|'0.0.0.0', port}`，`get port()` 读实际监听端口（`packages/host/webserver/src/index.ts:73-95,233-236`）。默认 0.0.0.0:3080，CLI `--port` 可改，`--port 0` 让 OS 分配（`packages/bundle/web-app/cordis.patch.yml:134-139`；`startup.ts:46-90`）。connection/apiproxy 只注册路由，不拥有端口（`packages/client/connection/src/index.ts:47,161-195`）。

### 7.4 Host PID / network：无结构化来源（缺口）

- `process.pid` 分散使用（subprocess spill 文件名、windows-acl token、tmux-context 查 tty）。
- `DSH_WEB_URL` 已作为 shell env fact 存在（web-app 注册，`packages/bundle/web-app/src/index.ts:74,243-251`）；LAN 地址由 `networkInterfaces()` 采样（:132-139）。
- GUI `host.describe` 返回 `{version, cwd, provider?, model?, attachedSessions, home, canOpenPath}`——**无 pid、无 port**（`packages/host/apiproxy/src/api/host.ts:47-55`）。
- **结论：OS/arch/host pid/port/network 均无结构化 registry；模型只能经 `$DSH_*` 或 cordis_inspect（只查 cordis 契约，拿不到 port/pid）间接获得。这正是 Runtime Fact Registry 要填的空白。**

---

## 8. 缺口清单（汇总）

### A. Runtime Awareness 缺口

| # | 缺口 | 证据 |
|---|---|---|
| A1 | 无统一 runtime fact 声明/查询；OS/arch/host pid/port/network 无结构化来源 | §7.4；`host.ts:47-55` |
| A2 | 无 model-facing runtime inspect 工具；cordis_inspect 只覆盖 cordis 契约 | §5.5、§7.4；`packages/extensions/tool-cordis/README.md:35-46` |
| A3 | 无 capability-relevance 投影；现有 context 贡献者均无条件（always-on 或手动） | §6.3（sandbox:policy/time-context 均无条件） |
| A4 | "不要猜宿主事实"尚无权威的模型侧行为规则 | tool-bash 只有 `$DSH_*` 提示（§6.4） |
| A5 | 动态事实无 fresh/cache 语义（除 snapshot dedupe 外） | §6.1（RuntimeContextProjection 只做去重） |

### B. User Preference 缺口

| # | 缺口 | 证据 |
|---|---|---|
| B1 | 默认搜索 provider 仍是 composition 字段，非用户偏好 | §5.2（`WebRuntimeConfig.searchProvider`） |
| B2 | 无 fallback（ordering/availability/failure 三态未区分） | §5.3（无 fallback 决策） |
| B3 | exa/perplexity 的 API key 走 config+env，绕过 credentials seam | §4.4 |
| B4 | effective search provider 状态不投影给 Agent | §5.5 |

### 已具备、可复用的资产

- settings substrate 完整（namespace/schema/base/user/watch/redact/UI/wire）——§2。
- credentials seam 完整 + llm 正例——§4。
- 动态 context 投影机制完整（`systemPrompt.context()` + `RuntimeContextProjection`）——§6。
- shell-env contributor registry（声明所有权 + 逐执行求值）——§6.4。
- command resolution 权威（`resolveExecutable`）——§7.1。
- host port 唯一 owner（`ctx.webServer`）——§7.3。
- `cordis_inspect` 的"model-facing narrow report"先例——§8。
