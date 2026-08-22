# Runtime Awareness + User Preference Plane — Implementation File Map（R3）

> 精确文件清单（V1，依据 `implementation-spec.md`）。`NEW` = 新建；`MOD` = 修改。新包遵循仓库标准布局（`packages/AGENTS.md`：tsconfig 继承 `tsconfig.base.json`、`rootDir: src`、`outDir: lib/types`、tests 在包级 `tests/`、`src/types.ts` 只含类型、`./invariant` 导出）。 R2 保留：`tool-runtime-inspect` 移入 **`extensions/`** 组（context 组契约 = 不定义 tool，`packages/context/README.md:5`；tool-cordis 先例，`packages/extensions/README.md:9`）；`runtime-facts-baseline` 更名 **`runtime-facts-host`**；依赖闭包审计（`web.server-url` → `ctx.webServer` 必须列 webserver，`kind=command` → `ctx.subprocess` 必须列 subprocess）。 R3 变更：`runtime-facts` 投影从 async waterfall 改 **sync `systemPrompt.context(order=120)`** contributor（无 waterfall 监听器）；RuntimeFact 三正交维度（evaluation/freshness/exposure）替换 observation+cost；`host.proxy` 拆 5 个 scalar fact；`projectWhen` 回调改声明式 `relevance`；`web` 包不再导出 `web.search-operable`。

## 1. 新增包

### 1.1 `packages/context/runtime-facts` — `@deepseek-ai/dsh-runtime-facts`（Service Definition + registry + sync context contributor）

| 文件 | 内容 |
|---|---|
| `package.json` | 名 `@deepseek-ai/dsh-runtime-facts`；`type: module`；`main: lib/index.js`；`types: lib/types/index.d.ts`；`exports` 含 `.` / `./invariant` / `./src/*`；peerDeps：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-system-prompt`（`systemPrompt.context` 注册 + `AssembleContext`）、`@deepseek-ai/dsh-tools`（`ctx.tools.get` 集中求值 relevance，R2-B2）、`@deepseek-ai/dsh-credentials`（optional，`ctx.get`）、`@deepseek-ai/dsh-invariants`、`@deepseek-ai/schemastery` |
| `tsconfig.json` | 继承 `tsconfig.base.json`；references 到 `system-prompt`、`tools`、`credentials`、`invariants`；注册到 context 所在 aggregate |
| `tsdown.config.ts` | 标准 tsdown 构建（参照 `time-context/tsdown.config.ts`） |
| `src/types.ts` | `RuntimeFactKey`（每段 `^[a-z][a-z0-9-]*$`）、`RuntimeFactEvaluation`（sync/async）、`RuntimeFactFreshness`（static/dynamic）、`RuntimeFactExposure`（baseline/inspect）、`RuntimeFactValue`（scalar）、`RuntimeFactObservationResult`（ok/unknown/unavailable/probe-failure）、`RuntimeFactContext`、`RuntimeFact`（含 `relevance`）、`RuntimeFactInfo`（`implementation-spec.md §2.1`） |
| `src/index.ts` | `RuntimeFacts` Service（`registerFact` / `list` / `inspect`（async）/ `render`（sync））+ `Config` + `ctx.systemPrompt.context({ name: 'runtime-facts', order: 120, text })` **sync contributor**（R3：无 waterfall 监听器；text 内调 `render({ scope })`） |
| `src/visible.ts` | `visible(ctx, relevance)`：声明式 relevance 集中求值（`ctx.get('tools').get(name, scope)`，scope 未定义 → false；R3-3） |
| `src/invariant.ts` | `./invariant`：注册集合 ↔ 渲染结果一致、dispose 后移除、`static` fact 缓存一次 / `dynamic` 每次求值、async fact 不进入 `render()`、async probe 错误 contained |
| `tests/runtime-facts.spec.ts` | key 校验（拒绝 `executionWorld` 等非 kebab）、三正交维度求值、四种结果状态、`relevance` 过滤（经 ctx.tools 集中求值，scope 未定义 → 不投影）、渲染排序、dispose 移除、HMR-safety |
| `tests/runtime-facts.freshness.spec.ts` | `static` 缓存一次；`dynamic` 每次求值（`web.search-selected` 随 preference 变化更新，B5） |
| `tests/runtime-facts.async.spec.ts` | `inspect()` 中 async fact abort → probe-failure；单 fact 失败不影响其他（contained）；async fact 不进 `render()` |
| `tests/runtime-facts.invariant.spec.ts` | invariant 安装 |
| `README.md` | package 契约 + Model Experience（每请求 token 成本、sync 无延迟、KV-cache 无失效） |
| `README.zh.md` / `README.i18n.yaml` | 双语（仓库惯例） |

### 1.2 `packages/context/runtime-facts-host` — `@deepseek-ai/dsh-runtime-facts-host`（Provider，R2-P2 更名）

| 文件 | 内容 |
|---|---|
| `package.json` | 名 `@deepseek-ai/dsh-runtime-facts-host`；peerDeps 增：`@deepseek-ai/dsh-runtime-facts`、`@deepseek-ai/dsh-subprocess`（`runtime.execution-world` 委托）、`@deepseek-ai/dsh-launch-environment`（`host.proxy.*` 快照）、`@deepseek-ai/dsh-home-paths`（可选）、**`@deepseek-ai/dsh-host-webserver`（`web.server-url` → `ctx.webServer`，R2-P3）**、`@deepseek-ai/dsh-shell`（`host.shell`，可选） |
| `tsconfig.json` / `tsdown.config.ts` | 标准；references 到上列包 |
| `src/index.ts` | function plugin：注册 §4 清单 host facts（`host.os`/`host.arch`/`runtime.execution-world` baseline；`host.pid`/`host.shell`/`web.server-url` inspect） |
| `src/proxy.ts` | proxy sanitizer + **5 个 scalar fact 注册**（`host.proxy.configured`/`scheme`/`host`/`port`/`source`，同一 launch-environment 快照派生；R3-2） |
| `src/invariant.ts` | 注册/所有者关系 |
| `tests/*.spec.ts` | 各 fact 求值、owner 委托（webServer/subprocess/launch-environment 缺席回退 unavailable 不炸）、**proxy sanitize 单测（含 `user:pass@`/token/query 剥离；5 个 scalar 各自类型）** |
| `README.md`（+zh/i18n） | 契约 + Model Experience |

### 1.3 `packages/extensions/tool-runtime-inspect` — `@deepseek-ai/dsh-tool-runtime-inspect`（Consumer，R2-P1 移组）

| 文件 | 内容 |
|---|---|
| `package.json` | 名 `@deepseek-ai/dsh-tool-runtime-inspect`；peerDeps：`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-system-prompt`、`@deepseek-ai/dsh-runtime-facts`、**`@deepseek-ai/dsh-subprocess`（`kind=command` → `resolveExecutable`，R2-B3）**、`@deepseek-ai/dsh-credentials`（optional） |
| `tsconfig.json` / `tsdown.config.ts` | 标准；注册到 extensions 所在 aggregate |
| `src/index.ts` | `runtime_inspect` tool（tagged union：`{kind:"facts", keys?}` / `{kind:"command", command}`）+ `systemPrompt.section` 稳定指导 |
| `src/command.ts` | `kind=command` 执行：`ctx.subprocess.resolveExecutable(command, env?, signal)` → structured result `{resolved, world}` / `{status:'unavailable', reason}` |
| `src/invariant.ts` | 工具注册/生命周期 |
| `tests/*.spec.ts` | schema、facts 四态结果（含 async `credential-configured`）、command 解析（resolved / PATH 未命中 unavailable）、secret 不出现在输出、**secret-leak（proxy/`user:pass@`/apiKey 值）** |
| `README.md`（+zh/i18n） | 契约 + Model Experience（固定 schema 成本每请求，`cordis_inspect` 同款） |

## 2. 修改的包

| 包 | 文件 | 改动 |
|---|---|---|
| `packages/web/web` | `src/index.ts` | 增 `WEB_SETTINGS_NAMESPACE`/`WEB_SETTINGS_SCHEMA`；构造内 `installSettingsSection`（base = config + env 同一字段）；`search()`/`fetch()` 改读 `source()`；导出 `web-search.<id>.registered`（sync）与 `web.search-selected`（sync/dynamic/baseline，relevance `web_search`）状态供投影（owner 归 `web` 包，R2-B5）。**不导出 `web.search-operable`**（R3-5：V1 删除） |
| `packages/web/web` | `src/types.ts` | `WebSettingsSection` 类型 |
| `packages/web/web` | `README.md` | 补 settings section、live resolve、状态词语义 |
| `packages/web/web-search-exa` | `src/index.ts` | Config 增 `apiKeyEnv`；注册 `web-search-exa` settings ns；`ctx.credentials.resolve` 每 search；声明 `web-search.exa.local-available`（sync）/`web-search.exa.credential-configured`（async）fact（owner 归 provider 包，V1 `exposure='inspect'`） |
| `packages/web/web-search-exa` | `src/provider.ts` | `ExaSearchProviderOptions` 增 `apiKeyEnv`；`available()` 适配；apiKey deprecate |
| `packages/web/web-search-exa` | `README.md` | apiKeyEnv / credentials / fact 语义；apiKey deprecated（literal precedence） |
| `packages/web/web-search-perplexity` | 同上三文件 | 同上（`perplexity` id） |
| `packages/web/tool-web` | — | 不改 |
| `packages/context/README.md` | — | 包表增 runtime-facts / runtime-facts-host |
| `packages/extensions/README.md` | — | 包表增 tool-runtime-inspect |

## 3. 组成（bundle 挂载）

| 文件 | 改动 |
|---|---|
| `packages/bundle/web-app/cordis.patch.yml` | 增挂 `runtime-facts`、`runtime-facts-host`、`tool-runtime-inspect` 三行（默认进 web profile；baseline token 成本在 Agent Note 论证） |
| `packages/bundle/headless/cordis.patch.yml` | 视评审决定：headless 可只挂 `runtime-facts` + `runtime-facts-host`（无 inspect tool），或不挂；V1 至少 web |

## 4. 文档（docs）

| 文件 | 改动 |
|---|---|
| `docs/subsystems/runtime-facts.md`（NEW） | registry 契约 + 三正交维度 + generated cordis-surface（`pnpm run gen-cordis-catalog`） |
| `docs/subsystems/web.md` | 补 `web` settings section、状态词投影、`apiKeyEnv` 迁移 |
| `docs/architecture.md` | 不改 loop；extension points 表可补 `runtime_inspect` 一行（可选） |
| `docs/config-catalog.md` | 生成重跑（exa/perplexity 的 `apiKeyEnv` 字段入 config-catalog） |
| `docs/tool-catalog.md` | 生成重跑（`runtime_inspect`） |
| `docs/capability-seams.md` / `docs/module-graph.md` | 生成重跑（新包/新 ctx key） |
| `docs/event-producer-consumer.md` | 无新事件，不改 |

## 5. Agent Notes（必须，非平凡架构改动）

| 文件 | 内容 |
|---|---|
| `.agents/notes/implemented/architecture/2026-08-23-runtime-facts-and-user-preference-plane.md`（NEW，+zh/i18n） | Problem / Decision（方案 C、`ctx.runtimeFacts`、sync baseline + async inspect、三正交维度、声明式 relevance、状态词、owner 闭合）/ Alternatives / Consequences（baseline token 预算、dynamic 不缓存、V2 统一 readiness protocol 推迟） |

## 6. 门与校验脚本

- `pnpm run verify-package-invariants` / `verify-package-readme-model-experience` / `verify-package-readme-limitations`
- `pnpm run verify-export-jsdoc` / `doc-typecheck` / `verify-md-links` / `verify-doc-budgets`
- `pnpm run verify-config-source-ownership`（apiKey 迁移不引入内联 secret）
- `pnpm run gen-cordis-catalog` / `gen-tool-catalog` / `gen-doc-graphs` / `gen-module-graph` + `verify-*`
- `pnpm run typecheck` / 目标包 `pnpm run test` / web e2e

## 7. 依赖关系（新增 peerDeps 汇总，R2-P3 dependency closure audit 保留）

| 包 | 新增依赖 | 理由 |
|---|---|---|
| `runtime-facts` | cordis, system-prompt, **tools**, credentials(optional), invariants, schemastery | tools：`ctx.tools.get` 集中求值 relevance（B2/B15，R3-3）；system-prompt：`systemPrompt.context` 注册 |
| `runtime-facts-host` | runtime-facts, **subprocess**, **launch-environment**, **host-webserver**, home-paths(可选), shell(可选) | execution-world 委托 subprocess；proxy 快照 launch-environment；**server-url 委托 `ctx.webServer`（必须列 webserver）** |
| `tool-runtime-inspect` | tools, system-prompt, runtime-facts, **subprocess**, credentials(optional) | **command resolve 走 `ctx.subprocess.resolveExecutable`（必须列 subprocess）** |
| `web`（MOD） | settings, credentials | `installSettingsSection`、`credentialRef` |
| `web-search-exa` / `web-search-perplexity`（MOD） | settings, credentials | 同上 + fact 声明依赖 runtime-facts（optional） |

## 8. 落地顺序对应的文件批次

1. **batch 1（独立）**：`runtime-facts` 全部文件 + `runtime-facts-host` + subsystem 文档 + Agent Note 骨架。
2. **batch 2（B2/B5）**：`web` 的 settings namespace + live resolve + `web/README` 更新。
3. **batch 3（B3/B5）**：`web-search-exa` / `web-search-perplexity` 的 apiKeyEnv + settings + credentials + provider 状态 fact（inspect）。
4. **batch 4（B6/B8/B15）**：`web.search-selected` 派生 fact（web 包）+ capability-visible projection（sync context，relevance 集中求值）。**无 operable**（R3-5）。
5. **batch 5（A2/B3/B16）**：`tool-runtime-inspect`（facts + command）+ bundle 挂载。
6. **batch 6**：全部生成目录重跑、门全绿、e2e、双语 README 补齐。

> 每批独立可评审；batch 4 依赖 batch 1-2，batch 5 依赖 batch 1 + runtime-facts-host 的 subprocess 委托。batch 4 首个集成测试须验证 `ctx.tools.get(name, scope)` 与 context contributor 收到的 `AssembleContext.scope` 一致（R2-CHANGELOG §12-3 的封闭项，R3 收进实现期验证清单）。
