# R2 Change Log — Runtime Awareness + User Preference Plane

> 对应分支 `docs/runtime-awareness-design`。R1 → R2 的修订记录：每个 finding 的仓库验证结果、决策、对文档的影响。R2 仍不落实现代码。 日期：2026-08-23。依据：R2 评审 findings（B1–B6、P1–P4）+ 额外要求。

## 0. 保留的 R1 决策（未被新事实推翻）

| R1 决策 | R2 结论 |
|---|---|
| settings.yaml 是唯一 user preference file（B1） | **保留**（无冲突事实）。 |
| `ctx.web` owns 默认 search-provider preference/selection（B2） | **保留**（selection 语义 owner 不变）。 |
| `ctx.credentials` owns secret 值（B3） | **保留**（settings 只存 `apiKeyEnv` reference）。 |
| 下一次操作看到 settings 更新（B5） | **保留**（live resolve，执行边界快照）。 |
| V1 无 silent fallback（B12） | **保留**（仓库"绝不静默换 provider"决策，`2026-06-24-web-capability-seam.md:32-37`）。 |
| 不新建 Agent Loop 注入路径（B10） | **保留并强化**：projection 走现有 `system-prompt/assemble` async waterfall + `RuntimeContextProjection`，不改 loop、不新增 session event。 |
| ONE FACT ONE OWNER | **保留并闭合**（R2-B5）。 |

## 1. R2-B1 — readiness async/sync mismatch → 采纳 async assembly projection + 状态词

**仓库验证（全部成立）**：
- `WebSearchProvider.available(): boolean` 是 cheap local sync 检查、禁止 network（`packages/web/web/src/types.ts:102-108`）。
- `ctx.credentials.resolve/describe` 是 **async**（`docs/subsystems/credentials.md:140`）。
- `systemPrompt.context().text` 是 sync 函数（`packages/core/system-prompt/src/index.ts:77-85,527`）。
- **`system-prompt/assemble` waterfall 是 async**，返回权威 assembly（`index.ts:532-535`）；agent-loop `preStep` 已 `await assemble()`（`packages/core/agent-loop/src/agent.ts:230`）。
- web-search-deepseek 的 `available()` 只证明 resolver 存在（`packages/web/web-search-deepseek/src/provider.ts:189-191`），credential 缺失在 `search()` 才 `WEB_PROVIDER_CREDENTIAL_MISSING`（:283,298）。

**决策**：projection 从"纯 sync `systemPrompt.context()`"改为"**`system-prompt/assemble` async waterfall** 消费"。不改 Agent Loop、不新建注入路径、`RuntimeContextProjection` 不变；可以 await credential describe / async probe；model-visible 仍 logged。

**状态词**（取代 ready）：`registered` / `locally-available` / `selected` / `credential-configured` / `reachable` / `operable`。Preference / Selection / Readiness / Operability 分离。

**文档影响**：architecture-decision（§0 B6/B13/B14、§2、§4、§5）、implementation-spec（§2.1 observation 语义、§2.2、§5）、vertical-slice（§4、§7、§8）、repository-facts（§5.4.1、§6.1）。

## 2. R2-B2 — capability visibility authority = ctx.tools

**仓库验证（成立）**：`ToolRuntime.get(name, scope?)` / `schemas(scope?)` / `restrict(filter)` / `view(scope)` 是可见工具集合唯一来源（`packages/core/tools/src/index.ts:1152-1236`，含 inherited + scoped own + restrictions + reserved transport）。`ctx.systemPrompt` 是 prompt assembly owner，非 visibility resolver。

**决策**：删除草案中的 `runtimeFacts.visibleCapabilities()`；fact owner 经 `ctx.tools.get(name, scope)` 判定可见性；不复制 visibility resolver。

**文档影响**：architecture-decision（B8/B15、§4、§7 rejected）、implementation-spec（§2.1、§5、§7）、repository-facts（新增 §6.4）。

## 3. R2-B3 — runtime_inspect command query 断链修复

**仓库验证（成立）**：command resolution authority = `ctx.subprocess.resolveExecutable`（`packages/subprocess/subprocess/src/index.ts:107-122`）；R1 的 tool schema 只有 `{facts?: string[]}`、file-map 无 subprocess 依赖——断链成立。

**决策**：`runtime_inspect` 用 **tagged union** `{kind:"facts", keys?}` / `{kind:"command", command}`；command 是 **parameterized inspector**（非 fact key，禁止 per-command 预注册 fact）；`kind=command` → `resolveExecutable` → structured result `{resolved, world}` / `{status:'unavailable', reason}`。

**文档影响**：implementation-spec（§2.3、§12 tests）、architecture-decision（B16）、file-map（§1.3 subprocess 依赖）。

## 4. R2-B4 — fact key vocabulary 统一

**决策**：`RuntimeFactKey` 每段 `^[a-z][a-z0-9-]*$`、段以 `.` 分隔，机械校验。改 `runtime.execution-world` / `web.server-url` / `web.search-selected` / `web.search-operable` / `web-search.exa.credential-configured` 等（R1 的 `executionWorld`/`serverUrl`/`credentialConfigured`/`searchEffective` 已废弃）。

**文档影响**：全部 5 份（词汇表、样例、matrices 统一）。

## 5. R2-B5 — ONE FACT ONE OWNER 闭合

**决策**：provider 专属状态（`web-search.<id>.local-available`、`web-search.<id>.credential-configured`）owner = **各 provider 包**（它们知道自身配置与 `apiKeyEnv` ref）；selection/effective（`web.search-selected`、`web.search-operable`）owner = **`web` 包（WebRuntime）**；`web-search.<id>.registered` owner = `web` 包（注册表）。不留"web 包或各 provider"二选一。

**文档影响**：architecture-decision（§2）、implementation-spec（§4）、vertical-slice（§8）、file-map（§2）。

## 6. R2-B6 — proxy secret safety

**决策**：`host.proxy` 永不投影 raw URL（可含 user/pass/token/query）。只投影 sanitized `{configured, scheme, host, port, source}`；sanitize 丢弃凭据段/query/path；无法解析 → `configured: false`。新增 **secret-leak tests**（输出不含 `user:pass@`、不含 apiKey 值、不含 proxy raw URL）。

**文档影响**：implementation-spec（§2.2 sanitize、§10、§12）、architecture-decision（§2 Secret 列）、file-map（§1.2 sanitize.ts）。

## 7. R2-P1 — package group correction

**仓库验证（成立）**：`context/` 组契约 = "request-context extensions WITHOUT defining a tool"（`packages/context/README.md:5`）；`extensions/` 组有 tool-cordis（model-facing runtime inspection tool）先例（`packages/extensions/README.md:9`）。

**决策**：`tool-runtime-inspect` 移入 **`packages/extensions/`**。

**文档影响**：file-map（§1.3）、implementation-spec（§1）、repository-facts（§1 新增 group 契约）。

## 8. R2-P2 — baseline naming

**决策**：`runtime-facts-baseline` 更名 **`runtime-facts-host`**——包承载"宿主事实"（baseline + inspect 都有），包名不再声称仅 baseline；cost 是 fact 级属性（`baseline` / `inspect`）。

**文档影响**：全部 5 份（包名统一）。

## 9. R2-P3 — dependency closure audit

**验证并修正**：`web.server-url` → 委托 `ctx.webServer.port`，`runtime-facts-host` **必须列 `@deepseek-ai/dsh-host-webserver`**（R1 遗漏）；`kind=command` → `ctx.subprocess`，`tool-runtime-inspect` **必须列 `@deepseek-ai/dsh-subprocess`**；`runtime-facts` 需 `@deepseek-ai/dsh-tools`（可见性判定）。全依赖闭包见 file-map §7。

**文档影响**：file-map（§7）。

## 10. R2-P4 — executable vertical slice

**决策**：主示例改用仓库已有 provider **exa**（perplexity/deepseek 并列）；**Tavily 仅作 third-party 扩展示例，明确 V1 不实现 Tavily provider**。

**文档影响**：vertical-slice（全篇）、implementation-spec（§3）、architecture-decision（§5）。

## 11. 新增 Blocking Questions（B13–B16）

| # | 问题 | 结论 |
|---|---|---|
| B13 | Runtime Fact projection 是否需要 async？ | **部分需要**。`registered`/`locally-available`/`selected` sync；`credential-configured`/`reachable` async。采用 `system-prompt/assemble` async waterfall（不改 loop）。 |
| B14 | "ready" 在 DSH 中的正式定义？ | **不引入**。`available()` 只证明本地可解析；用状态词表替代 ready。 |
| B15 | capability visibility 唯一 authority？ | **`ctx.tools`**（get/schemas/restrict/view）。 |
| B16 | parameterized inspection 是否属于 Fact Registry？ | **部分**：command 是 registry 的 inspect 能力（tagged union），但不是 fact key。 |

## 12. 未解决 Blocking Issues（显式列出，评审需关注）

1. **projection 的 `operable` 语义强度**：`operable` 仅在操作边界权威（`search()` 执行时）；projection 值 = "当前可判定为具备执行前提"，不保证下一次调用成功（网络/API 失败仍可能）。V1 用保守措辞（`operable: true/false` + `unavailable` reason），但"模型是否会过度信任 operable"需真实使用数据验证——**V2 观察项**。
2. **async waterfall 的每步延迟**：`system-prompt/assemble` 的 waterfall 监听器内 await async facts 会加入每一步 `preStep` 延迟（credential describe 通常本地、快，但无上限）。七项语义已约束错误/取消，**每步延迟的实测与可选 freshness 缓存是 V2 实现项**。
3. **`ctx.tools.get` 与 assemble scope 的一致性**：`AssembleContext.scope` = agent（`dispatch.ts:174-175`）已确认；实现时须验证 runtimeFacts 全局 waterfall 监听器拿到的 scope 与 `ctx.tools.get(name, scope)` 的 scope 语义完全一致（含 preset 继承链）。
4. **第三方 provider 贡献 fact 的最小契约**：provider 插件声明 `local-available`/`credential-configured` fact 的 API 形态（直接 `registerFact` vs 辅助 helper）需在实现 batch 3 定稿；V1 先以 web-search-exa/perplexity 内部落地，**契约公开化推迟 V2**。
5. **`host.proxy` sanitize 覆盖面**：V1 只处理 `HTTP_PROXY`/`HTTPS_PROXY` → `{configured,scheme,host,port,source}`；`ALL_PROXY`、`no_proxy`、带凭据的 CA 变量等策略**推迟 V2**。
6. **`net.reachable` 的 probe 定义**：探什么端点、超时、TTL 未定；V1 仅 inspect、默认不内置，**V2**。

## 13. 文档变更索引（R2）

- `2026-08-23-runtime-awareness-repository-facts.md`：补 R2 证据（§5.4.1、§6.1 async、§6.4 ctx.tools、§1 group 契约）。
- `2026-08-23-runtime-awareness-architecture-decision.md`：重写（B1–B16、状态词、ownership matrix 闭合、async projection、rejected 新增）。
- `2026-08-23-runtime-awareness-implementation-spec.md`：重写（observation 语义、async projection、key 词汇、proxy sanitize、runtime_inspect tagged union、ctx.tools relevance）。
- `2026-08-23-runtime-awareness-search-provider-vertical-slice.md`：重写（exa 示例、状态词、async 影响）。
- `2026-08-23-runtime-awareness-implementation-file-map.md`：重写（extensions 组、runtime-facts-host、dependency audit）。
- 本文件：`R2-CHANGELOG.md`。
