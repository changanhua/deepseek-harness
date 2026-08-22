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

**是，Coding-ready。** 8 项必改全部收敛，V1 范围闭合（baseline 自动投影 ≤4 个 sync fact；provider 状态走 `runtime_inspect`；无 operable；无 async waterfall；无 V1 级 unresolved 设计问题）。R2 的 6 项 unresolved 中 3 项已解决、3 项明确归 V2 observation（见 §9）。

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
