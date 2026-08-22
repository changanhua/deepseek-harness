# Runtime Awareness + User Preference Plane — Implementation File Map（R2）

> 精确文件清单（V1，依据 `implementation-spec.md`）。`NEW` = 新建；`MOD` = 修改。新包遵循仓库标准布局（`packages/AGENTS.md`：tsconfig 继承 `tsconfig.base.json`、`rootDir: src`、`outDir: lib/types`、tests 在包级 `tests/`、`src/types.ts` 只含类型、`./invariant` 导出）。 R2 变更：`tool-runtime-inspect` 移入 **`extensions/`** 组（context 组契约 = 不定义 tool，`packages/context/README.md:5`；tool-cordis 先例，`packages/extensions/README.md:9`）；`runtime-facts-baseline` 更名 **`runtime-facts-host`**（包承载 host 事实，cost 是 fact 级属性）；依赖闭包审计（`web.server-url` → `ctx.webServer` 必须列 webserver，`kind=command` → `ctx.subprocess` 必须列 subprocess）。

## 1. 新增包

### 1.1 `packages/context/runtime-facts` — `@deepseek-ai/dsh-runtime-facts`（Service Definition + registry + async projection consumer）

| 文件 | 内容 |
|---|---|
| `package.json` | 名 `@deepseek-ai/dsh-runtime-facts`；`type: module`；`main: lib/index.js`；`types: lib/types/index.d.ts`；`exports` 含 `.` / `./invariant` / `./src/*`；peerDeps：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-system-prompt`（`system-prompt/assemble` 事件 + `AssembleContext`）、`@deepseek-ai/dsh-tools`（`ctx.tools.get` 判定可见性，R2-B2）、`@deepseek-ai/dsh-credentials`（optional，`ctx.get`）、`@deepseek-ai/dsh-invariants`、`@deepseek-ai/schemastery` |
| `tsconfig.json` | 继承 `tsconfig.base.json`；references 到 `system-prompt`、`tools`、`credentials`、`invariants`；注册到 context 所在 aggregate |
| `tsdown.config.ts` | 标准 tsdown 构建（参照 `time-context/tsdown.config.ts`） |
| `src/types.ts` | `RuntimeFactKey`（每段 `^[a-z][a-z0-9-]*$`）、`RuntimeFactObservation`（sync/async）、`RuntimeFactCost`、`RuntimeFactValue`、`RuntimeFactObservationResult`（ok/unknown/unavailable/probe-failure）、`RuntimeFactContext`、`RuntimeFact`、`RuntimeFactInfo`（`implementation-spec.md §2.1`） |
| `src/index.ts` | `RuntimeFacts` Service（`registerFact` / `list` / `inspect` / `render`（async））+ `Config` + `ctx.on('system-prompt/assemble', …)` **async waterfall 监听器**（await async facts，替换 `runtime-facts` context 项，order 120） |
| `src/invariant.ts` | `./invariant`：注册集合 ↔ 渲染结果一致、dispose 后移除、sync fact 只求值一次、async probe 错误 contained |
| `tests/runtime-facts.spec.ts` | key 校验（拒绝 `executionWorld` 等非 kebab）、sync/async 观察、四种结果状态、`projectWhen` 过滤（经 ctx.tools）、渲染排序、dispose 移除、HMR-safety |
| `tests/runtime-facts.async.spec.ts` | async fact abort → probe-failure；单 fact 失败不影响其他（contained） |
| `tests/runtime-facts.invariant.spec.ts` | invariant 安装 |
| `README.md` | package 契约 + Model Experience（每请求 token 成本、async waterfall 延迟、KV-cache 无失效） |
| `README.zh.md` / `README.i18n.yaml` | 双语（仓库惯例） |

### 1.2 `packages/context/runtime-facts-host` — `@deepseek-ai/dsh-runtime-facts-host`（Provider，R2-P2 更名）

| 文件 | 内容 |
|---|---|
| `package.json` | 名 `@deepseek-ai/dsh-runtime-facts-host`；peerDeps 增：`@deepseek-ai/dsh-runtime-facts`、`@deepseek-ai/dsh-subprocess`（`runtime.execution-world` 委托）、`@deepseek-ai/dsh-launch-environment`（`host.proxy` 快照）、`@deepseek-ai/dsh-home-paths`（可选）、**`@deepseek-ai/dsh-host-webserver`（`web.server-url` → `ctx.webServer`，R2-P3）**、`@deepseek-ai/dsh-shell`（`host.shell`，可选） |
| `tsconfig.json` / `tsdown.config.ts` | 标准；references 到上列包 |
| `src/index.ts` | function plugin：注册 §4 清单 host facts（`host.os`/`host.arch`/`runtime.execution-world` baseline；`host.pid`/`host.shell`/`host.proxy`(sanitized)/`web.server-url`/`net.reachable`(async, inspect)） |
| `src/sanitize.ts` | proxy URL sanitizer（`{configured,scheme,host,port,source}`，丢弃 user/pass/token/query；R2-B6） |
| `src/invariant.ts` | 注册/所有者关系 |
| `tests/*.spec.ts` | 各 fact 求值、owner 委托（webServer/subprocess/launch-environment 缺席回退 unavailable 不炸）、**proxy sanitize 单测（含 `user:pass@`/token/query 剥离）** |
| `README.md`（+zh/i18n） | 契约 + Model Experience |

### 1.3 `packages/extensions/tool-runtime-inspect` — `@deepseek-ai/dsh-tool-runtime-inspect`（Consumer，R2-P1 移组）

| 文件 | 内容 |
|---|---|
| `package.json` | 名 `@deepseek-ai/dsh-tool-runtime-inspect`；peerDeps：`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-system-prompt`、`@deepseek-ai/dsh-runtime-facts`、**`@deepseek-ai/dsh-subprocess`（`kind=command` → `resolveExecutable`，R2-B3）**、`@deepseek-ai/dsh-credentials`（optional） |
| `tsconfig.json` / `tsdown.config.ts` | 标准；注册到 extensions 所在 aggregate |
| `src/index.ts` | `runtime_inspect` tool（tagged union：`{kind:"facts", keys?}` / `{kind:"command", command}`）+ `systemPrompt.section` 稳定指导 |
| `src/command.ts` | `kind=command` 执行：`ctx.subprocess.resolveExecutable(command, env?, signal)` → structured result `{resolved, world}` / `{status:'unavailable', reason}` |
| `src/invariant.ts` | 工具注册/生命周期 |
| `tests/*.spec.ts` | schema、facts 四态结果、command 解析（resolved / PATH 未命中 unavailable）、secret 不出现在输出、**secret-leak（proxy/`user:pass@`/apiKey 值）** |
| `README.md`（+zh/i18n） | 契约 + Model Experience（固定 schema 成本每请求，`cordis_inspect` 同款） |

## 2. 修改的包

| 包 | 文件 | 改动 |
|---|---|---|
| `packages/web/web` | `src/index.ts` | 增 `WEB_SETTINGS_NAMESPACE`/`WEB_SETTINGS_SCHEMA`；构造内 `installSettingsSection`（base = config + env 同一字段）；`search()`/`fetch()` 改读 `source()`；导出 `web-search.<id>.registered`（sync）、`web.search-selected`（sync）、`web.search-operable`（async）状态供投影（owner 归 `web` 包，R2-B5） |
| `packages/web/web` | `src/types.ts` | `WebSettingsSection` 类型 |
| `packages/web/web` | `README.md` | 补 settings section、live resolve、状态词语义 |
| `packages/web/web-search-exa` | `src/index.ts` | Config 增 `apiKeyEnv`；注册 `web-search-exa` settings ns；`ctx.credentials.resolve` 每 search；声明 `web-search.exa.local-available`（sync）/`web-search.exa.credential-configured`（async）fact（owner 归 provider 包） |
| `packages/web/web-search-exa` | `src/provider.ts` | `ExaSearchProviderOptions` 增 `apiKeyEnv`；`available()` 适配 |
| `packages/web/web-search-exa` | `README.md` | apiKeyEnv / credentials / fact 语义；apiKey deprecate |
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
| `docs/subsystems/runtime-facts.md`（NEW） | registry 契约 + observation 语义 + generated cordis-surface（`pnpm run gen-cordis-catalog`） |
| `docs/subsystems/web.md` | 补 `web` settings section、状态词投影、`apiKeyEnv` 迁移 |
| `docs/architecture.md` | 不改 loop；extension points 表可补 `runtime_inspect` 一行（可选） |
| `docs/config-catalog.md` | 生成重跑（exa/perplexity 的 `apiKeyEnv` 字段入 config-catalog） |
| `docs/tool-catalog.md` | 生成重跑（`runtime_inspect`） |
| `docs/capability-seams.md` / `docs/module-graph.md` | 生成重跑（新包/新 ctx key） |
| `docs/event-producer-consumer.md` | 无新事件，不改 |

## 5. Agent Notes（必须，非平凡架构改动）

| 文件 | 内容 |
|---|---|
| `.agents/notes/implemented/architecture/2026-08-23-runtime-facts-and-user-preference-plane.md`（NEW，+zh/i18n） | Problem / Decision（方案 C、`ctx.runtimeFacts`、async assembly projection、状态词、owner 闭合）/ Alternatives / Consequences（baseline token 预算、async 语义、V2 fallback 推迟） |

## 6. 门与校验脚本

- `pnpm run verify-package-invariants` / `verify-package-readme-model-experience` / `verify-package-readme-limitations`
- `pnpm run verify-export-jsdoc` / `doc-typecheck` / `verify-md-links` / `verify-doc-budgets`
- `pnpm run verify-config-source-ownership`（apiKey 迁移不引入内联 secret）
- `pnpm run gen-cordis-catalog` / `gen-tool-catalog` / `gen-doc-graphs` / `gen-module-graph` + `verify-*`
- `pnpm run typecheck` / 目标包 `pnpm run test` / web e2e

## 7. 依赖关系（新增 peerDeps 汇总，R2-P3 dependency closure audit）

| 包 | 新增依赖 | 理由 |
|---|---|---|
| `runtime-facts` | cordis, system-prompt, **tools**, credentials(optional), invariants, schemastery | tools：`ctx.tools.get` 判定 capability 可见性（B2/B15）；system-prompt：`system-prompt/assemble` waterfall |
| `runtime-facts-host` | runtime-facts, **subprocess**, **launch-environment**, **host-webserver**, home-paths(可选), shell(可选) | execution-world 委托 subprocess；proxy 快照 launch-environment；**server-url 委托 `ctx.webServer`（必须列 webserver）** |
| `tool-runtime-inspect` | tools, system-prompt, runtime-facts, **subprocess**, credentials(optional) | **command resolve 走 `ctx.subprocess.resolveExecutable`（必须列 subprocess）** |
| `web`（MOD） | settings, credentials | `installSettingsSection`、`credentialRef` |
| `web-search-exa` / `web-search-perplexity`（MOD） | settings, credentials | 同上 + fact 声明依赖 runtime-facts（optional） |

## 8. 落地顺序对应的文件批次

1. **batch 1（独立）**：`runtime-facts` 全部文件 + `runtime-facts-host` + subsystem 文档 + Agent Note 骨架。
2. **batch 2（B2/B5）**：`web` 的 settings namespace + live resolve + `web/README` 更新。
3. **batch 3（B3/B5）**：`web-search-exa` / `web-search-perplexity` 的 apiKeyEnv + settings + credentials + provider 状态 fact。
4. **batch 4（B6/B8/B15）**：`web.search-selected`/`operable` 派生 fact（web 包）+ capability-visible projection（async waterfall）。
5. **batch 5（A2/B3/B16）**：`tool-runtime-inspect`（facts + command）+ bundle 挂载。
6. **batch 6**：全部生成目录重跑、门全绿、e2e、双语 README 补齐。

> 每批独立可评审；batch 4 依赖 batch 1-2，batch 5 依赖 batch 1 + runtime-facts-host 的 subprocess 委托。
