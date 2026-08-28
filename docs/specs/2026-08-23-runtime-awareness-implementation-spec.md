# Runtime Awareness + User Preference Plane — Implementation Spec（R3）

> 决策依据：`architecture-decision.md`（B1–B16、Ownership Matrix、方案 C、sync baseline + async inspect）。现状盘点：`repository-facts.md`。V1 目标：Agent 不猜宿主事实；用户有稳定位置表达长期 capability preference 且 Agent 知道当前真正生效的状态。不造万能配置平台，不做 Doctor。R3 变更：RuntimeFact 三正交维度（evaluation / freshness / exposure，取代 R2 的 observation+cost）；`RuntimeFactValue` 保持 scalar，`host.proxy` 拆 5 个 fact；`projectWhen` 回调改声明式 `relevance`；自动投影收敛为纯 sync `systemPrompt.context(order=120)`（弃用 R2 的 async waterfall）；删除 `web.search-operable`；secret literal precedence 统一；provider id 统一 `deepseek-official`。R3.1 errata：`SubprocessRuntime.executionWorld` 权威字段（B1）、`host.shell` 与 `web-search.<id>.registered` 移出 V1（B1/B4）、`web.server-url`/`runtime.execution-world` 改 dynamic（B2）、Web/Provider→runtimeFacts optional 生命周期接线（B3）。

## 1. Package / File Changes（总览）

### 新增包（3 个）

| 包 | 角色 | ctx key / 产物 |
|---|---|---|
| `packages/context/runtime-facts` | Runtime Fact registry（Service Definition；含 sync context contributor） | `ctx.runtimeFacts` |
| `packages/context/runtime-facts-host` | host 事实 provider（OS/arch/pid/proxy/execution-world/server-url，owner 委托各域） | 注册到 `ctx.runtimeFacts` |
| `packages/extensions/tool-runtime-inspect` | model-facing `runtime_inspect` tool（Consumer，tagged union：facts/command） | 注册到 `ctx.tools` |

> R2-P1 保留：`tool-runtime-inspect` 定义 tool，违反 context 组契约（"request-context extensions WITHOUT defining a tool"，`packages/context/README.md:5`），移入 `packages/extensions/`（与 `tool-cordis` 同类：model-facing runtime inspection tool，`packages/extensions/README.md:9`）。 R2-P2 保留：`runtime-facts-baseline` 更名 `runtime-facts-host`——该包承载的是"宿主事实"（baseline + inspect 都有），包名不再声称仅 baseline；cost 是 fact 级属性。

### 修改的包（7 个）

| 包 | 改动 |
|---|---|
| `packages/subprocess/subprocess`（SD） | `SubprocessRuntime` 增 `abstract readonly executionWorld: ExecutionWorldKind`（`'local' | 'remote'`），execution-world 的唯一权威（R3.1-B1） |
| `packages/subprocess/subprocess-local` | `LocalSubprocessRuntime.executionWorld = 'local'` |
| `packages/e2b/subprocess-e2b` | `E2BSubprocessRuntime.executionWorld = 'remote'` |
| `packages/web/web` | 注册 `web` settings namespace；`searchProvider`/`fetchProvider` live resolve（`installSettingsSection`）；经 `ctx.inject(['runtimeFacts'], cb)` **optional** 导出 `web.search-selected`（owner 归 `web` 包，R2-B5；R3.1-B3：不导出 `web.search-operable`，R3-5；不注册 `web-search.<id>.registered`，R3.1-B4） |
| `packages/web/web-search-exa` | 增 `apiKeyEnv` + settings namespace，走 `ctx.credentials`；经 optional inject 声明 `web-search.exa.local-available`（sync）与 `web-search.exa.credential-configured`（async）fact（owner 归 provider 包，R2-B5；V1 均 `exposure='inspect'`） |
| `packages/web/web-search-perplexity` | 同上（`perplexity` id） |
| `packages/web/tool-web` | 不改（selection 由 `WebRuntime` 计算；tool-web 只调 `ctx.web.search`） |

### 新增/修改文档

- `docs/subsystems/runtime-facts.md`（新，含 generated cordis-surface）
- `docs/subsystems/web.md`（补 settings section、状态词投影，生成区自动）
- `packages/context/runtime-facts/README.md`、`runtime-facts-host/README.md`、`packages/extensions/tool-runtime-inspect/README.md`（新）
- `packages/web/web/README.md`、`web-search-exa/README.md`、`web-search-perplexity/README.md`（改）
- `docs/config-catalog.md` / `docs/tool-catalog.md` / `docs/capability-seams.md`（生成，随代码重跑）
- Agent Note（新，见 §13）

## 2. Service Definition / Provider / Consumer

### 2.1 `ctx.runtimeFacts` — Service Definition（`packages/context/runtime-facts`）

**三正交维度（R3-1）**：`evaluation`（怎么求值）与 `freshness`（值会不会变）正交；`exposure`（进不进自动 context）独立。每次观察返回 discriminated result：

```ts
// packages/context/runtime-facts/src/types.ts
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'

/** fact 名。品牌类型：每段 ^[a-z][a-z0-9-]*$，段以 '.' 分隔（机械校验）。 */
type RuntimeFactKey = Branded<'RuntimeFactKey'>

/** 求值方式：sync = 本地同步可得；async = 需要 await（credential describe / probe）。与 freshness、exposure 正交。 */
type RuntimeFactEvaluation = 'sync' | 'async'
/** 新鲜度：static = 注册后值不变（可缓存一次）；dynamic = 每次求值可能变（不得缓存）。 */
type RuntimeFactFreshness = 'static' | 'dynamic'
/** 曝光：baseline = 自动投影进 runtime context（仅 sync + cheap）；inspect = 仅 runtime_inspect 按需查询（可 async）。 */
type RuntimeFactExposure = 'baseline' | 'inspect'

/** fact 值：简单标量。secret 永不出现。R3-2：保持 scalar；object（如 proxy）拆成多个 scalar fact。 */
type RuntimeFactValue = string | boolean | number

/** 一次观察的结果：明确区分四种状态，undefined 只表示"值本身缺省"，不承载状态。 */
type RuntimeFactObservationResult<T extends RuntimeFactValue> =
  | { status: 'ok'; value: T }
  | { status: 'unknown' }            // key 未注册 / 尚无数据（inspect 未知 key）
  | { status: 'unavailable' }        // fact 存在但当前不可得：provider 未注册、credential 未配置、scope 不适用
  | { status: 'probe-failure'; reason?: string }  // async probe 抛错 / 超时 / 中止

/** 一次求值的上下文。scope = agent（context contributor 的 AssembleContext.scope 即 agent）。 */
interface RuntimeFactContext {
  readonly scope?: ScopeKey
  readonly signal?: AbortSignal
}

/** 一个 runtime fact 的声明。注册是 effect；同名 key 第二次注册 fail loud。 */
interface RuntimeFact {
  readonly key: RuntimeFactKey
  /** 声明者名字，用于诊断与冲突归属（ONE FACT ONE OWNER）。 */
  readonly owner: string
  /** 模型可见的一句话描述（runtime_inspect 列表与诊断用）。 */
  readonly description: string
  readonly evaluation: RuntimeFactEvaluation
  readonly freshness: RuntimeFactFreshness
  readonly exposure: RuntimeFactExposure
  /**
   * 声明式 capability relevance：本 fact 依赖哪些 tool 可见才投影（如 ['web_search']）。
   * 缺省 = 无条件投影（baseline always-on）。可见性求值统一由 RuntimeFacts 经
   * ctx.tools.get(name, scope) 完成；fact owner 不写可见性代码（R3-3，B8/B15）。
   */
  readonly relevance?: { readonly tools: readonly string[] }
  /** sync 求值（evaluation='sync'）。undefined → unavailable。 */
  resolveSync?(context: RuntimeFactContext): RuntimeFactValue | undefined
  /** async 求值（evaluation='async'）。undefined → unavailable；throw/abort → probe-failure。 */
  resolveAsync?(context: RuntimeFactContext, signal?: AbortSignal): Promise<RuntimeFactValue | undefined>
}

/** 枚举声明，供 UI/诊断/inspect 列表（不执行 resolve）。 */
interface RuntimeFactInfo {
  readonly key: RuntimeFactKey
  readonly owner: string
  readonly description: string
  readonly evaluation: RuntimeFactEvaluation
  readonly freshness: RuntimeFactFreshness
  readonly exposure: RuntimeFactExposure
  readonly relevance?: { readonly tools: readonly string[] }
}
```

```ts ignore-check
// packages/context/runtime-facts/src/index.ts
export class RuntimeFacts extends Service {
  static Config: z<Config> = z.object({
    /** 是否把 baseline facts 投影进 runtime context（默认 true）。 */
    includeInRuntimeContext: z.boolean().default(true),
  })

  registerFact(fact: RuntimeFact): () => void
  list(): RuntimeFactInfo[]
  /** 求值指定 facts（runtime_inspect 走这里；async fact 在此 await credential describe / probe）。未知 key → unknown；存在但不可得 → unavailable；async 失败 → probe-failure。 */
  inspect(keys: readonly RuntimeFactKey[], context?: RuntimeFactContext): Promise<Record<string, RuntimeFactObservationResult<RuntimeFactValue>>>
  /** 自动投影（sync）：只求值 evaluation='sync' 且 exposure='baseline' 且 relevance 命中的 fact，渲染为模型可见文本。空 → ''。 */
  render(context: RuntimeFactContext): string
}
```

**sync projection consumer（R3-4）**：不注册 async waterfall 监听器；注册普通 sync context contributor（`packages/core/system-prompt/src/index.ts:398`，order 升序 join；sandbox `sandbox:policy` 用 order=110）：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { RuntimeFactContext } from '@deepseek-ai/dsh-runtime-facts'
import type {} from '@deepseek-ai/dsh-system-prompt'

function contributeRuntimeFacts(
  ctx: Context,
  render: (context: RuntimeFactContext) => string,
): () => void {
  return ctx.systemPrompt.context({
    name: 'runtime-facts',
    order: 120,
    text: context => render(context.scope === undefined ? {} : { scope: context.scope }),
  })
}
```

- **不改 Agent Loop**：`RuntimeContextProjection` 在 assemble 之后照常消费渲染文本（`packages/core/agent-loop/src/runtime-context.ts`）。
- **Model-visible ⟺ logged**：投影文本最终经 `RuntimeContextProjection` 以 `user/message` 注入并可从 session log 重建，无需新 session event。
- **B5 热 reload**：`text` 是每 assembly 求值的函数；`web.search-selected`（dynamic）每次求值读最新 `resolveProvider()` 结果，settings 热改后下一次 assembly 的 snapshot 变化即注入。
- **async facts 不进自动 context**：`web-search.<id>.credential-configured`、`net.reachable` 只在 `inspect()` 时求值。

### 2.2 Provider — host facts（`packages/context/runtime-facts-host`）

```ts ignore-check
// 注册样例（owner 委托各域，避免重复实现探测；fact key 全小写 kebab）
registry.registerFact({
  key: factKey('host.os'),
  owner: 'runtime-facts-host',
  description: 'Operating system of the host process.',
  evaluation: 'sync',
  freshness: 'static',
  exposure: 'baseline',
  resolveSync: () => normalizeOs(process.platform),
})
registry.registerFact({
  key: factKey('runtime.execution-world'),
  owner: 'runtime-facts-host',
  description: 'Execution world of the subprocess seam (local or remote).',
  evaluation: 'sync',
  freshness: 'dynamic',   // 值来自可热加载 Service Provider（R3.1-B2），不得缓存
  exposure: 'baseline',
  resolveSync: () => pluginCtx.get('subprocess')?.executionWorld,   // seam 权威字段（R3.1-B1）；禁止 instanceof / process.platform / plugin name 猜测
})
registry.registerFact({
  key: factKey('web.search-selected'),
  owner: 'web',   // selection 语义 owner = WebRuntime；runtime-facts-host 不注册它（注册在 web 包）
  description: 'Currently selected search provider id.',
  evaluation: 'sync',
  freshness: 'dynamic',   // 每次求值重新 resolve；不缓存（R3-1，B5）
  exposure: 'baseline',
  relevance: { tools: ['web_search'] },
  resolveSync: (ctx) => /* WebRuntime.resolveProvider() 结果（注册在 web 包） */,
})
registry.registerFact({
  key: factKey('host.proxy.configured'),
  owner: 'runtime-facts-host',
  description: 'Whether a system proxy is configured (sanitized; never a raw URL).',
  evaluation: 'sync',
  freshness: 'static',   // 启动快照
  exposure: 'inspect',
  resolveSync: () => sanitizeProxy(launchEnv).configured,
})
// host.proxy.scheme / host.proxy.host / host.proxy.port / host.proxy.source 同构，
// 由同一个 sanitizeProxy(launchEnv) 快照派生（R3-2：object 拆 5 个 scalar，RuntimeFactValue 保持 scalar）
registry.registerFact({
  key: factKey('host.pid'),
  owner: 'runtime-facts-host',
  description: 'Process id of the DSH host process.',
  evaluation: 'sync',
  freshness: 'static',
  exposure: 'inspect',
  resolveSync: () => process.pid,
})
registry.registerFact({
  key: factKey('web.server-url'),
  owner: 'runtime-facts-host',
  description: 'DSH web server URL (host/port owned by ctx.webServer).',
  evaluation: 'sync',
  freshness: 'static',
  exposure: 'inspect',
  resolveSync: () => { const ws = ctx.get('webServer'); return ws === undefined ? undefined : `http://${ws.host}:${ws.port}` },
})
```

- **复用既有 owner 而非重复探测**：`runtime.execution-world` 读 **`SubprocessRuntime.executionWorld`**（R3.1-B1 seam 权威字段；`LocalSubprocessRuntime='local'`、`E2BSubprocessRuntime='remote'`）；`host.proxy.*` 委托 `launch-environment` 快照（`repository-facts.md §7.4`）；`web.server-url` 委托 `ctx.webServer.port`（**R2-P3：peerDeps 必须列 webserver**）；sandbox mode / session cwd / `DSH_HOME` / command resolution 不注册（已有 owner，见 §4 禁止清单）。
- **freshness 默认规则（R3.1-B2）**：凡值来自另一个**可热加载 Service Provider** 的 fact，一律 `freshness='dynamic'`（不得注册时缓存）——`web.server-url`（WebServer.port 由异步 `init()` 的 `server.listen` 回调赋值，`packages/host/webserver/src/index.ts:86,93-94,233-236`）、`runtime.execution-world`（subprocess 可热换）、`web.search-selected`（settings 热改）。V1 真正的 `static` 只有进程常量/启动快照：`host.os` / `host.arch` / `host.pid` / `host.proxy.*`（launch-environment 快照）。

### 2.3 Consumer — `runtime_inspect` tool（`packages/extensions/tool-runtime-inspect`）

Model-facing schema（R2-B3：tagged union，facts / command）：

```jsonc
// runtime_inspect 参数（V1）
// 1) 查 fact（默认 kind="facts"）
{ "kind": "facts", "keys": ["host.os", "web-search.exa.credential-configured"] }
// 2) command resolution（parameterized inspector，非 fact key）
{ "kind": "command", "command": "codex" }
```

执行语义：

- `kind="facts"`：`registry.inspect(keys)`（**async**，可 await `credentials.describe` / probe）。返回每 key 的 `{status, value|reason}`（ok / unknown / unavailable / probe-failure）。省略 `keys` 返回 baseline + 可查询列表。
- `kind="command"`：调 **`ctx.subprocess.resolveExecutable(command, env?, signal)`**（`packages/subprocess/subprocess/src/index.ts:107-122`，authority 复用）。返回结构化结果；`world` 字段来自 `ctx.subprocess.executionWorld`（R3.1-B1，与 `runtime.execution-world` 同一权威，禁止猜测）：

```jsonc
{ "kind": "command", "command": "codex", "resolved": "C:\\...\\codex.exe", "world": "local" }
{ "kind": "command", "command": "codex", "status": "unavailable", "reason": "was not found on PATH" }
```

- **禁止为每个 command 预注册 fact**（B16）：command 是 parameterized inspector，不枚举。
- 只暴露安全事实；secret 永不出现。`apiKeyEnv` 只回 `credential-configured`。
- 只注册到 `ctx.tools`；使用指导保留在 tool description，不额外贡献常驻 `systemPrompt.section`。

### 2.4 Web / Provider → runtimeFacts optional 接线（R3.1-B3，生命周期契约）

`web` / `web-search-exa` / `web-search-perplexity` 贡献 fact 时**不得**把 `runtimeFacts` 声明为硬注入（`static inject = ['settings', 'runtimeFacts']` 会把 Runtime Awareness 变成 Web 的硬依赖，破坏未加载该插件的历史 composition）。照 `installSettingsSection` / `agent-presets` 的 optional seam 风格，用 `ctx.inject(['runtimeFacts'], cb)` + `effect` disposer：

```ts ignore-check
// packages/web/web/src/index.ts（web-search-exa / web-search-perplexity 同构）
ctx.inject(['runtimeFacts'], (rctx) => {
  rctx.effect(() => {
    const disposers = [
      rctx.runtimeFacts.registerFact({
        key: factKey('web.search-selected'),
        owner: 'web',
        description: 'Currently selected search provider id.',
        evaluation: 'sync',
        freshness: 'dynamic',
        exposure: 'baseline',
        relevance: { tools: ['web_search'] },
        resolveSync: () => resolveProvider(this.searchProviders, ...)?.id,
      }),
      // provider 包各自注册 local-available / credential-configured（exposure='inspect'）
    ]
    return () => disposers.forEach(d => d())
  })
})
```

生命周期（必须有测试）：
- **without `ctx.runtimeFacts`**：`ctx.inject` 不执行，Web 完整工作（`installSettingsSection` 同款降级，`packages/settings/settings/src/index.ts:870-896`）。
- **runtimeFacts appears**：facts 注册，投影/查询可见。
- **runtimeFacts unloads**：`effect` disposer 自动撤回 facts，Web 继续正常（无残留引用、无 throw）。

## 3. Settings Schema（Web Preference）

### 3.1 `web` namespace（owner：`WebRuntime`）

```yaml
# $DSH_HOME/settings.yaml —— 用户编辑入口（R2-P4：用仓库已有 provider，不用不存在的 Tavily）
web:
  searchProvider: exa          # 用户偏好：默认搜索 provider（exa/perplexity/deepseek-official）
  fetchProvider: http          # 用户偏好：默认 fetch provider
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

- **precedence**：schema 缺省（无）→ composition `base`（cordis.yml + 同一字段的 env 覆盖）→ user 层。与"operational overrides feed the SAME fields"一致（`packages/web/web/src/index.ts:76-93`）。
- **live resolve**：`search()`/`fetch()` 每次读 `source()`；B5：热改后下一次调用生效。
- **不需要**：重注册 tool、改 tool schema。`applies: 'live'`。

### 3.3 provider 内部配置（exa / perplexity 迁移，B3；secret precedence 统一，R3-7）

- `web-search-exa`：Config 增 `apiKeyEnv?: string`（默认 `EXA_API_KEY`）；注册 `web-search-exa` settings namespace（schema 含 `apiKeyEnv`/`baseURL`/`searchType`/…，web-search-deepseek 同构）。
- `web-search-perplexity`：同上（`PERPLEXITY_API_KEY`）。
- **secret literal precedence（R3-7，全文统一）**：`explicit non-empty apiKey`（字面量，deprecated 兼容）> `apiKeyEnv`（经 `ctx.credentials.resolve`）。`apiKey` 字段标记 **deprecated**：新配置只写 `apiKeyEnv`；既有显式 `apiKey` 非空时仍生效（向前兼容），但不再作为推荐路径。`.env` 既有 `$EXA_API_KEY` 继续作为 credentials 兜底层（credentials-local 的 user/project env 层），不破坏现状。
- 每 `search` 经 `ctx.credentials.resolve` 一次（每操作一次 = 热更新机制，`repository-facts.md §4.1`）。

## 4. Runtime Fact Vocabulary（V1 清单，R3：三正交维度 + kebab-case + owner 闭合）

| key | owner | evaluation | freshness | exposure | 值示例 | 来源 |
|---|---|---|---|---|---|---|
| `host.os` | runtime-facts-host | sync | static | inspect | `win32` | `process.platform` |
| `host.arch` | runtime-facts-host | sync | static | inspect | `x64` | `process.arch` |
| `runtime.execution-world` | runtime-facts-host | sync | **dynamic** | baseline | `local` | `SubprocessRuntime.executionWorld`（seam 权威，R3.1-B1） |
| `web.search-selected` | `web` 包（selection） | sync | **dynamic** | baseline（relevance: `web_search`） | `exa` | `resolveProvider()` 结果 |
| `web-search.exa.local-available` | `web-search-exa` 包 | sync | dynamic | **inspect** | `true` | `provider.available()` |
| `web-search.exa.credential-configured` | `web-search-exa` 包 | **async** | dynamic | **inspect** | `true` | `credentials.describe(ref).configured` |
| `host.pid` | runtime-facts-host | sync | static | inspect | `12345` | `process.pid` |
| `host.proxy.configured` | runtime-facts-host | sync | static | inspect | `true` | launch-environment → sanitize |
| `host.proxy.scheme` | runtime-facts-host | sync | static | inspect | `http` | 同上（同一 sanitize 快照） |
| `host.proxy.host` | runtime-facts-host | sync | static | inspect | `proxy.example.com` | 同上 |
| `host.proxy.port` | runtime-facts-host | sync | static | inspect | `8080` | 同上 |
| `host.proxy.source` | runtime-facts-host | sync | static | inspect | `env` | 同上 |
| `web.server-url` | runtime-facts-host（委托 `ctx.webServer`） | sync | **dynamic** | inspect | `http://127.0.0.1:3080` | `webServer.port`（异步 init 赋值，R3.1-B2） |
| `net.reachable` | runtime-facts-host | **async** | dynamic | inspect | `true` | inspect 时 probe（V1 可选，默认不内置） |

> 禁止注册（重复 owner）：sandbox mode / workspace root（sandbox-policy 已投影）、session cwd（SessionHeader）、`DSH_HOME`（shell-env 已有）、command resolution（inspect 走 `resolveExecutable`，不预注册 per-command fact）。 R2-B5：provider 专属状态（`local-available`/`credential-configured`）owner = 各 provider 包，**V1 全部 `exposure='inspect'`**（R3-5）；selection（`web.search-selected`）owner = `web` 包，`exposure='baseline'`（relevance 命中时自动投影）。 **R3-5：`web.search-operable` 不在 V1**（无统一 credential/readiness interface；统一 readiness protocol V2）。 **R3.1-B4：`web-search.<id>.registered` 不在 V1**（`WebSearchProvider.id: string` 不保证 kebab grammar；已注册 provider 清单留给 parameterized inspection `runtime_inspect kind=web-provider`，V2）。 **R3.1-B1：`host.shell` 不在 V1**（`ShellExecutor` 无自述；模型已通过可见 Tool 知 shell，V2）。 **R3.1-B2**：来自可热加载 Service Provider 的 fact 一律 `dynamic`（`web.server-url`、`runtime.execution-world`、`web.search-selected`）；V1 的 `static` 仅 `host.os`/`host.arch`/`host.pid`/`host.proxy.*`。

## 5. Context Projection Algorithm（R3：sync baseline + async inspect）

**触发点**：每次模型请求前 `systemPrompt.assemble()`（async）→ context contributor `text` 被调用（sync）。

1. `render({ scope })`（sync）：
   - 遍历 `list()`，过滤 `evaluation === 'sync'` 且 `exposure === 'baseline'` 且 relevance 命中。
   - relevance 命中（R3-3）：`relevance` 缺省 → 恒投影；否则要求 `scope !== undefined` 且每个 `relevance.tools` 经 `ctx.get('tools').get(tool, scope) !== undefined`（统一在 `RuntimeFacts` 内求值；scope 不可判定 → 保守不投影）。
   - sync fact：`resolveSync`；`freshness='static'` 可缓存一次，`freshness='dynamic'` 每次求值（不缓存）。
2. 渲染（确定性，按 key 排序）：
   ```text
   Host runtime facts:
   - host.os: win32
   - host.arch: x64
   - runtime.execution-world: local
   - web.search-selected: exa
   ```
   无命中 → 返回 `''`（空文本，context 项不产生内容）。
3. `RuntimeContextProjection` 照常：文本变化才注入新 `user/message` snapshot；replacement 发 CLEARED；replay 从 log 恢复（`packages/core/agent-loop/src/runtime-context.ts`）。
4. **async 求值只发生在 inspect**：`runtime_inspect kind=facts` 走 `inspect()`（async），可 await `credentials.describe` / probe；abort → probe-failure。
5. **token 控制**：baseline 恒短（≤4 行）；capability-scoped 命中才加 `web.search-selected` 行；长尾走 `runtime_inspect`。V1 baseline 严格 ≤4 个 fact；新增 baseline fact 需 Agent Note 论证。

## 6. Precedence / Ownership Rules

1. ONE FACT ONE OWNER：`registerFact` 同名 key 第二次 → `throw`（fail loud at load，shell-env keyOwners 同风格，`packages/shell/shell-env/src/index.ts:131-134`）。
2. 已有 owner 的事实不重复探测：§4 禁止清单 + `repository-facts.md` owner 表。
3. 配置 precedence 保持仓库既定单一顺序（B4），不发明新层。
4. Secret 永不进 settings / fact 值 / prompt；只允许 `credential-configured` 安全事实（B3）；secret literal precedence 见 §3.3（`apiKey` 非空 > `apiKeyEnv`；`apiKey` deprecated）。
5. Preset/Mode 只经 `relevance`/scope 影响投影，不改 fact 值（B9）。
6. `freshness='static'` 的 fact 注册时求值缓存一次；`freshness='dynamic'` 的 fact 每次求值重新 resolve（R3-1，保证 B5 热 reload 生效）；**来自可热加载 Service Provider 的 fact 一律 `dynamic`**，V1 的 `static` 仅 `host.os`/`host.arch`/`host.pid`/`host.proxy.*`（R3.1-B2）；无自动过期（V1）。

## 7. Capability-Visible Projection（B6/B8/B15）

**原则**：`runtimeFacts` 保持 capability-neutral（不盘点能力、不枚举缺失）；事实"该不该投影"由声明式 `relevance` 表达（fact 只声明依赖的 capability），可见性判定 authority = **`ctx.tools`**，求值统一收进 `RuntimeFacts`。

- 求值实现示例（R3-3，`RuntimeFacts` 内部，不复制 visibility resolver）：
  ```ts ignore-check
  private visible(ctx: RuntimeFactContext, relevance?: { tools: readonly string[] }): boolean {
    if (relevance === undefined) return true
    if (ctx.scope === undefined) return false          // 非 agent 上下文，保守不投影
    const tools = ctx.get('tools')                      // RuntimeFacts 有 ctx；optional service
    return tools !== undefined && relevance.tools.every(t => tools.get(t, ctx.scope) !== undefined)
  }
  ```
  只用 `ToolRuntime.get(name, scope)`（`packages/core/tools/src/index.ts:1204`），它已含 inherited + scoped + restrictions + reserved transport（`view(scope)`，:1152）。fact owner 不写可见性代码。
- effective state（B6，R3-5 收敛）：`web.search-selected`（sync / dynamic，`resolveProvider` 结果）是唯一自动投影的 provider 状态；"能不能用"交给实际 `search()` 的 `WebError`（`WEB_PROVIDER_CREDENTIAL_MISSING` / `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`），不在投影层预判（无 operable）。
- `sandbox:policy` 无条件 context 保持（A 级 baseline，不变）。

## 8. Lifecycle / Hot Reload

| 事件 | 行为 |
|---|---|
| 插件 mount / `registerFact` | effect 注册；`systemPrompt.context` disposer 随 fiber dispose 移除。 |
| `ctx.inject(['runtimeFacts'])`（R3.1-B3） | 服务出现 → Web/Provider 注册 facts；服务 unload → `effect` disposer 撤回，Web 完整工作（无硬依赖）。 |
| HMR / 插件 reload | facts 随 fiber 移除；settings namespace 留在存储给下一 owner（`packages/settings/settings/src/index.ts:863-897`）。 |
| settings.yaml 外部编辑 | watcher 热发布 → `settings/updated` → WebRuntime `setSource` 更新 → 下一次 `search`/`fetch` 生效（B5）；下一次 assembly 的 `web.search-selected`（dynamic）重新求值 → snapshot 变化 → `RuntimeContextProjection` 注入新 snapshot。 |
| settings 写入失败 / 非法 | settings-file warn-and-keep-last-good；WebRuntime 保持 last good source。 |
| 进程重启 | settings.yaml 与 `.credentials.yaml` 持久；fact 重新注册求值；`runtime_inspect` 无跨进程状态。 |
| 一致性边界（B5） | 一次 `search`/`fetch` 执行边界 resolve 一次 source + credential；执行中外部编辑不改变正在进行的调用（旧 snapshot 至本次结束）。 |

## 9. Error Semantics（R2 保留：区分 unknown / unavailable / probe-failure）

- **注册冲突**：`throw new Error('runtime fact "host.os" is already owned by "runtime-facts-host"; "x" cannot also own it')`——fail loud at load。
- **求值失败（sync）**：`resolveSync` 抛错 → contained + logged，该 fact 当次 `unavailable`（不炸请求、不炸 assembly）。
- **求值失败（async，仅 inspect）**：`resolveAsync` 抛错/中止 → `probe-failure`（含 reason），contained + logged；区别于"正常不可得"的 `unavailable`。
- **inspect 未知 key**：`unknown`（不报错，便于模型迭代查询）。
- **WebError 保持**：provider selection 失败仍抛 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` 等结构化码；V1 **不自动 fallback**（B12）。模型从实际 `search()` 错误码知悉失败原因（投影层不预判 operable）。

## 10. Security / Secrets（R2 保留：含 proxy sanitize；R3-2 拆 5 scalar）

1. fact 值契约禁止含 secret；`RuntimeFactValue` 只允许 string/boolean/number（scalar）。
2. `credential-configured` 只派生自 `credentials.describe(ref).configured`，不碰值。
3. `runtime_inspect` 无写路径、不读 `.credentials.yaml` 内容、不 resolve 出值返回模型。
4. **`host.proxy.*`（R2-B6 保留，R3-2 拆分）**：永不把 `HTTP_PROXY`/`HTTPS_PROXY` raw URL 放进 model-visible fact。代理 URL 可含 `user:pass@`/token/query，只投影 sanitized 表示（拆成 5 个 scalar）：
   ```jsonc
   host.proxy.configured: true
   host.proxy.scheme: "http"
   host.proxy.host: "proxy.example.com"
   host.proxy.port: 8080
   host.proxy.source: "env"
   ```
   sanitize 丢弃 username/password/token/query/path；无法解析的 URL → `configured: false`（其余 `scheme`/`host`/`port` 置 `undefined` → `unavailable`）。
5. web 的 `apiKeyEnv`（reference 名）可进 settings（非 secret）；`apiKey` 保持 `role('secret')`，wire/describe 自动剥离（`packages/settings/settings/src/index.ts:98-100`），且 deprecated（§3.3）。
6. baseline projection 不含 PID/URL/网络细节；`host.pid`/`web.server-url`/`host.proxy.*` 归 inspect。
7. **secret-leak tests**（保留）：断言所有 model-visible 输出（projection 渲染 + `runtime_inspect` 结果）不含 `://` 凭据段（`user:pass@`）、不含 `apiKey` 值、不含 proxy raw URL。

## 11. Compatibility

- **web-search-exa/perplexity**：`apiKey` config 字段保留（deprecated），新 `apiKeyEnv` 优先（非空 `apiKey` 仍兼容 wins）；`.env` 既有 `$EXA_API_KEY` 继续有效（credentials-local env 层）。settings namespace 是纯增量。
- **`WebRuntimeConfig.searchProvider`**：既有 composition 配置继续作 base 层，行为不变（user 层为空时等于现状）。
- **`runtime_inspect` 与 `$DSH_*`**：tool-bash 的 `$DSH_*` 提示保留；`runtime_inspect` 是补充（OS/pid/port/network/command 维度），不替换。
- **Model-visible ⟺ logged**：新模型可见输入两类——(a) runtime-context snapshot（经 `systemPrompt.context(order=120)` + `RuntimeContextProjection`，已 logged）；(b) `runtime_inspect` tool 调用（已 logged）。**不需要新 session event**。
- **agent-loop / system-prompt 不改**：投影走现有 sync context contributor + `RuntimeContextProjection`；relevance 由 `RuntimeFacts` 集中经 `ctx.tools` 判定。

## 12. Tests

| 层 | 用例 |
|---|---|
| runtime-facts 单测 | 注册冲突 throw；key 校验（kebab-case，拒绝 `executionWorld` 等）；三正交维度求值（sync/async、static/dynamic、baseline/inspect）；四种结果状态（ok/unknown/unavailable/probe-failure）；`relevance` 过滤（经 ctx.tools 集中求值，scope 未定义 → 不投影）；渲染确定性排序；dispose 移除 |
| runtime-facts freshness | `static` fact 缓存一次；`dynamic` fact 每次求值重新 resolve（`web.search-selected` 随 preference 变化更新，B5） |
| runtime-facts async（inspect） | `inspect()` 中 async fact abort → probe-failure；一个 async fact 失败不影响其他 fact（contained）；async fact 不进入 `render()` 自动投影 |
| **runtimeFacts optional 生命周期（R3.1-B3）** | without `ctx.runtimeFacts`：Web 完整工作；appears：facts 出现；unloads：facts 消失、Web 继续（无残留引用） |
| **subprocess executionWorld（R3.1-B1）** | `LocalSubprocessRuntime.executionWorld='local'`、`E2BSubprocessRuntime.executionWorld='remote'`；`runtime-facts-host` 读该字段而非 instanceof / platform 猜测；`runtime_inspect kind=command` 的 `world` 同一权威 |
| runtime-facts invariant | 注册/生命周期 owner 关系断言 |
| runtime-facts HMR | dispose fiber 后 fact 与 context contributor 移除 |
| web settings live resolve | `searchProvider` 热改后下一次 `search` 用新 provider；执行中调用用旧值 |
| exa/perplexity apiKeyEnv | credentials resolve 每调用；`apiKey` 非空兼容优先（deprecated）；`local-available`/`credential-configured` 语义（inspect-only） |
| **runtime_inspect command（R2-B3）** | `kind=command` → `resolveExecutable` → structured result；`world` 字段；unavailable（PATH 未命中） |
| **runtime_inspect facts（R3）** | `kind=facts` 对 async fact（`credential-configured`）返回 `ok/configured` 或 `unavailable`；未知 key → `unknown` |
| **runtime_inspect secret-leak（R2-B6）** | projection 与 inspect 输出不含 `user:pass@`、不含 apiKey 值、不含 proxy raw URL |
| snapshot 测试 | runtime-context snapshot（含 `web.search-selected`）随 settings 变化更新；replay 重建一致 |
| web 集成 | `search()` 失败时模型看到 `WebError` 码（`WEB_PROVIDER_CREDENTIAL_MISSING` 等），投影层不预判 operable |

## 13. Docs Changes

- 新 `docs/subsystems/runtime-facts.md`（registry 契约 + 三正交维度 + generated cordis-surface）。
- `docs/subsystems/web.md`：补 `web` settings section、状态词投影、`apiKeyEnv` 迁移。
- 各 README 按 package 契约规则更新（config keys、wire fields、Model Experience）。
- `docs/architecture.md`：不改 loop；extension points 表可补 `runtime_inspect` 一行（可选）。
- 生成目录：`config-catalog`、`tool-catalog`、`capability-seams`、`module-graph` 随 `pnpm run gen-*` 重跑。
- **Agent Note**：本任务属于非平凡架构改动，必须新增 implemented 笔记（§14 首条）。

## 14. Rollout Order

1. **subprocess seam `executionWorld`（SD + local + e2b）+ runtime-facts 包**（SD + 三正交维度 + sync context contributor + invariant + 单测）——独立可落地。
2. **web settings namespace + WebRuntime live resolve**（B2/B5）。
3. **exa/perplexity apiKeyEnv 迁移 + provider 状态 fact（inspect）**（B3/B5）。
4. **`web.search-selected` + capability-visible projection**（B6/B8/B15；relevance 集中求值）。
5. **`runtime_inspect` tool（facts + command）**（A2/B3/B16；inspect async）。
6. **docs + gates**：README、subsystem 页、生成目录重跑、`verify-*` 全绿。
7. 每步独立可评审；3-4 步依赖 1-2。

## 15. V2 明确推迟（B12 展开，R3 更新）

- 通用 provider fallback（preference ordering × availability × transient failure）：V1 只做状态投影 + 显式失败。
- **统一 provider readiness protocol + `web.search-operable`**（`WebSearchProvider` 统一 credential/readiness interface；V1 无，R3-5）。
- `host.shell`（`ShellExecutor` 补 dialect/shellName 自述或参数化查询，若出现真实 shell 诊断需求；R3.1-B1）。
- `web-search.<id>.registered` → parameterized inspection `runtime_inspect kind=web-provider`（不动态造 FactKey；R3.1-B4）。
- `SubprocessRuntime.describeExecutionWorld()` 扩展（remote backend / platform / arch；R3.1-B1，V1 不做）。
- provider credential fact（`credential-configured`）契约公开化（V1 以 exa/perplexity 内部落地）。
- **async 事实进自动 projection**（如需要）：注册 order=120 的 ordered placeholder 后异步替换 text（waterfall append 无法实现 order=120，R3-6 约束）。
- OS keychain credential provider（`repository-facts.md §4.2` deferred）。
- runtime fact 进程外查询面（SDK/ACP wire）。
- Docker/GPU/MCP/浏览器 fact 类型与 relevance 规则。
- per-fact 自动过期 TTL / freshness 元数据。
- settings value indirection（`${env:VAR}`）。
- `reachable`（网络探针）自动进 projection（V1 仅 inspect）。
- `host.proxy` 之外的敏感环境事实（如带凭据的 CA 变量）的 sanitize 策略扩展（`ALL_PROXY`/`no_proxy` 覆盖）。
