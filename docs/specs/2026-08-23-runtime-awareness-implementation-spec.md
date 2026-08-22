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
| `packages/subprocess/subprocess-e2b` | `E2BSubprocessRuntime.executionWorld = 'remote'` |
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

```ts ignore-check
// packages/context/runtime-facts/src/types.ts
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
  | { status: 'unknown' }
  | { status: 'unavailable' }
  | { status: 'probe-failure'; reason?: string }

interface RuntimeFactContext {
  readonly scope?: ScopeKey
  readonly signal?: AbortSignal
}

interface RuntimeFact {
  readonly key: RuntimeFactKey
  readonly owner: string
  readonly description: string
  readonly evaluation: RuntimeFactEvaluation
  readonly freshness: RuntimeFactFreshness
  readonly exposure: RuntimeFactExposure
  readonly relevance?: { readonly tools: readonly string[] }
  resolveSync?(context: RuntimeFactContext): RuntimeFactValue | undefined
  resolveAsync?(context: RuntimeFactContext, signal?: AbortSignal): Promise<RuntimeFactValue | undefined>
}

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
export class RuntimeFacts extends Service {
  static Config: z<Config> = z.object({
    includeInRuntimeContext: z.boolean().default(true),
  })

  registerFact(fact: RuntimeFact): () => void
  list(): RuntimeFactInfo[]
  inspect(keys: readonly RuntimeFactKey[], context?: RuntimeFactContext): Promise<Record<string, RuntimeFactObservationResult<RuntimeFactValue>>>
  render(context: RuntimeFactContext): string
}
```

**sync projection consumer（R3-4）**：不注册 async waterfall 监听器；注册普通 sync context contributor：

```ts ignore-check
ctx.systemPrompt.context({
  name: 'runtime-facts',
  order: 120,
  text: (ac) => this.render({ scope: ac.scope }),
})
```

- **不改 Agent Loop**：`RuntimeContextProjection` 在 assemble 之后照常消费渲染文本。
- **Model-visible ⟺ logged**：投影文本最终经 `RuntimeContextProjection` 以 `user/message` 注入并可从 session log 重建。
- **B5 热 reload**：`text` 每 assembly 求值；`web.search-selected`（dynamic）每次读取最新 selection。
- **async facts 不进自动 context**：`credential-configured`、`net.reachable` 只在 `inspect()` 时求值。

### 2.2 Provider — host facts（`packages/context/runtime-facts-host`）

```ts ignore-check
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
  freshness: 'dynamic',
  exposure: 'baseline',
  resolveSync: () => pluginCtx.get('subprocess')?.executionWorld,
})

registry.registerFact({
  key: factKey('host.proxy.configured'),
  owner: 'runtime-facts-host',
  description: 'Whether a system proxy is configured (sanitized; never a raw URL).',
  evaluation: 'sync',
  freshness: 'static',
  exposure: 'inspect',
  resolveSync: () => sanitizeProxy(launchEnv).configured,
})

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
  freshness: 'dynamic',
  exposure: 'inspect',
  resolveSync: () => {
    const ws = pluginCtx.get('webServer')
    return ws === undefined ? undefined : `http://${ws.host}:${ws.port}`
  },
})
```

- **复用既有 owner 而非重复探测**：`runtime.execution-world` 读 `SubprocessRuntime.executionWorld`；`host.proxy.*` 委托 launch-environment；`web.server-url` 委托 `ctx.webServer.port`。
- **freshness 默认规则（R3.1-B2）**：凡值来自另一个可热加载 Service Provider 的 fact，一律 `dynamic`；V1 真正 `static` 仅 `host.os` / `host.arch` / `host.pid` / `host.proxy.*`。

### 2.3 Consumer — `runtime_inspect` tool

```jsonc
{ "kind": "facts", "keys": ["host.os", "web-search.exa.credential-configured"] }
{ "kind": "command", "command": "codex" }
```

- `kind="facts"`：`registry.inspect(keys)`，可 await async fact。
- `kind="command"`：调 `ctx.subprocess.resolveExecutable(...)`；`world` 字段来自 `ctx.subprocess.executionWorld`。
- 禁止为每个 command 预注册 fact。
- 只暴露安全事实；secret 永不出现。

### 2.4 Web / Provider → runtimeFacts optional 接线（R3.1-B3）

`web` / `web-search-exa` / `web-search-perplexity` 不得把 `runtimeFacts` 声明为硬注入。使用 `ctx.inject(['runtimeFacts'], cb)` + `effect` disposer：

```ts ignore-check
ctx.inject(['runtimeFacts'], (rctx) => {
  rctx.effect(() => {
    const dispose = rctx.runtimeFacts.registerFact({
      key: factKey('web.search-selected'),
      owner: 'web',
      description: 'Currently selected search provider id.',
      evaluation: 'sync',
      freshness: 'dynamic',
      exposure: 'baseline',
      relevance: { tools: ['web_search'] },
      resolveSync: () => resolveProvider(this.searchProviders, ...)?.id,
    })
    return () => dispose()
  })
})
```

生命周期必须测试：
- without `ctx.runtimeFacts`：Web 完整工作；
- runtimeFacts appears：facts 注册；
- runtimeFacts unloads：facts 自动撤回，Web 继续正常。

## 3. Settings Schema（Web Preference）

### 3.1 `web` namespace（owner：`WebRuntime`）

```yaml
web:
  searchProvider: exa
  fetchProvider: http
```

### 3.2 接线

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

- precedence：schema defaults → composition base（含 env 对同一字段的启动覆盖）→ user settings。
- live resolve：`search()`/`fetch()` 每次读 `source()`。

### 3.3 provider 内部配置（exa / perplexity）

- `web-search-exa`：Config 增 `apiKeyEnv?: string`（默认 `EXA_API_KEY`）。
- `web-search-perplexity`：同上（`PERPLEXITY_API_KEY`）。
- **secret literal precedence**：`explicit non-empty apiKey`（deprecated 兼容）> `apiKeyEnv`（经 `ctx.credentials.resolve`）。
- 新配置只写 `apiKeyEnv`；既有显式 `apiKey` 非空时仍 wins。

## 4. Runtime Fact Vocabulary（V1）

| key | owner | evaluation | freshness | exposure | 值示例 | 来源 |
|---|---|---|---|---|---|---|
| `host.os` | runtime-facts-host | sync | static | baseline | `win32` | `process.platform` |
| `host.arch` | runtime-facts-host | sync | static | baseline | `x64` | `process.arch` |
| `runtime.execution-world` | runtime-facts-host | sync | dynamic | baseline | `local` | `SubprocessRuntime.executionWorld` |
| `web.search-selected` | `web` | sync | dynamic | baseline（relevance: `web_search`） | `exa` | `resolveProvider()` |
| `web-search.exa.local-available` | `web-search-exa` | sync | dynamic | inspect | `true` | `provider.available()` |
| `web-search.exa.credential-configured` | `web-search-exa` | async | dynamic | inspect | `true` | `credentials.describe(ref).configured` |
| `host.pid` | runtime-facts-host | sync | static | inspect | `12345` | `process.pid` |
| `host.proxy.configured` | runtime-facts-host | sync | static | inspect | `true` | launch-environment → sanitize |
| `host.proxy.scheme` | runtime-facts-host | sync | static | inspect | `http` | 同上 |
| `host.proxy.host` | runtime-facts-host | sync | static | inspect | `proxy.example.com` | 同上 |
| `host.proxy.port` | runtime-facts-host | sync | static | inspect | `8080` | 同上 |
| `host.proxy.source` | runtime-facts-host | sync | static | inspect | `env` | 同上 |
| `web.server-url` | runtime-facts-host | sync | dynamic | inspect | `http://127.0.0.1:3080` | `webServer.port` |
| `net.reachable` | runtime-facts-host | async | dynamic | inspect | `true` | inspect probe（V1 默认不内置） |

V1 不注册：sandbox/workspace/session cwd/DSH_HOME/command-resolution per-key、`host.shell`、`web.search-operable`、`web-search.<id>.registered`。

## 5. Context Projection Algorithm

1. `render({ scope })` 只求值 `evaluation='sync'` + `exposure='baseline'` + relevance 命中。
2. static 可缓存一次；dynamic 每次求值。
3. 按 fact key 确定性排序。
4. async facts 只在 `runtime_inspect kind=facts` 中求值。
5. baseline 上限 4 行。

## 6. Precedence / Ownership Rules

1. ONE FACT ONE OWNER；同名 key 二次注册 fail loud。
2. 已有 owner 的事实不重复探测。
3. 配置 precedence 不引入新层。
4. Secret 永不进入 settings/fact/prompt；只暴露安全派生状态。
5. Preset/Mode 只影响 relevance，不改事实值。
6. 来自可热加载 Service Provider 的 fact 一律 dynamic。

## 7. Capability-Visible Projection

`RuntimeFacts` 自己持有 Cordis Service Context；`RuntimeFactContext` 只携带本次 fact 求值上下文（如 agent scope），不能拿它当 Cordis Context 用：

```ts ignore-check
private visible(
  factContext: RuntimeFactContext,
  relevance?: { tools: readonly string[] },
): boolean {
  if (relevance === undefined) return true
  if (factContext.scope === undefined) return false

  const tools = this.ctx.get('tools')
  return tools !== undefined
    && relevance.tools.every(
      name => tools.get(name, factContext.scope) !== undefined,
    )
}
```

- capability visibility authority = `ctx.tools`。
- `web.search-selected` 是唯一自动投影的 provider 状态。
- provider availability / credential 状态走 inspect。

## 8. Lifecycle / Hot Reload

| 事件 | 行为 |
|---|---|
| `registerFact` | effect 注册；dispose 自动移除。 |
| `ctx.inject(['runtimeFacts'])` | 服务出现 → Web/Provider 注册 facts；服务 unload → disposer 撤回；Web 不受影响。 |
| settings.yaml 编辑 | 下一次 `search`/`fetch` 生效；下一次 assembly 的 `web.search-selected` 重新求值。 |
| 正在执行的操作 | 使用进入操作边界时的旧 snapshot。 |

## 9. Error Semantics

- 注册冲突：load-time fail loud。
- sync 求值抛错：contained + logged，该 fact 当次 unavailable。
- async inspect 抛错/中止：probe-failure。
- inspect 未知 key：unknown。
- Web provider 失败维持既有 `WebError` 结构化码；V1 不 fallback。

## 10. Security / Secrets

1. `RuntimeFactValue` 仅 scalar。
2. `credential-configured` 只用 `credentials.describe(ref).configured`。
3. `runtime_inspect` 不返回 credential 值。
4. proxy 永不输出 raw URL；只输出 sanitized scalar facts。
5. `apiKeyEnv` 可进 settings；literal `apiKey` deprecated 且标 secret。
6. baseline 不含 PID/URL/network detail。
7. secret-leak tests 必须覆盖 proxy credentials 与 API key。

## 11. Compatibility

- **web-search-exa/perplexity**：`apiKey` config 字段保留（deprecated）；**显式非空 `apiKey` > `apiKeyEnv` credential resolution**。新配置推荐 `apiKeyEnv`；既有 `$EXA_API_KEY` 继续通过 credentials-local 环境层有效。
- **`WebRuntimeConfig.searchProvider`**：既有 composition 配置继续作 base 层。
- **`runtime_inspect` 与 `$DSH_*`**：互补，不替换。
- **Model-visible ⟺ logged**：runtime-context snapshot 与 tool 调用均已有日志路径。
- **agent-loop / system-prompt 不改**：只复用既有 extension point。

## 12. Tests

| 层 | 用例 |
|---|---|
| runtime-facts | key 校验、三正交维度、四态结果、relevance、排序、dispose |
| freshness | static 缓存一次；dynamic 每次求值 |
| async inspect | abort → probe-failure；单 fact 失败不影响其他 |
| optional lifecycle | without runtimeFacts / appears / unloads 三态 |
| subprocess executionWorld | local=`local`、e2b=`remote`；command.world 同一 authority |
| web settings | searchProvider 热改下一次操作生效 |
| provider credentials | apiKey wins；否则 resolve apiKeyEnv；inspect credential-configured |
| command inspect | `resolveExecutable` 结果 + world |
| secret-leak | 不泄露 raw proxy / apiKey |
| snapshot | `web.search-selected` 随 settings 更新且 replay 一致 |

## 13. Docs Changes

- 新 `docs/subsystems/runtime-facts.md`。
- 更新 `docs/subsystems/web.md`。
- 更新各新增/修改包 README。
- 重跑 generated catalogs / graphs。
- 新增 implemented Agent Note。

## 14. Rollout Order

1. subprocess `executionWorld` seam + runtime-facts + runtime-facts-host。
2. web settings namespace + live resolve。
3. exa/perplexity apiKeyEnv + inspect facts。
4. web.search-selected + relevance projection。
5. runtime_inspect（facts + command）。
6. docs / generators / gates / e2e。

## 15. V2 明确推迟

- provider fallback。
- unified readiness + `web.search-operable`。
- `host.shell` 自述。
- provider registry parameterized inspection。
- richer execution-world describe。
- public provider credential fact contract。
- async facts 自动 projection。
- OS keychain credentials。
- runtime facts SDK/ACP wire。
- Docker/GPU/MCP/browser facts。
- TTL / richer freshness metadata。
- settings value indirection。
- network reachability 自动 projection。
- proxy/CA/no_proxy 等更多敏感网络配置策略。
