# Runtime Awareness + User Preference Plane — Implementation File Map

> 精确文件清单（V1，依据 `implementation-spec.md`）。`NEW` = 新建；`MOD` = 修改。新包遵循仓库标准布局（`packages/AGENTS.md`：tsconfig 继承 `tsconfig.base.json`、`rootDir: src`、`outDir: lib/types`、tests 在包级 `tests/`、`src/types.ts` 只含类型、`./invariant` 导出）。新包全部属于现有 **context** group，不改 `packages/README.md` 的 group 表；`packages/context/README.md` 的包表需更新。

## 1. 新增包

### 1.1 `packages/context/runtime-facts` — `@deepseek-ai/dsh-runtime-facts`（Service Definition + registry）

| 文件 | 内容 |
|---|---|
| `package.json` | 名 `@deepseek-ai/dsh-runtime-facts`；`type: module`；`main: lib/index.js`；`types: lib/types/index.d.ts`；`exports` 含 `.` / `./invariant` / `./src/*`；peerDeps：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-system-prompt`、`@deepseek-ai/dsh-credentials`（optional 消费，`ctx.get`）、`@deepseek-ai/dsh-invariants`、`@deepseek-ai/schemastery` |
| `tsconfig.json` | 继承 `tsconfig.base.json`；references 到 `system-prompt`、`credentials`、`invariants`；注册到 context 所在 aggregate |
| `tsdown.config.ts` | 标准 tsdown 构建（参照 `time-context/tsdown.config.ts`） |
| `src/types.ts` | `RuntimeFactKey`、`RuntimeFactValue`、`RuntimeFactKind`、`RuntimeFactCost`、`RuntimeFactContext`、`RuntimeFact`、`RuntimeFactInfo`（`implementation-spec.md §2.1`） |
| `src/index.ts` | `RuntimeFacts` Service（`registerFact` / `list` / `inspect` / `render`）+ `Config`（`includeInRuntimeContext`）+ `ctx.inject(['systemPrompt'])` 注册 `context({name:'runtime-facts', order:120, text})` |
| `src/invariant.ts` | `./invariant` 包级不变量：注册集合 ↔ 渲染结果一致、dispose 后移除、static 只求值一次 |
| `tests/runtime-facts.spec.ts` | 冲突 throw、static/dynamic、`projectWhen`、`render` 排序与空值省略、`inspect` 未知 key、dispose 移除、HMR-safety（dispose fiber 后 fact + context 贡献者移除） |
| `tests/runtime-facts.invariant.spec.ts` | invariant 安装 |
| `README.md` | package 契约 + Model Experience（每请求 token 成本、KV-cache 无失效，follow `time-context/README.md` 格式） |
| `README.zh.md` / `README.i18n.yaml` | 双语（仓库惯例） |

### 1.2 `packages/context/runtime-facts-baseline` — `@deepseek-ai/dsh-runtime-facts-baseline`（Provider）

| 文件 | 内容 |
|---|---|
| `package.json` | peerDeps 增 `@deepseek-ai/dsh-subprocess`（execution world 委托）、`@deepseek-ai/dsh-launch-environment`（proxy）、`@deepseek-ai/dsh-home-paths`（DSH_HOME，可选） |
| `tsconfig.json` / `tsdown.config.ts` | 标准 |
| `src/index.ts` | function plugin：向 `ctx.runtimeFacts` 注册 §4 清单的 baseline facts（`host.os`、`host.arch`、`host.pid`、`runtime.executionWorld`、`host.shell`、`host.proxy`、`web.serverUrl`(委托 `ctx.webServer`)） |
| `src/invariant.ts` | 注册/所有者关系 |
| `tests/*.spec.ts` | 各 fact 求值、owner 委托（webServer/subprocess 缺席时回退 undefined 不炸） |
| `README.md`（+zh/i18n） | 契约 |

### 1.3 `packages/context/tool-runtime-inspect` — `@deepseek-ai/dsh-tool-runtime-inspect`（Consumer）

| 文件 | 内容 |
|---|---|
| `package.json` | peerDeps：`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-system-prompt`、`@deepseek-ai/dsh-runtime-facts` |
| `tsconfig.json` / `tsdown.config.ts` | 标准 |
| `src/index.ts` | `runtime_inspect` tool（schema：`{ facts?: string[] }`）+ `systemPrompt.section` 稳定指导 |
| `src/invariant.ts` | 工具注册/生命周期 |
| `tests/*.spec.ts` | schema、执行（baseline + requested + unknown）、secret 不出现在输出 |
| `README.md`（+zh/i18n） | 契约 + Model Experience（固定 schema 成本每请求，`cordis_inspect` 同款） |

## 2. 修改的包

| 包 | 文件 | 改动 |
|---|---|---|
| `packages/web/web` | `src/index.ts` | 增 `WEB_SETTINGS_NAMESPACE` / `WEB_SETTINGS_SCHEMA`；构造内 `installSettingsSection`（base = `{searchProvider, fetchProvider}` + env 同一字段）；`search()`/`fetch()` 改读 `source()`；导出 effective selection（给投影用） |
| `packages/web/web` | `src/types.ts` | `WebSettingsSection` 类型（或并入 index.ts） |
| `packages/web/web` | `README.md` | 补 settings section、live resolve、effective selection 语义 |
| `packages/web/web-search-exa` | `src/index.ts` | Config 增 `apiKeyEnv`；注册 `web-search-exa` settings namespace；`ctx.credentials.resolve` 每 search |
| `packages/web/web-search-exa` | `src/provider.ts` | `ExaSearchProviderOptions` 增 `apiKeyEnv`；`available()` 适配（apiKey 或 apiKeyEnv 有其一） |
| `packages/web/web-search-exa` | `README.md` | apiKeyEnv / credentials / settings 语义；apiKey deprecate |
| `packages/web/web-search-perplexity` | `src/index.ts`、`src/provider.ts`、`README.md` | 同上（`PERPLEXITY_API_KEY`） |
| `packages/web/tool-web` | `src/search.ts`（或不动） | 若 `web.searchEffective` 派生 fact 挂在 web 包（推荐），tool-web 不改 |
| `packages/context/README.md` | — | 包表增三行（runtime-facts / runtime-facts-baseline / tool-runtime-inspect） |

## 3. 组成（bundle 挂载）

| 文件 | 改动 |
|---|---|
| `packages/bundle/web-app/cordis.patch.yml` | 增挂 `runtime-facts`、`runtime-facts-baseline`、`tool-runtime-inspect` 三行（默认进 web profile；baseline 的 token 成本在 Agent Note 论证） |
| `packages/bundle/headless/cordis.patch.yml` | 视评审决定：headless 可只挂 `runtime-facts` + `runtime-facts-baseline`（无 inspect tool，或不挂，V1 至少 web） |

## 4. 文档（docs）

| 文件 | 改动 |
|---|---|
| `docs/subsystems/runtime-facts.md`（NEW） | registry 契约 + generated cordis-surface（`pnpm run gen-cordis-catalog`） |
| `docs/subsystems/web.md` | 补 `web` settings section、effective selection、`web.searchEffective` 投影、apiKeyEnv 迁移 |
| `docs/architecture.md` | 可选：extension points 表加 `runtime_inspect` 一行；若决定不改 loop 则不强制 |
| `docs/config-catalog.md` | 生成重跑（web `web` ns 由 settings 而非 config-catalog；exa/perplexity 的 apiKeyEnv 字段会出现在 config-catalog） |
| `docs/tool-catalog.md` | 生成重跑（`runtime_inspect`） |
| `docs/capability-seams.md` / `docs/module-graph.md` | 生成重跑（新包/新 ctx key） |
| `docs/event-producer-consumer.md` | 若新增事件才改——本设计无新事件，不改 |

## 5. Agent Notes（必须，非平凡架构改动）

| 文件 | 内容 |
|---|---|
| `.agents/notes/implemented/architecture/2026-08-23-runtime-facts-and-user-preference-plane.md`（NEW，+zh/i18n） | Problem / Decision（方案 C、`ctx.runtimeFacts`、capability-visible projection、web settings slice）/ Alternatives / Consequences（含 baseline token 预算、relevance 模型、V2 fallback 推迟） |

## 6. 门与校验脚本（配合改动运行）

- `pnpm run verify-package-invariants`（新包 invariant）
- `pnpm run verify-package-readme-model-experience` / `verify-package-readme-limitations`
- `pnpm run verify-export-jsdoc` / `doc-typecheck` / `verify-md-links` / `verify-doc-budgets`
- `pnpm run verify-config-source-ownership`（确保 web apiKey 迁移不引入内联 secret）
- `pnpm run gen-cordis-catalog` / `gen-tool-catalog` / `gen-doc-graphs` / `gen-module-graph` + `verify-*`
- `pnpm run typecheck` / 目标包 `pnpm run test` / web e2e

## 7. 依赖关系（新增 peerDeps 汇总）

| 包 | 新增依赖 |
|---|---|
| `runtime-facts` | cordis, system-prompt, credentials(optional), invariants, schemastery |
| `runtime-facts-baseline` | runtime-facts, subprocess, launch-environment, home-paths(可选) |
| `tool-runtime-inspect` | tools, system-prompt, runtime-facts |
| `web`（MOD） | settings, credentials（`installSettingsSection`、`credentialRef`） |
| `web-search-exa` / `web-search-perplexity`（MOD） | settings, credentials |

## 8. 落地顺序对应的文件批次

1. **batch 1（独立）**：`runtime-facts` 全部文件 + `runtime-facts-baseline` + subsystem 文档 + Agent Note 骨架。
2. **batch 2（B2/B5）**：`web` 的 settings namespace + live resolve + `web/README` 更新。
3. **batch 3（B3）**：`web-search-exa` / `web-search-perplexity` 的 apiKeyEnv + settings + credentials。
4. **batch 4（B6/B8）**：`web.searchEffective` 派生 fact（web 包）+ `runtime-facts-baseline` 的 provider readiness facts。
5. **batch 5（A2）**：`tool-runtime-inspect` + bundle 挂载。
6. **batch 6**：全部生成目录重跑、门全绿、e2e、双语 README 补齐。

> 每批独立可评审；batch 4 依赖 batch 1-2，batch 5 依赖 batch 1。
