# Runtime Awareness + User Preference Plane — Implementation Spec

> 决策依据：`architecture-decision.md`（B1–B12、Ownership Matrix、方案 C 收敛）。现状盘点：`repository-facts.md`。V1 目标：Agent 不猜宿主事实；用户有稳定位置表达长期 capability preference 且 Agent 知道当前真正生效的结果。不造万能配置平台，不做 Doctor。

## 1. Package / File Changes（总览）

### 新增包（3 个）

| 包 | 角色 | ctx key / 产物 |
|---|---|---|
| `packages/context/runtime-facts` | Runtime Fact registry（Service Definition + built-in baseline facts） | `ctx.runtimeFacts` |
| `packages/context/runtime-facts-baseline` | baseline facts provider（OS/arch/pid/…，owner 委托各域） | 注册到 `ctx.runtimeFacts` |
| `packages/context/tool-runtime-inspect` | model-facing `runtime_inspect` tool（Consumer） | 注册到 `ctx.tools` |

> 备选：`runtime-facts-baseline` 可并入 `runtime-facts` 包（若想少一个包）。本文按三包列，基线 provider 拆分理由：OS/arch 是 registry 自带的"自身事实"，host pid/port/network 是宿主侧事实（owner 不同），拆分让 owner 边界显式。

### 修改的包（4 个）

| 包 | 改动 |
|---|---|
| `packages/web/web` | 注册 `web` settings namespace；`searchProvider`/`fetchProvider` 改为 live resolve（`installSettingsSection`）；导出 effective selection 给投影 |
| `packages/web/web-search-exa` | 增加 `apiKeyEnv` + settings namespace，走 `ctx.credentials`；`apiKey` 保留为 `role('secret')` 兼容 |
| `packages/web/web-search-perplexity` | 同上 |
| `packages/web/tool-web` | 不改（effective 派生 fact `web.searchEffective` 挂在 web 包，因为 selection 由 `WebRuntime` 计算；tool-web 保持只调 `ctx.web.search`） |

### 新增/修改文档

- `docs/subsystems/runtime-facts.md`（新，含 generated cordis-surface）
- `docs/subsystems/web.md`（补 settings section 描述，生成区自动）
- `packages/context/runtime-facts/README.md`、`tool-runtime-inspect/README.md`（新）
- `packages/web/web/README.md`、`web-search-exa/README.md`、`web-search-perplexity/README.md`（改）
- `docs/config-catalog.md` / `docs/tool-catalog.md` / `docs/capability-seams.md`（生成，随代码重跑）
- Agent Note（新，见 §11）

## 2. Service Definition / Provider / Consumer

### 2.1 `ctx.runtimeFacts` — Service Definition（`packages/context/runtime-facts`）

```ts ignore-check
// packages/context/runtime-facts/src/types.ts
/** 一个 runtime fact 的稳定名。品牌类型：构造校验小写 kebab（段以 '.' 分隔）。 */
type RuntimeFactKey = Branded<'RuntimeFactKey'>

/** fact 值：简单标量。secret 永不出现。 */
type RuntimeFactValue = string | boolean | number

/** fact 分类：static = 启动即定；dynamic = 每次求值。 */
type RuntimeFactKind = 'static' | 'dynamic'
/** cost：baseline = 进 runtime context（cheap）；inspect = 仅按需查询（可能昂贵）。 */
type RuntimeFactCost = 'baseline' | 'inspect'

/** 一次投影/查询的求值上下文。与 systemPrompt AssembleContext 对齐，V1 只带 scope/agent。 */
interface RuntimeFactContext {
  /** 当前 agent scope（agent 级投影时）。 */
  readonly scope?: ScopeKey
  /** 可选信号。 */
  readonly signal?: AbortSignal
}

/** 一个 runtime fact 的声明。注册是 effect；owner 冲突 fail loud。 */
interface RuntimeFact {
  /** 稳定名，如 'host.os'。另一 owner 声明同名 → throw。 */
  readonly key: RuntimeFactKey
  /** 声明者名字，用于诊断与冲突归属。 */
  readonly owner: string
  /** 模型可见的一句话描述（runtime_inspect 列表与诊断用）。 */
  readonly description: string
  readonly kind: RuntimeFactKind
  readonly cost: RuntimeFactCost
  /** 求值。static 在注册时求一次并缓存；dynamic 每次调用。undefined = 当前不可得（不投影、不报错）。 */
  resolve(context: RuntimeFactContext): RuntimeFactValue | undefined
  /**
   * 是否投影进 runtime context。缺省：cost === 'baseline'。
   * owner 自判（可闭包捕获自身 capability 的可见性——这正是 B8 的实现点，见 §7）。
   */
  projectWhen?(context: RuntimeFactContext): boolean
}

/** 枚举声明，供 UI/诊断/inspect 列表（不执行 resolve）。 */
interface RuntimeFactInfo {
  readonly key: RuntimeFactKey
  readonly owner: string
  readonly description: string
  readonly kind: RuntimeFactKind
  readonly cost: RuntimeFactCost
}
```

```ts ignore-check
// packages/context/runtime-facts/src/index.ts
export class RuntimeFacts extends Service {
  static Config: z<Config> = z.object({
    /** 是否把 baseline facts 投影进 runtime context（默认 true）。 */
    includeInRuntimeContext: z.boolean().default(true),
  })

  /** 注册一个 fact。重复 key / 空 key / 空描述 → throw。返回 fiber effect disposer。 */
  registerFact(fact: RuntimeFact): () => void
  /** 枚举已注册 facts（不执行 resolve）。 */
  list(): RuntimeFactInfo[]
  /** 求值指定 facts（runtime_inspect 走这里；dynamic 求值、static 走缓存）。未知 key → undefined。 */
  inspect(keys: readonly RuntimeFactKey[], context?: RuntimeFactContext): Promise<Record<string, RuntimeFactValue | undefined>>
  /** 求值当前应投影的 facts 并渲染为模型可见文本（由 systemPrompt.context 贡献者调用）。空 → ''。 */
  render(context: RuntimeFactContext): string
}
```

构造时向 `ctx.systemPrompt` 注册一个 context 贡献者：

```ts ignore-check
ctx.inject(['systemPrompt'], (scope) => {
  scope.systemPrompt.context({
    name: 'runtime-facts',
    order: 120, // sandbox:policy 之后
    text: (assembleCtx) => this.render({ scope: assembleCtx.scope, signal: assembleCtx.signal }),
  })
})
```

> 命名与 `ctx.runtimeFacts`：不叫 `ctx.runtime`，因为"runtime"在仓库里已被 `subprocess`/`execution world` 语境占用，`runtimeFacts` 明示"事实注册表"。投影不新建注入路径，完全走 `systemPrompt.context()` + `RuntimeContextProjection`（`packages/core/agent-loop/src/runtime-context.ts`），不改 agent-loop。

### 2.2 Provider — baseline facts（`runtime-facts-baseline`）

```ts ignore-check
// 注册样例（owner 委托各域，避免重复实现探测）
registry.registerFact({
  key: factKey('host.os'),
  owner: 'runtime-facts-baseline',
  description: 'Operating system of the host process.',
  kind: 'static',
  cost: 'baseline',
  resolve: () => normalizeOs(process.platform), // win32/linux/darwin/…
})
registry.registerFact({
  key: factKey('host.arch'),
  owner: 'runtime-facts-baseline',
  description: 'CPU architecture of the host process.',
  kind: 'static',
  cost: 'baseline',
  resolve: () => process.arch,
})
registry.registerFact({
  key: factKey('host.pid'),
  owner: 'runtime-facts-baseline',
  description: 'Process id of the DSH host process.',
  kind: 'static',
  cost: 'inspect',
  resolve: () => process.pid,
})
```

- **复用既有 owner 而非重复探测**：execution world 事实（`runtime.executionWorld`）委托 subprocess provider（`ctx.subprocess` 存在且 `available` 即 local；E2B 即 remote），不自己猜；sandbox mode / workspace root 不注册（已有 `sandbox:policy` 投影，`repository-facts.md §6.3`）；session cwd 不注册（SessionHeader 所有，sandbox:policy 已投影）；command resolution 不注册，由 `runtime_inspect` 调 `ctx.subprocess.resolveExecutable`（`repository-facts.md §7.1`）。

### 2.3 Consumer — `runtime_inspect` tool（`tool-runtime-inspect`）

Model-facing schema（与 cordis_inspect 的 narrow-report 先例同风格）：

```jsonc
// runtime_inspect
{
  "facts": ["web-search.tavily.available"]  // 可选；省略 = baseline + 列表
}
```

执行：`registry.inspect(keys)` 求值；返回：

```text
Host facts:
- host.os: win32
- host.arch: x64

Requested:
- web-search.tavily.available: true
- web-search.tavily.credentialConfigured: true
```

- 只暴露安全事实；secret 永不出现（`apiKeyEnv` 只回 `configured`）。
- 未知 key 回 `undefined`（缺省列出所有可查询 key，避免模型瞎猜）。
- 昂贵 probe（network reachability）在此执行；V1 不做跨调用缓存/TTL（V2：per-fact TTL）。
- 注册到 `ctx.tools` + 一条 `systemPrompt.section` 稳定指导："Use runtime_inspect to query authoritative host/runtime facts instead of guessing environment details."

## 3. Settings Schema（Web Preference）

### 3.1 `web` namespace（owner：`WebRuntime`）

```yaml
# $DSH_HOME/settings.yaml —— 用户编辑入口
web:
  searchProvider: tavily      # 用户偏好：默认搜索 provider
  fetchProvider: http         # 用户偏好：默认 fetch provider
```

```ts ignore-check
// packages/web/web/src/index.ts
export const WEB_SETTINGS_NAMESPACE = settingsNamespace('web')
export const WEB_SETTINGS_SCHEMA: z<WebSettingsSection> = z.object({
  searchProvider: z.string(),
  fetchProvider: z.string(),
})
```

### 3.2 接线（`installSettingsSection`，与 agent-default-model 同构）

```ts ignore-check
// WebRuntime 构造内
const entry: WebSettingsSection = {
  searchProvider: config.searchProvider ?? process.env.DSH_WEB_SEARCH_PROVIDER,
  fetchProvider: config.fetchProvider ?? process.env.DSH_WEB_FETCH_PROVIDER,
}
let source: () => WebSettingsSection = () => entry
installSettingsSection(ctx, WEB_SETTINGS_NAMESPACE, WEB_SETTINGS_SCHEMA, entry, {
  setSource: (next) => { source = next },
  onChange: () => {},
})
```

- **precedence**：schema 缺省（无）→ composition `base`（cordis.yml 的 `searchProvider`/`fetchProvider` + 同一字段的 env 覆盖）→ user 层（settings.yaml）。与仓库"operational overrides feed the SAME fields"决策一致（`packages/web/web/src/index.ts:76-93`），不引入隐藏优先级链。
- **live resolve**：`search()` / `fetch()` 每次读 `source()`（而不是构造期 `this.searchProviderId`），传给 `resolveProvider()`。B5：热改 settings.yaml 后下一次调用生效。
- **不需要**：重注册 tool、改 tool schema、改 system prompt。`applies: 'live'`（缺省）。

### 3.3 provider 内部配置（exa / perplexity 迁移）

- `web-search-exa`：Config 增 `apiKeyEnv?: string`（默认 `EXA_API_KEY`）；`apiKey` 保留（`role('secret')`）但优先用 `apiKeyEnv` 经 `ctx.credentials.resolve`（每 search 一次）。注册 `web-search-exa` settings namespace（schema 含 `apiKeyEnv`/`baseURL`/`searchType`/…，web-search-deepseek 同构）。
- `web-search-perplexity`：同上（`PERPLEXITY_API_KEY`）。
- **兼容**：`apiKey` 显式设置时仍生效（非空 wins）；`.env` 里的 `$EXA_API_KEY` 继续作为 credentials 兜底层（credentials-local 四层中的 user/project env），不破坏现状。

## 4. Runtime Fact Vocabulary（V1 清单）

| key | owner | kind | cost | 值示例 | 来源 |
|---|---|---|---|---|---|
| `host.os` | runtime-facts-baseline | static | baseline | `win32` | `process.platform` |
| `host.arch` | runtime-facts-baseline | static | baseline | `x64` | `process.arch` |
| `runtime.executionWorld` | runtime-facts-baseline | dynamic | baseline | `local` | 委托 `ctx.subprocess`（E2B → `remote`） |
| `host.pid` | runtime-facts-baseline | static | inspect | `12345` | `process.pid` |
| `web.serverUrl` | web-app bundle | dynamic | inspect | `http://127.0.0.1:3080` | 委托 `ctx.webServer.port`（`repository-facts.md §7.3`） |
| `host.shell` | runtime-facts-baseline | dynamic | inspect | `pwsh`/`bash` | 委托 execution world / shell provider 自述 |
| `host.proxy` | runtime-facts-baseline | static | inspect | `http://…` | launch-environment 快照（继承 env 的 proxy 变量） |
| `web-search.<id>.available` | web 包或各 provider | dynamic | baseline | `true` | `provider.available()` 委托 |
| `web-search.<id>.credentialConfigured` | web 包或各 provider | dynamic | baseline | `true` | `credentials.describe(ref).configured`（安全事实） |
| `net.reachability` | runtime-facts-baseline | dynamic | inspect | `true` | inspect 时 probe（V1 可选，默认不内置） |

> 禁止注册：sandbox mode / workspace root（sandbox-policy 已投影）、session cwd（SessionHeader）、`DSH_HOME`（shell-env 已有）、command resolution（inspect 走 `resolveExecutable`）。违反即"重复 owner"。

## 5. Context Projection Algorithm

**输入**：当前 assembly 的 scope + signal（`systemPrompt.context()` text 函数提供）。**步骤**（每次模型请求前，`systemPrompt.assemble()` 求值 `runtime-facts` 贡献者）：

1. `registry.render(ctx)`：
   - 遍历 `list()`，过滤 `projectWhen === undefined ? cost === 'baseline' : projectWhen(ctx)`。
   - 对每个命中的 fact 调 `resolve(ctx)`（dynamic 每次；static 用注册时缓存）。
   - 值非 `undefined` 且非空串 → 收集。
2. 渲染（确定性顺序，按 key 排序）：
   ```text
   Host runtime facts:
   - host.os: win32
   - host.arch: x64
   - runtime.executionWorld: local
   - web-search.tavily.available: true
   - web-search.tavily.credentialConfigured: true
   ```
   无命中 → 空串（context 贡献者空文本不产生贡献，`packages/core/system-prompt/src/index.ts:251-255`）。
3. `RuntimeContextProjection` 照常：文本变化才注入新 `user/message` snapshot；replacement 时发 CLEARED；replay 从 log 恢复（`packages/core/agent-loop/src/runtime-context.ts`）。**token 控制**：baseline 恒短（~5 行）；长尾走 `runtime_inspect`；capability-scoped 只在命中时加行。

**token 膨胀防护**：V1 baseline 严格 ≤6 个 fact；任何新 baseline fact 必须在 Agent Note 里论证 token 成本；超预算走 inspect。

## 6. Precedence / Ownership Rules

1. ONE FACT ONE OWNER：`registerFact` 同名 key 第二次 → `throw`（fail loud at load，与 shell-env keyOwners 同风格，`packages/shell/shell-env/src/index.ts:131-134`）。
2. 已有 owner 的事实不重复探测：§4 的"禁止注册"清单即约束（以 `repository-facts.md` 的 owner 表为准）。
3. 配置 precedence 保持仓库既定单一顺序（B4），不发明新层。
4. Secret 永不进 settings / fact 值 / prompt；只允许 `credentialConfigured` 安全事实（B3）。
5. Preset/Mode 只经 `projectWhen`/scope 影响 relevance，不改 fact 值（B9）。
6. 静态 fact 注册时求值缓存；动态 fact 每次求值；无自动过期（V1）。

## 7. Capability-Visible Projection（B6/B8 实现）

**原则**：`runtimeFacts` 保持 capability-neutral（不盘点能力、不枚举缺失），事实的"该不该投影"由 **fact owner 自判**（`projectWhen`）。

- `web-search.<id>.available` / `credentialConfigured` 的 owner 是 web 包（provider selection 的所有者）。它在 `projectWhen` 里检查"`web_search`/`web_fetch` 工具当前可见"——owner（web 包）通过 `ctx.get('systemPrompt')` 的 tool providers 或自身注册状态判断；V1 提供 `runtimeFacts` 一个 helper `visibleCapabilities()`（封装对 `ctx.systemPrompt` 已收集工具名的只读查询，owner 可选使用）。
- 投影到 Agent 的 effective state（B6）：由 web 包声明一个派生 fact `web.searchEffective`（kind dynamic / cost baseline / projectWhen = web_search 可见）：
  ```
  - web.searchEffective: Tavily (ready)
  ```
  值来源：`WebRuntime.resolveProvider()` 的 selection 结果（成功 → `Provider <id> (ready)`；失败 → `unavailable: <WebError code>`）。**不持久**（派生值，§2 Ownership Matrix 的 active search provider 行）。
- 现成无条件的 `sandbox:policy` 保持不变（baseline，恒投影）。

## 8. Lifecycle / Hot Reload

| 事件 | 行为 |
|---|---|
| 插件 mount / `registerFact` | effect 注册；`ctx.runtimeFacts` 的 context 贡献者随 fiber dispose 移除（`systemPrompt.context()` 返回 disposer）。 |
| HMR / 插件 reload | 注册的 facts 随 fiber 移除；用户 settings 里的 namespace 留在存储给下一 owner（settings seam 语义，`packages/settings/settings/src/index.ts:863-897`）。 |
| settings.yaml 外部编辑 | watcher 热发布 → `settings/updated` → WebRuntime `setSource` 更新 → 下一次 `search`/`fetch` 生效（B5）。若该变化改变 `web.searchEffective` 的渲染，下一次 assembly 的 snapshot 变化 → `RuntimeContextProjection` 注入新 snapshot。 |
| settings 写入失败 / 非法 | settings-file warn-and-keep-last-good（`repository-facts.md §2.3`）；WebRuntime 保持 last good source。 |
| 进程重启 | settings.yaml 与 `.credentials.yaml` 持久；fact 重新注册求值；`runtime_inspect` 无跨进程状态。 |
| 一致性边界（B5 展开） | 一次 `search`/`fetch` 的执行边界 resolve 一次 source + credential；执行中发生的外部编辑不改变正在进行的调用（旧 snapshot 至本次结束）。 |

## 9. Error Semantics

- **注册冲突**：`throw new Error('runtime fact "host.os" is already owned by "runtime-facts-baseline"; "x" cannot also own it')`——fail loud at load（加载期可判定的错误按仓库"misconfiguration fails loud"）。
- **求值失败**：单个 fact 的 `resolve` 抛错 → contained + logged（`ctx.logger.warn`），该 fact 当次视为不可得（不炸请求、不炸 assembly）。与 `settings/updated` listener 的 contained 语义一致（`packages/settings/settings/src/index.ts:780-799`）。
- **inspect 未知 key**：返回 `undefined` 并在结果里标注 `unknown: <key>`（不报错，便于模型迭代查询）。
- **WebError 保持**：provider selection 失败仍抛 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` 等结构化码；V1 **不自动 fallback**（B12），只把失败原因投影给 Agent（`web.searchEffective: unavailable: WEB_PROVIDER_CONFIGURED_UNAVAILABLE (tavily)`），模型据以行动或询问用户。

## 10. Security / Secrets

1. fact 值类型排除 string 之外的 secret 途径：`resolve` 契约禁止返回含 secret 的值；审查通过 `runtime_inspect` 的结果快照测试（secret 永不进 model-visible 输出）。
2. `credentialConfigured` 只派生自 `credentials.describe(ref).configured`（`packages/credentials/credentials/src/index.ts`），不碰值。
3. `runtime_inspect` 不提供任何写路径、不读 `$DSH_HOME/.credentials.yaml` 内容、不 resolve 出值返回模型。
4. web 的 `apiKeyEnv`（reference 名字）可进 settings（非 secret）；`apiKey` 保持 `role('secret')`，wire/describe 自动剥离（`packages/settings/settings/src/index.ts:98-100`）。
5. 基线 projection 不含 PID/URL/网络细节的 secret 化风险；host.pid 与 web.serverUrl 归 inspect（成本为 inspect，且无害）。

## 11. Compatibility

- **web-search-exa/perplexity**：`apiKey` config 字段保留（deprecate），新 `apiKeyEnv` 优先；`.env` 既有 `$EXA_API_KEY` 继续有效（credentials-local 的 env 层）。settings namespace 是纯增量。
- **`WebRuntimeConfig.searchProvider`**：既有 composition 配置继续作 base 层，行为不变（user 层为空时等于现状）。
- **`runtime_inspect` 与 `$DSH_*`**：tool-bash 的 `$DSH_*` 提示保留；`runtime_inspect` 是补充（OS/pid/port/network 维度），不替换。
- **Model-visible ⟺ logged**：新模型可见输入只有两类——(a) runtime-context snapshot 文本（经 `systemPrompt.context()` + `RuntimeContextProjection`，已 logged，无需新 event）；(b) `runtime_inspect` tool（tool 调用本身 logged）。因此**不需要新 session event**。
- **agent-loop / system-prompt 不改**：投影全走现有 context 机制；relevance 由 fact owner 判定。唯一例外：若用 `visibleCapabilities()` helper，它只读 `ctx.systemPrompt` 的已收集工具名（只读查询，不改 assembly）。

## 12. Tests

| 层 | 用例 |
|---|---|
| runtime-facts 单测 | 注册冲突 throw；static 缓存一次求值；dynamic 每次求值；`projectWhen` 过滤；`render` 确定性排序与空值省略；`inspect` 未知 key；dispose 移除 |
| runtime-facts invariant | 注册/生命周期 owner 关系断言（遵循 `packages/AGENTS.md` invariant 规则） |
| runtime-facts HMR 测试 | dispose fiber 后 fact 与 context 贡献者移除（仓库 HMR-safety 政策） |
| web settings live resolve | `searchProvider` 热改后下一次 `search` 用新 provider；正在执行的调用用旧值（快照） |
| exa/perplexity apiKeyEnv | credentials resolve 每调用；`apiKey` 兼容优先；unavailable 语义不变 |
| tool-runtime-inspect e2e | 真实 composition 下 `runtime_inspect` 返回 baseline + requested；secret 不出现在输出 |
| snapshot 测试 | runtime-context snapshot 文本（含 `web.searchEffective`）随 settings 变化更新；replay 重建一致 |
| web 集成 | `WebError` 码在 projection 中可见（`web.searchEffective: unavailable: …`） |

## 13. Docs Changes

- 新 `docs/subsystems/runtime-facts.md`（registry 契约 + generated cordis-surface）。
- `docs/subsystems/web.md`：补 `web` settings section、effective selection、`web.searchEffective` 投影。
- 各 README（§1 表）按 package 契约规则更新（config keys、wire fields）。
- `docs/architecture.md`：仅当 projection 进入 agent-loop 路径才需更新——本设计不改 loop，所以 architecture 只可能在"extension points 表"补 `runtime_inspect` 一行（可选）。
- 生成目录：`config-catalog`、`tool-catalog`、`capability-seams`、`module-graph` 随 `pnpm run gen-*` 重跑。
- **Agent Note**：本任务属于非平凡架构改动，必须新增 implemented 笔记（§14 首条），且更新 `docs/AGENTS.md`/`packages/AGENTS.md` 涉及纪律时同步（本设计主要新增扩展点，不改纪律）。

## 14. Rollout Order

1. **runtime-facts 包**（SD + baseline + context 投影 + invariant + 单测）——可独立落地，无消费方影响。
2. **web settings namespace + WebRuntime live resolve**（B2/B5）——用户可编辑默认 provider。
3. **exa/perplexity apiKeyEnv 迁移**（B3）——统一 credentials 纪律。
4. **`web.searchEffective` + capability-visible projection**（B6/B8）——Agent 感知有效状态。
5. **`runtime_inspect` tool**（A2）——long-tail 查询。
6. **docs + gates**：README、subsystem 页、生成目录重跑、`verify-*` 全绿。
7. 每步独立可评审；3-4 步依赖 1-2。

## 15. V2 明确推迟（B12 展开）

- 通用 provider fallback（preference ordering × availability × transient failure 的自动选择）：V1 只做显式失败 + 投影原因。
- OS keychain credential provider（`repository-facts.md §4.2` deferred）。
- runtime fact 的进程外查询面（SDK/ACP wire）。
- Docker/GPU/MCP/浏览器场景的 fact 类型与 relevance 规则。
- per-fact 自动过期 TTL / freshness 元数据。
- settings value indirection（`${env:VAR}`）。
- `visibleCapabilities()` 的 scope-aware 精确化（V1 用 owner 自判的保守模型）。
