# Runtime Awareness + User Preference Plane — Implementation Spec（R2）

> 决策依据：`architecture-decision.md`（B1–B16、Ownership Matrix、方案 C、async assembly projection）。现状盘点：`repository-facts.md`。V1 目标：Agent 不猜宿主事实；用户有稳定位置表达长期 capability preference 且 Agent 知道当前真正生效的状态。不造万能配置平台，不做 Doctor。R2 变更：`RuntimeFact` API 增加 observation 语义（sync/async、unknown/unavailable/probe-failure）；投影改走 `system-prompt/assemble` async waterfall；fact key 统一 kebab-case；`runtime_inspect` 用 tagged union；provider 示例改用仓库已有 provider。

## 1. Package / File Changes（总览）

### 新增包（3 个）

| 包 | 角色 | ctx key / 产物 |
|---|---|---|
| `packages/context/runtime-facts` | Runtime Fact registry（Service Definition；含 async projection waterfall consumer） | `ctx.runtimeFacts` |
| `packages/context/runtime-facts-host` | host 事实 provider（OS/arch/pid/proxy/execution-world/server-url，owner 委托各域） | 注册到 `ctx.runtimeFacts` |
| `packages/extensions/tool-runtime-inspect` | model-facing `runtime_inspect` tool（Consumer，tagged union：facts/command） | 注册到 `ctx.tools` |

> R2-P1：`tool-runtime-inspect` 定义 tool，违反 context 组契约（"request-context extensions WITHOUT defining a tool"，`packages/context/README.md:5`），移入 `packages/extensions/`（与 `tool-cordis` 同类：model-facing runtime inspection tool，`packages/extensions/README.md:9`）。 R2-P2：`runtime-facts-baseline` 更名 `runtime-facts-host`——该包承载的是"宿主事实"（baseline + inspect 都有），包名不再声称仅 baseline；cost 是 fact 级属性。

### 修改的包（4 个）

| 包 | 改动 |
|---|---|
| `packages/web/web` | 注册 `web` settings namespace；`searchProvider`/`fetchProvider` live resolve（`installSettingsSection`）；导出 `web-search.<id>.registered`、`web.search-selected`、`web.search-operable` 状态给投影（owner 归 `web` 包，R2-B5） |
| `packages/web/web-search-exa` | 增 `apiKeyEnv` + settings namespace，走 `ctx.credentials`；声明 `web-search.exa.local-available`（sync）与 `web-search.exa.credential-configured`（async）fact（owner 归 provider 包，R2-B5） |
| `packages/web/web-search-perplexity` | 同上（`perplexity` id） |
| `packages/web/tool-web` | 不改（selection/effective 由 `WebRuntime` 计算；tool-web 只调 `ctx.web.search`） |

### 新增/修改文档

- `docs/subsystems/runtime-facts.md`（新，含 generated cordis-surface）
- `docs/subsystems/web.md`（补 settings section、状态词投影，生成区自动）
- `packages/context/runtime-facts/README.md`、`runtime-facts-host/README.md`、`packages/extensions/tool-runtime-inspect/README.md`（新）
- `packages/web/web/README.md`、`web-search-exa/README.md`、`web-search-perplexity/README.md`（改）
- `docs/config-catalog.md` / `docs/tool-catalog.md` / `docs/capability-seams.md`（生成，随代码重跑）
- Agent Note（新，见 §13）

## 2. Service Definition / Provider / Consumer

### 2.1 `ctx.runtimeFacts` — Service Definition（`packages/context/runtime-facts`）

**observation 语义（R2-B1 / R2 额外要求 3）**：不再让 `undefined` 同时承担全部状态。每次观察返回 discriminated result：

```ts ignore-check
// packages/context/runtime-facts/src/types.ts
/** fact 名。品牌类型：每段 ^[a-z][a-z0-9-]*$，段以 '.' 分隔（R2-B4 机械校验）。 */
type RuntimeFactKey = Branded<'RuntimeFactKey'>

/** 观察方式：sync = 本地同步可得；async = 需要 await（credential describe / probe）。 */
type RuntimeFactObservation = 'sync' | 'async'
/** cost：baseline = 进 runtime context；inspect = 仅按需查询（可能昂贵）。 */
type RuntimeFactCost = 'baseline' | 'inspect'

/** fact 值：简单标量。secret 永不出现。 */
type RuntimeFactValue = string | boolean | number

/** 一次观察的结果：明确区分四种状态，undefined 只表示"值本身缺省"，不承载状态。 */
type RuntimeFactObservationResult<T extends RuntimeFactValue> =
  | { status: 'ok'; value: T }
  | { status: 'unknown' }            // key 未注册 / 尚无数据（inspect 未知 key）
  | { status: 'unavailable' }        // fact 存在但当前不可得：provider 未注册、credential 未配置、scope 不适用
  | { status: 'probe-failure'; reason?: string }  // async probe 抛错 / 超时 / 中止

/** 一次投影/查询的求值上下文。scope = agent（assemble 的 AssembleContext.scope 即 agent）。 */
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
  readonly observation: RuntimeFactObservation
  readonly cost: RuntimeFactCost
  /** sync 求值（observation='sync'）。undefined → unavailable。 */
  resolveSync?(context: RuntimeFactContext): RuntimeFactValue | undefined
  /** async 求值（observation='async'）。undefined → unavailable；throw/abort → probe-failure。 */
  resolveAsync?(context: RuntimeFactContext, signal?: AbortSignal): Promise<RuntimeFactValue | undefined>
  /** 是否投影进 runtime context。缺省：cost === 'baseline'。owner 经 ctx.tools 判定可见性（B8/B15）。 */
  projectWhen?(context: RuntimeFactContext): boolean
}

/** 枚举声明，供 UI/诊断/inspect 列表（不执行 resolve）。 */
interface RuntimeFactInfo {
  readonly key: RuntimeFactKey
  readonly owner: string
  readonly description: string
  readonly observation: RuntimeFactObservation
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

  registerFact(fact: RuntimeFact): () => void
  list(): RuntimeFactInfo[]
  /** 求值指定 facts（runtime_inspect 走这里）。未知 key → unknown；存在但不可得 → unavailable；async 失败 → probe-failure。 */
  inspect(keys: readonly RuntimeFactKey[], context?: RuntimeFactContext): Promise<Record<string, RuntimeFactObservationResult<RuntimeFactValue>>>
  /** 求值当前应投影的 facts 并渲染为模型可见文本（async：可 await credential describe / probe）。空 → ''。 */
  render(context: RuntimeFactContext, signal?: AbortSignal): Promise<string>
}
```

**async projection consumer（R2-B1/B13）**：不注册 sync `systemPrompt.context()` 贡献者；改注册 `system-prompt/assemble` **waterfall 监听器**（`packages/core/system-prompt/src/index.ts:532-535` 的 async waterfall 返回权威 assembly；agent-loop `preStep` 已 `await assemble()`，`packages/core/agent-loop/src/agent.ts:230`）：

```ts ignore-check
// runtimeFacts 构造内（全局注册；scope 过滤经 AssembleContext.scope）
ctx.on('system-prompt/assemble', async (assembly, assembleCtx, next) => {
  const base = await next()
  const scope = assembleCtx.scope
  const text = await this.render({ scope, signal: assembleCtx.signal })
  if (text.length === 0) return base
  const contexts = base.contexts.filter(c => c.name !== 'runtime-facts')
  return { ...base, contexts: [...contexts, { name: 'runtime-facts', text }] }
})
```

- **不改 Agent Loop**：`preStep` 已 await assemble；`RuntimeContextProjection` 在 assemble 之后照常消费渲染文本（`agent.ts:232-233`）。
- **Model-visible ⟺ logged**：投影文本最终经 `RuntimeContextProjection` 以 `user/message` 注入并可从 session log 重建，无需新 session event。
- **七项语义**（deterministic ordering / error containment / cancellation / replay / snapshot dedupe / token budget / scope visibility）见 `architecture-decision.md §4`；本节 2.4 给实现约束。

### 2.2 Provider — host facts（`packages/context/runtime-facts-host`）

```ts ignore-check
// 注册样例（owner 委托各域，避免重复实现探测；fact key 全小写 kebab）
registry.registerFact({
  key: factKey('host.os'),
  owner: 'runtime-facts-host',
  description: 'Operating system of the host process.',
  observation: 'sync',
  cost: 'baseline',
  resolveSync: () => normalizeOs(process.platform),
})
registry.registerFact({
  key: factKey('host.pid'),
  owner: 'runtime-facts-host',
  description: 'Process id of the DSH host process.',
  observation: 'sync',
  cost: 'inspect',
  resolveSync: () => process.pid,
})
registry.registerFact({
  key: factKey('host.proxy'),
  owner: 'runtime-facts-host',
  description: 'Configured system proxy, sanitized (scheme/host/port/source; never a raw URL).',
  observation: 'sync',
  cost: 'inspect',
  resolveSync: () => sanitizeProxy(launchEnvironmentOf(ctx).get('HTTP_PROXY') ?? launchEnvironmentOf(ctx).get('HTTPS_PROXY')),
})
registry.registerFact({
  key: factKey('web.server-url'),
  owner: 'runtime-facts-host',
  description: 'DSH web server URL (host/port owned by ctx.webServer).',
  observation: 'sync',
  cost: 'inspect',
  resolveSync: () => { const ws = ctx.get('webServer'); return ws === undefined ? undefined : `http://${ws.host}:${ws.port}` },
})
```

- **复用既有 owner 而非重复探测**：`runtime.execution-world` 委托 subprocess provider；`host.proxy` 委托 `launch-environment` 快照（`repository-facts.md §7.4`）；`web.server-url` 委托 `ctx.webServer.port`（**R2-P3：peerDeps 必须列 webserver**）；sandbox mode / session cwd / `DSH_HOME` / command resolution 不注册（已有 owner，见 §4 禁止清单）。

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

- `kind="facts"`：`registry.inspect(keys)`。返回每 key 的 `{status, value|reason}`（ok / unknown / unavailable / probe-failure）。省略 `keys` 返回 baseline + 可查询列表。
- `kind="command"`：调 **`ctx.subprocess.resolveExecutable(command, env?, signal)`**（`packages/subprocess/subprocess/src/index.ts:107-122`，authority 复用）。返回结构化结果：

```jsonc
{ "kind": "command", "command": "codex", "resolved": "C:\\...\\codex.exe", "world": "local" }
{ "kind": "command", "command": "codex", "status": "unavailable", "reason": "was not found on PATH" }
```

- **禁止为每个 command 预注册 fact**（B16）：command 是 parameterized inspector，不枚举。
- 只暴露安全事实；secret 永不出现。`apiKeyEnv` 只回 `credential-configured`。
- 注册到 `ctx.tools` + 一条 `systemPrompt.section` 稳定指导："Use runtime_inspect to query authoritative host/runtime facts or resolve a command instead of guessing environment details."

## 3. Settings Schema（Web Preference）

### 3.1 `web` namespace（owner：`WebRuntime`）

```yaml
# $DSH_HOME/settings.yaml —— 用户编辑入口（R2-P4：用仓库已有 provider，不用不存在的 Tavily）
web:
  searchProvider: exa          # 用户偏好：默认搜索 provider（exa/perplexity/deepseek）
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

### 3.3 provider 内部配置（exa / perplexity 迁移，B3）

- `web-search-exa`：Config 增 `apiKeyEnv?: string`（默认 `EXA_API_KEY`）；`apiKey` 保留（`role('secret')`）但优先用 `apiKeyEnv` 经 `ctx.credentials.resolve`（每 search 一次）。注册 `web-search-exa` settings namespace（schema 含 `apiKeyEnv`/`baseURL`/`searchType`/…，web-search-deepseek 同构）。
- `web-search-perplexity`：同上（`PERPLEXITY_API_KEY`）。
- **兼容**：`apiKey` 显式设置时仍生效（非空 wins）；`.env` 既有 `$EXA_API_KEY` 继续作为 credentials 兜底层（credentials-local 的 user/project env 层），不破坏现状。

## 4. Runtime Fact Vocabulary（V1 清单，R2：kebab-case + owner 闭合 + observation）

| key | owner | observation | cost | 值示例 | 来源 |
|---|---|---|---|---|---|
| `host.os` | runtime-facts-host | sync | baseline | `win32` | `process.platform` |
| `host.arch` | runtime-facts-host | sync | baseline | `x64` | `process.arch` |
| `runtime.execution-world` | runtime-facts-host | sync | baseline | `local` | 委托 `ctx.subprocess`（E2B → `remote`） |
| `web-search.exa.registered` | `web` 包（`WebRuntime` 注册表） | sync | baseline（capability-visible） | `true` | `WebRuntime` 注册表 |
| `web-search.exa.local-available` | `web-search-exa` 包 | sync | baseline（capability-visible） | `true` | `provider.available()` |
| `web-search.exa.credential-configured` | `web-search-exa` 包 | **async** | baseline（capability-visible） | `true` | `credentials.describe(ref).configured` |
| `web.search-selected` | `web` 包（selection） | sync | baseline（capability-visible） | `exa` | `resolveProvider()` 结果 |
| `web.search-operable` | `web` 包（effective） | **async** | baseline（capability-visible） | `true` | selected × credential-configured；操作边界权威 |
| `host.pid` | runtime-facts-host | sync | inspect | `12345` | `process.pid` |
| `host.shell` | runtime-facts-host | sync | inspect | `pwsh` | 委托 shell provider 自述 |
| `host.proxy` | runtime-facts-host | sync | inspect | `{configured,scheme,host,port,source}` | launch-environment → sanitize（**不 raw URL**） |
| `web.server-url` | runtime-facts-host（委托 `ctx.webServer`） | sync | inspect | `http://127.0.0.1:3080` | `webServer.port` |
| `net.reachable` | runtime-facts-host | **async** | inspect | `true` | inspect 时 probe（V1 可选，默认不内置） |

> 禁止注册（重复 owner）：sandbox mode / workspace root（sandbox-policy 已投影）、session cwd（SessionHeader）、`DSH_HOME`（shell-env 已有）、command resolution（inspect 走 `resolveExecutable`，不预注册 per-command fact）。 R2-B5：provider 专属状态（`local-available`、`credential-configured`）owner = 各 provider 包；selection/effective（`web.search-selected`、`web.search-operable`）owner = `web` 包。无二选一。

## 5. Context Projection Algorithm（R2：async assembly projection）

**触发点**：每次模型请求前 `systemPrompt.assemble()`（async）→ runtimeFacts 的 `system-prompt/assemble` waterfall 监听器。

1. `render({ scope, signal })`：
   - 遍历 `list()`，过滤 `projectWhen === undefined ? cost === 'baseline' : projectWhen(ctx)`。
   - `projectWhen` 由 fact owner 经 **`ctx.tools.get(capabilityName, scope)`** 判定可见性（authority = ctx.tools，不反查 systemPrompt）。
   - sync fact：`resolveSync`；async fact：`await resolveAsync(signal)`（每 fact 独立 try/catch，失败记为 unavailable/probe-failure，**contained，不炸 assemble**）。
2. 渲染（确定性，按 key 排序）：
   ```text
   Host runtime facts:
   - host.os: win32
   - host.arch: x64
   - runtime.execution-world: local
   - web-search.exa.registered: true
   - web-search.exa.local-available: true
   - web-search.exa.credential-configured: true
   - web.search-selected: exa
   - web.search-operable: true
   ```
   无命中 → 返回原 assembly（不注入空 context）。
3. `RuntimeContextProjection` 照常：文本变化才注入新 `user/message` snapshot；replacement 发 CLEARED；replay 从 log 恢复（`packages/core/agent-loop/src/runtime-context.ts`）。
4. **cancellation**：async probe 用 `abortable(..., signal)`（`web-search-deepseek/src/provider.ts:283` 同款）；abort → probe-failure。
5. **token 控制**：baseline 恒短（≤6 行）；capability-scoped 命中才加行；长尾走 `runtime_inspect`。V1 baseline 严格 ≤6 个 fact；新增 baseline fact 需 Agent Note 论证。

## 6. Precedence / Ownership Rules

1. ONE FACT ONE OWNER：`registerFact` 同名 key 第二次 → `throw`（fail loud at load，shell-env keyOwners 同风格，`packages/shell/shell-env/src/index.ts:131-134`）。
2. 已有 owner 的事实不重复探测：§4 禁止清单 + `repository-facts.md` owner 表。
3. 配置 precedence 保持仓库既定单一顺序（B4），不发明新层。
4. Secret 永不进 settings / fact 值 / prompt；只允许 `credential-configured` 安全事实（B3）。
5. Preset/Mode 只经 `projectWhen`/scope 影响 relevance，不改 fact 值（B9）。
6. sync fact 注册时求值缓存；async fact 每次 probe；无自动过期（V1）。

## 7. Capability-Visible Projection（B6/B8/B15）

**原则**：`runtimeFacts` 保持 capability-neutral（不盘点能力、不枚举缺失）；事实"该不该投影"由 **fact owner 自判**（`projectWhen`）；可见性判定 authority = **`ctx.tools`**。

- `projectWhen` 实现示例（owner 自判 + `ctx.tools` 查询）：
  ```ts ignore-check
  projectWhen(ctx) {
    return ctx.scope !== undefined
      && ctx.get('tools').get('web_search', ctx.scope) !== undefined
  }
  ```
  **不复制 visibility resolver**：只用 `ToolRuntime.get(name, scope)`（`packages/core/tools/src/index.ts:1204`），它已含 inherited + scoped + restrictions + reserved transport（`view(scope)`，:1152）。
- effective state（B6）：`web.search-selected`（sync，`resolveProvider` 结果）+ `web.search-operable`（async，selected × credential-configured；**仅在操作边界权威**，投影值为"当前可判定为具备执行前提"，不保证下一次调用成功）。
- `sandbox:policy` 无条件 context 保持（A 级 baseline，不变）。

## 8. Lifecycle / Hot Reload

| 事件 | 行为 |
|---|---|
| 插件 mount / `registerFact` | effect 注册；`system-prompt/assemble` 监听器随 fiber dispose 移除。 |
| HMR / 插件 reload | facts 随 fiber 移除；settings namespace 留在存储给下一 owner（`packages/settings/settings/src/index.ts:863-897`）。 |
| settings.yaml 外部编辑 | watcher 热发布 → `settings/updated` → WebRuntime `setSource` 更新 → 下一次 `search`/`fetch` 生效（B5）；若改变 `web.search-selected`/`operable` 渲染，下一次 assembly 的 snapshot 变化 → `RuntimeContextProjection` 注入新 snapshot。 |
| settings 写入失败 / 非法 | settings-file warn-and-keep-last-good；WebRuntime 保持 last good source。 |
| 进程重启 | settings.yaml 与 `.credentials.yaml` 持久；fact 重新注册求值；`runtime_inspect` 无跨进程状态。 |
| 一致性边界（B5） | 一次 `search`/`fetch` 执行边界 resolve 一次 source + credential；执行中外部编辑不改变正在进行的调用（旧 snapshot 至本次结束）。 |

## 9. Error Semantics（R2：区分 unknown / unavailable / probe-failure）

- **注册冲突**：`throw new Error('runtime fact "host.os" is already owned by "runtime-facts-host"; "x" cannot also own it')`——fail loud at load。
- **求值失败（sync）**：`resolveSync` 抛错 → contained + logged，该 fact 当次 `unavailable`（不炸请求、不炸 assembly）。
- **求值失败（async）**：`resolveAsync` 抛错/中止 → `probe-failure`（含 reason），contained + logged；区别于"正常不可得"的 `unavailable`。
- **inspect 未知 key**：`unknown`（不报错，便于模型迭代查询）。
- **WebError 保持**：provider selection 失败仍抛 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` 等结构化码；V1 **不自动 fallback**（B12），只把失败原因投影（`web.search-selected` 仍可选中的 id；`web.search-operable: false` + `unavailable: <WebError code>`），模型据实行动。

## 10. Security / Secrets（R2：含 proxy sanitize）

1. fact 值契约禁止含 secret；`RuntimeFactValue` 只允许 string/boolean/number。
2. `credential-configured` 只派生自 `credentials.describe(ref).configured`，不碰值。
3. `runtime_inspect` 无写路径、不读 `.credentials.yaml` 内容、不 resolve 出值返回模型。
4. **`host.proxy`（R2-B6）**：永不把 `HTTP_PROXY`/`HTTPS_PROXY` raw URL 放进 model-visible fact。代理 URL 可含 `user:pass@`/token/query，**只投影 sanitized 表示**：
   ```jsonc
   { "configured": true, "scheme": "http", "host": "proxy.example.com", "port": 8080, "source": "env" }
   ```
   sanitize 丢弃 username/password/token/query/path；无法解析的 URL → `configured: false`。
5. web 的 `apiKeyEnv`（reference 名）可进 settings（非 secret）；`apiKey` 保持 `role('secret')`，wire/describe 自动剥离（`packages/settings/settings/src/index.ts:98-100`）。
6. baseline projection 不含 PID/URL/网络细节；`host.pid`/`web.server-url`/`host.proxy` 归 inspect。
7. **secret-leak tests**（新增）：断言所有 model-visible 输出（projection 渲染 + `runtime_inspect` 结果）不含 `://` 凭据段（`user:pass@`）、不含 `apiKey` 值、不含 proxy raw URL。

## 11. Compatibility

- **web-search-exa/perplexity**：`apiKey` config 字段保留（deprecate），新 `apiKeyEnv` 优先；`.env` 既有 `$EXA_API_KEY` 继续有效（credentials-local env 层）。settings namespace 是纯增量。
- **`WebRuntimeConfig.searchProvider`**：既有 composition 配置继续作 base 层，行为不变（user 层为空时等于现状）。
- **`runtime_inspect` 与 `$DSH_*`**：tool-bash 的 `$DSH_*` 提示保留；`runtime_inspect` 是补充（OS/pid/port/network/command 维度），不替换。
- **Model-visible ⟺ logged**：新模型可见输入两类——(a) runtime-context snapshot（经 `system-prompt/assemble` + `RuntimeContextProjection`，已 logged）；(b) `runtime_inspect` tool 调用（已 logged）。**不需要新 session event**。
- **agent-loop / system-prompt 不改**：投影走现有 `system-prompt/assemble` waterfall + `RuntimeContextProjection`；relevance 由 fact owner 经 `ctx.tools` 判定。

## 12. Tests

| 层 | 用例 |
|---|---|
| runtime-facts 单测 | 注册冲突 throw；key 校验（kebab-case，拒绝 `executionWorld` 等）；sync/async 观察；四种结果状态（ok/unknown/unavailable/probe-failure）；`projectWhen` 过滤；渲染确定性排序；dispose 移除 |
| runtime-facts async | async fact abort → probe-failure；一个 async fact 失败不影响其他 fact（contained） |
| runtime-facts invariant | 注册/生命周期 owner 关系断言 |
| runtime-facts HMR | dispose fiber 后 fact 与 assemble 监听器移除 |
| web settings live resolve | `searchProvider` 热改后下一次 `search` 用新 provider；执行中调用用旧值 |
| exa/perplexity apiKeyEnv | credentials resolve 每调用；`apiKey` 兼容优先；`local-available`/`credential-configured` 语义 |
| **runtime_inspect command（R2-B3）** | `kind=command` → `resolveExecutable` → structured result；`world` 字段；unavailable（PATH 未命中） |
| **runtime_inspect secret-leak（R2-B6）** | projection 与 inspect 输出不含 `user:pass@`、不含 apiKey 值、不含 proxy raw URL |
| snapshot 测试 | runtime-context snapshot（含 `web.search-selected`/`operable`）随 settings 变化更新；replay 重建一致 |
| web 集成 | `WebError` 码在 `web.search-operable` 投影中可见（`operable: false` + reason） |

## 13. Docs Changes

- 新 `docs/subsystems/runtime-facts.md`（registry 契约 + observation 语义 + generated cordis-surface）。
- `docs/subsystems/web.md`：补 `web` settings section、状态词投影、`apiKeyEnv` 迁移。
- 各 README 按 package 契约规则更新（config keys、wire fields、Model Experience）。
- `docs/architecture.md`：不改 loop；extension points 表可补 `runtime_inspect` 一行（可选）。
- 生成目录：`config-catalog`、`tool-catalog`、`capability-seams`、`module-graph` 随 `pnpm run gen-*` 重跑。
- **Agent Note**：本任务属于非平凡架构改动，必须新增 implemented 笔记（§14 首条）。

## 14. Rollout Order

1. **runtime-facts 包**（SD + observation 语义 + async assemble 监听器 + invariant + 单测）——独立可落地。
2. **web settings namespace + WebRuntime live resolve**（B2/B5）。
3. **exa/perplexity apiKeyEnv 迁移 + provider 状态 fact**（B3/B5）。
4. **`web.search-selected`/`operable` + capability-visible projection**（B6/B8/B15）。
5. **`runtime_inspect` tool（facts + command）**（A2/B3/B16）。
6. **docs + gates**：README、subsystem 页、生成目录重跑、`verify-*` 全绿。
7. 每步独立可评审；3-4 步依赖 1-2。

## 15. V2 明确推迟（B12 展开）

- 通用 provider fallback（preference ordering × availability × transient failure）：V1 只做状态投影 + 显式失败。
- OS keychain credential provider（`repository-facts.md §4.2` deferred）。
- runtime fact 进程外查询面（SDK/ACP wire）。
- Docker/GPU/MCP/浏览器 fact 类型与 relevance 规则。
- per-fact 自动过期 TTL / freshness 元数据。
- settings value indirection（`${env:VAR}`）。
- `reachable`（网络探针）自动进 projection（V1 仅 inspect）。
- `host.proxy` 之外的敏感环境事实（如带凭据的 CA 变量）的 sanitize 策略扩展。
