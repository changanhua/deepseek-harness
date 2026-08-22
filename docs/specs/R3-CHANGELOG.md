# R3 Change Log — Runtime Awareness + User Preference Plane

> 对应分支 `docs/runtime-awareness-design`。R2 → R3 的收口修订记录：每个修正点的验证、决策、对文档的影响。R3 仍不落实现代码。 日期：2026-08-23。依据：R3 评审 findings（8 项必改）。

## 0. 保留的 R1/R2 决策（未被 R3 推翻）

| 决策 | R3 结论 |
|---|---|
| settings.yaml 是唯一 user preference file（B1） | **保留**。 |
| `ctx.web` owns 默认 search-provider preference/selection（B2） | **保留**。 |
| `ctx.credentials` owns secret 值（B3） | **保留**；settings 只存 `apiKeyEnv` reference。 |
| 下一次操作看到 settings 更新（B5） | **保留**（live resolve，执行边界快照）。 |
| V1 无 silent fallback（B12） | **保留**。 |
| 不新建 Agent Loop 注入路径（B10） | **保留**；投影走现有 `systemPrompt.context` + `RuntimeContextProjection`。 |
| ONE FACT ONE OWNER（B5 闭合） | **保留**；R3 进一步把可见性求值收进 `RuntimeFacts` 一处。 |
| capability visibility authority = `ctx.tools`（B15） | **保留**；收敛为声明式 `relevance`。 |
| 状态词取代 "ready"（B14） | **保留**。 |
| `runtime_inspect` tagged union + command 走 `resolveExecutable`（B16） | **保留**。 |
| 关键 key 词汇：`runtime.execution-world`/`web.server-url`/`web.search-selected` 等 kebab（R2-B4） | **保留**。 |
| package 组归属：`tool-runtime-inspect`→extensions、`runtime-facts-host` 更名（R2-P1/P2） | **保留**。 |
| 依赖闭包：webserver / subprocess 必须列 peerDeps（R2-P3） | **保留**。 |
| 主示例用仓库已有 provider exa，Tavily 仅 third-party 示例（R2-P4） | **保留**。 |

## 1. R3-1 — observation/freshness 正交维度 + exposure 拆分

**验证**：R2 的 `RuntimeFact` 只有 `observation`（sync/async）+ `cost`（baseline/inspect），且 §6 写死"sync fact 注册时求值缓存"。该规则会冻结 `web.search-selected`（sync 但随 settings 变化）→ 违反 B5 热 reload。

**决策**：RuntimeFact 至少表达三个正交维度：
- `evaluation: 'sync' | 'async'`（怎么求值）。
- `freshness: 'static' | 'dynamic'`（值会不会变；`static` 可缓存一次，`dynamic` 每次求值不得缓存）。
- `exposure: 'baseline' | 'inspect'`（进自动 context / 仅按需查询；语义等于 R2 的 `cost`，更名对齐三列）。

缓存规则从"sync 注册时缓存"改为"`freshness='static'` 缓存一次、`dynamic` 每次求值"。

**文档影响**：implementation-spec（§2.1 类型、§4 词汇表、§5/§6）、architecture-decision（§2/§4/§6）、vertical-slice（§4）、file-map（§1.1/§8）。

## 2. R3-2 — `RuntimeFactValue` 保持 scalar，`host.proxy` 拆 5 个 fact

**验证**：R2 的 `RuntimeFactValue = string | boolean | number`，但 `host.proxy` 的 `resolveSync` 返回 object `{configured,scheme,host,port,source}`——类型冲突，无法通过 typecheck（`ts` 块会被 `doc-typecheck`/真实编译拒绝）。

**决策**：V1 保持 `RuntimeFactValue` 为 scalar（string/boolean/number）。`host.proxy` 拆成 5 个 fact：`host.proxy.configured`（boolean）/ `host.proxy.scheme`（string）/ `host.proxy.host`（string）/ `host.proxy.port`（number）/ `host.proxy.source`（string），由同一 `sanitizeProxy(launchEnv)` 启动快照派生（freshness=static）。sanitize 语义不变（丢弃 user/pass/token/query/path；无法解析 → `configured: false`）。

**文档影响**：implementation-spec（§2.2、§4、§10）、architecture-decision（§2 Ownership Matrix、§5.1、§7 rejected）、vertical-slice（§4/§9 状态表）、file-map（§1.2 `proxy.ts`）。

## 3. R3-3 — `projectWhen` 回调改声明式 `relevance`

**验证**：R2 的 `projectWhen?(context: RuntimeFactContext): boolean` 示例里写 `ctx.get('tools').get('web_search', ctx.scope)`，但 `RuntimeFactContext` 只有 `scope`/`signal`，没有 `get()`——断链成立；且让每个 fact owner 复制可见性逻辑违反"不复制 visibility resolver"。

**决策**：删 `projectWhen` 回调，改声明式 `relevance?: { tools: readonly string[] }`（fact 只声明依赖哪些 capability；缺省 = 无条件投影）。可见性求值统一收进 `RuntimeFacts`（`visible(ctx, relevance)`：`ctx.get('tools').get(name, scope) !== undefined`；scope 未定义 → 保守不投影）。不复制 `ToolRuntime` visibility logic。

**文档影响**：implementation-spec（§2.1 类型、§5/§7）、architecture-decision（B8/B15、§4/§7 rejected）、file-map（§1.1 `visible.ts`、§8）。

## 4. R3-4 — V1 收敛为纯 sync projection，弃用 async waterfall

**验证**：R2 采用 `system-prompt/assemble` async waterfall 投影，理由是"可 await credential describe"。但 R3-5 删除 operable 后，自动投影只剩 `host.*` static + `web.search-selected`（sync dynamic），**没有任何必须 await 的自动 fact**。

**决策**：自动投影改回普通 sync contributor `ctx.systemPrompt.context({ name: 'runtime-facts', order: 120, text })`（`system-prompt/src/index.ts:398`；sandbox `sandbox:policy`=110，order 升序 join）。`text` 是每 assembly 求值的 sync 函数，天然满足 B5 热 reload。async facts（`credential-configured` / `net.reachable`）**不进自动 context**，只在 `runtime_inspect` 的 `inspect()`（async 方法）查询时求值，不在每次 preStep 自动 probe。R2 的 `system-prompt/assemble` waterfall 监听器方案删除。

**文档影响**：architecture-decision（B10/B13、§4、§7 rejected：async waterfall 方案转 rejected）、implementation-spec（§2.1 consumer、§5、§15）、vertical-slice（§0/§7/§8）、file-map（§1.1）。

## 5. R3-5 — 删除 `web.search-operable` 自动 fact

**验证**：`WebSearchProvider` 当前无统一 credential/readiness interface（`available()` 只证明本地可解析）；`WebRuntime` 无法泛化计算 provider-specific credential state；third-party provider 不保证贡献 credential fact；operability 只有实际 operation 最权威。

**决策**：V1 删除 `web.search-operable` 自动 fact。自动 context 只投影 `web.search-selected`。`registered` / `local-available` / `credential-configured` 全部 `exposure='inspect'`，经 `runtime_inspect` 查询。统一 readiness protocol + operable 推迟 V2。模型从实际 `search()` 的 `WebError`（`WEB_PROVIDER_CREDENTIAL_MISSING` 等）知悉失败，不在投影层预判。

**文档影响**：architecture-decision（B6/B7/B12、§2 Matrix、§5.1、§7 rejected 新增 operable 行）、implementation-spec（§1/§4/§7/§15）、vertical-slice（§4/§8/§9）、file-map（§2 web 包）。

## 6. R3-6 — async projection 的 ordering 约束（V2 记录）

**验证**：waterfall 监听器把 context 项 `[...contexts, { name: 'runtime-facts', text }]` 追加到 `assembly.contexts` 尾部，无法实现 order=120（破坏既有顺序），且与 R2 声称的"order 固定"矛盾。

**决策**：R3-4 已弃用 waterfall，V1 无此问题（sync contributor 天然有序）。记录约束：若 V2 恢复 async projection，必须注册 order=120 的 **ordered placeholder**（空 text 的 context 项）后异步替换其 text；waterfall append 方案永久拒绝。

**文档影响**：architecture-decision（§4 V2 备选、§7 rejected）、implementation-spec（§15）。

## 7. R3-7 — secret literal precedence 统一

**决策**：全文统一——`explicit non-empty apiKey`（字面量，deprecated 兼容）> `apiKeyEnv`（经 `ctx.credentials.resolve`）。`apiKey` 字段标记 **deprecated**：新配置只写 `apiKeyEnv`；既有显式 `apiKey` 非空时仍生效（向前兼容）。`.env` 既有 `$EXA_API_KEY` 继续作 credentials-local 环境层。

**文档影响**：implementation-spec（§3.3、§6、§11）、vertical-slice（§6）、file-map（§2 exa/perplexity README 描述）。

## 8. R3-8 — provider id 统一 `deepseek-official`

**验证**：`DEEPSEEK_PROVIDER_ID = 'deepseek-official'`（`packages/web/web-search-deepseek/src/provider.ts:27`）。R2 文档多处把 provider id 写 `deepseek`，与实际注册 id 不符。

**决策**：作为 provider id 的引用一律写 `deepseek-official`（配置注释、状态词、场景示例）；`web-search-deepseek` 包名保留（它是实现包名，不是 provider id）。

**文档影响**：implementation-spec（§3.1 注释）、vertical-slice（§1/§4/§7）、architecture-decision（§2 `search endpoint` 行）。

## 9. R2 遗留 unresolved 项的处理（R3 后状态）

| R2 §12 项 | R3 处理 |
|---|---|
| 1. `operable` 语义强度 | **解决**：R3-5 删除 V1 operable（统一 readiness protocol V2）。 |
| 2. async waterfall 每步延迟 | **解决**：R3-4 弃用 async waterfall（sync projection 无 preStep 延迟）。 |
| 3. `ctx.tools.get` 与 assemble scope 一致性 | **收窄**：可见性求值收进 `RuntimeFacts.visible()` 一处；降为**实现期验证项**（file-map §8 batch 4 首个集成测试），不再是设计级 blocking。 |
| 4. 第三方 provider fact 契约 | **保持 V2**：V1 以 exa/perplexity 内部落地，契约公开化 V2。 |
| 5. `host.proxy` sanitize 覆盖面 | **保持 V2**：V1 只 `HTTP_PROXY`/`HTTPS_PROXY` 拆 5 scalar；`ALL_PROXY`/`no_proxy`/CA 变量 V2。 |
| 6. `net.reachable` probe 定义 | **保持 V2**：V1 仅 inspect、默认不内置。 |

## 10. Coding-ready 判断（R3 后）

> **R3.1 更新**：用户对照源码评审后，指出 R3 的 "Coding-ready=是" 判断过早——还有 3 个真实 Blocking（B1 execution-world 无权威源、B2 web.server-url static 缓存、B3 optional 依赖未闭合）外加 1 个建议删减（`web-search.<id>.registered`）。R3.1 errata（§12）修完后，判定更新为 **Coding-ready=是**。

**R3 收敛时的判断（已被 R3.1 修订）**：8 项必改全部收敛，V1 范围闭合（baseline 自动投影 ≤4 个 sync fact；provider 状态走 `runtime_inspect`；无 operable；无 async waterfall；无 V1 级 unresolved 设计问题）。R2 的 6 项 unresolved 中 3 项已解决、3 项明确归 V2 observation（见 §9）。

实现期封闭验证项（**非 blocking**，batch 落地必测，不阻塞开工）：

1. `ctx.tools.get(name, scope)` 与 `systemPrompt.context` 的 `text` 收到的 `AssembleContext.scope` 完全一致（含 preset 继承链）——batch 4 首个集成测试。
2. `web.search-selected`（dynamic）每次 assembly 求值重新 resolve、不得缓存——B5 热 reload 单测锁定。
3. `host.proxy.*` 5 个 scalar 从同一 launch-environment 快照派生，`RuntimeFactValue` 全 scalar，typecheck 通过。
4. `runtime-facts` 的 `ctx.get('tools')` 在无 tools 服务（如 headless）时 relevance 求值保守不投影（不炸）。

## 11. 文档变更索引（R3）

- `2026-08-23-runtime-awareness-architecture-decision.md`：重写（B6/B10/B13 修订、三正交维度、声明式 relevance、sync baseline + async inspect、§7 rejected 更新）。
- `2026-08-23-runtime-awareness-implementation-spec.md`：重写（三正交维度类型、scalar 约束、relevance、sync context contributor、proxy 拆分、删 operable、secret precedence、deepseek-official）。
- `2026-08-23-runtime-awareness-search-provider-vertical-slice.md`：重写（sync 投影、状态词 exposure 标注、删 operable、secret precedence、deepseek-official）。
- `2026-08-23-runtime-awareness-implementation-file-map.md`：重写（sync contributor、`visible.ts`、`proxy.ts` 5 scalar、web 包删 operable、批次 4 无 operable）。
- `2026-08-23-runtime-awareness-repository-facts.md`：**不改**（证据文档，R3 未引入新仓库事实）。
- 本文件：`R3-CHANGELOG.md`。

## 12. R3.1 errata（用户评审后追加，Coding Agent 视角）

用户对照源码继续往"真写代码会不会卡住"这一层评审，指出 R3 尚有 **3 个真实 Blocking + 1 个建议删减**。全部为局部修订，不需要新一轮大设计。

### R3.1-B1（Blocking）— `runtime.execution-world` / `host.shell` 无权威数据源

**源码验证（全部成立）**：
- `SubprocessRuntime`（`packages/subprocess/subprocess/src/index.ts:102-142`）只有 `resolveExecutable` / `spawn` / `spawnTerminal`，**无 `world`/`kind`/`platform`/`describe()` 自述**。
- `E2BSubprocessRuntime extends SubprocessRuntime`（`packages/e2b/subprocess-e2b/src/index.ts:52`）、`LocalSubprocessRuntime`（`subprocess-local/src/index.ts:37`）均未补标准化 execution-world 属性。
- `ShellExecutor`（`packages/shell/shell/src/index.ts:65-101`）只有 `sandboxMode` / `resolve` / `run` / `start`，**无 `dialect`/`shellName`/`implementation`**。
- 若不做修正，Coding Agent 只能 `instanceof LocalSubprocessRuntime` / `instanceof E2BSubprocessRuntime` / 猜 `process.platform` / 查 plugin name——全部违背 authority / ONE FACT ONE OWNER。

**决策**：
- `SubprocessRuntime` seam 补最小自述：`abstract readonly executionWorld: ExecutionWorldKind`（`'local' | 'remote'`）；`LocalSubprocessRuntime.executionWorld = 'local'`；`E2BSubprocessRuntime.executionWorld = 'remote'`。`runtime.execution-world` 读该字段；`runtime_inspect kind=command` 的 `world` 也用同一字段。未来 `describeExecutionWorld()`（remote backend/platform/arch）V2 不做。
- **`host.shell` 直接删出 V1**：模型已通过可见 Tool（`bash`/`pwsh`）知道自己有哪种 shell；不为单个 inspect fact 改 `ShellExecutor` seam。

**文档影响**：architecture-decision（§2 Matrix、§4、§6、§7 rejected、B11）、implementation-spec（§1/§2.2/§2.3/§4/§6/§8/§12/§14/§15）、file-map（§1.2/§1.3/§2/§7/§8）。

### R3.1-B2（Blocking）— `web.server-url` 不能按 static + 注册时缓存

**源码验证（成立）**：`WebServer` 的 `private listenedPort!: number`（`packages/host/webserver/src/index.ts:86`），`get port()` 返回它（:93-94），而 `listenedPort` 由异步 `Service.init()` 的 `server.listen()` 成功回调才赋值（:233-236）。`port = 0` 时由 OS 动态分配真正端口。若注册时立即 cache，可能缓存 `undefined` / `0` / 错误旧端口。

**决策**：`web.server-url` → `evaluation: sync, freshness: dynamic, exposure: inspect`（读取 getter 近零成本，无需 cache）。同理 `runtime.execution-world` 也改 `dynamic`（subprocess 可热换）。**通用规则：凡值来自另一个可热加载 Service Provider 的 fact 一律 `dynamic`**；V1 真正的 `static` 仅 `host.os` / `host.arch` / `host.pid` / `host.proxy.*`（进程常量 / launch-environment 启动快照）。

**文档影响**：architecture-decision（§2/§4）、implementation-spec（§2.2/§4/§6）、file-map（§1.2）。

### R3.1-B3（Blocking）— Web / Provider → runtimeFacts optional 依赖 + 生命周期未闭合

**源码验证（成立）**：file-map 的 dependency summary 只写"fact 声明依赖 runtime-facts（optional）"文案，依赖表本身没列 `@deepseek-ai/dsh-runtime-facts`；且未明确生命周期，Coding Agent 容易直接 `static inject = ['settings', 'runtimeFacts']` 把 Runtime Awareness 变成 Web 硬依赖。

**决策**：`web` / `web-search-exa` / `web-search-perplexity` 把 `@deepseek-ai/dsh-runtime-facts` 列为 **optional peer/type dependency**，运行时经 `ctx.inject(['runtimeFacts'], cb)` + `effect` disposer 接线（与 `installSettingsSection` 同构，`packages/settings/settings/src/index.ts:870-896`）。生命周期必须测试：without runtimeFacts → Web 完整工作；appears → facts 出现；unloads → disposer 撤回、Web 继续。

**文档影响**：implementation-spec（新增 §2.4、§8、§12）、architecture-decision（§6）、file-map（§2/§7/§8）、vertical-slice（§9）。

### R3.1-B4（建议删减）— `web-search.<id>.registered` 动态 fact

**源码验证（成立）**：`WebSearchProvider.id: string`（`packages/web/web/src/types.ts:102-103`）无 kebab segment grammar 约束。自动生成 `web-search.${provider.id}.registered` 会把第三方合法 id（`foo/v2`、`my.search`、`SearchAPI`）变成 FactKey 冲突，四种处理（改 grammar / escaping / 运行时拒绝 / hardcode）都不漂亮，且 V1 不需要该事实。

**决策**：V1 不注册 `web-search.<id>.registered`。保留 `web.search-selected`（baseline）+ `web-search.<id>.local-available` / `credential-configured`（inspect）。已注册 provider 清单留给 parameterized inspection（`runtime_inspect kind=web-provider`，V2），不动态造 FactKey。

**文档影响**：architecture-decision（§2 Matrix、§5.1、§7 rejected）、implementation-spec（§1/§4/§15）、vertical-slice（§4/§8）、file-map（§2）。

### R3.1 后 Coding-ready 判定

**是，Coding-ready。** 3 个 Blocking + 1 个删减全部闭合，架构主体（settings → domain owner → sync state → registry → relevance projection → Agent；long-tail → runtime_inspect）保持，未引入新设计面。实现期封闭验证项保留 R3 §10 的 4 条 + 新增：`SubprocessRuntime.executionWorld` 三实现值单测、`ctx.inject(['runtimeFacts'])` 三态生命周期测试。
