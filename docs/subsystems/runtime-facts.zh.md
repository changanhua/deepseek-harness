# 运行时事实

[English](runtime-facts.md) | 中文

runtime-facts 子系统是一个有主注册表，用于记录当前 Harness 进程及其已挂载能力提供方的无 secret 标量观测。[`dsh-runtime-facts`](../../packages/context/runtime-facts) 是 Service Definition 和同步运行时上下文 Consumer；[`dsh-runtime-facts-host`](../../packages/context/runtime-facts-host) 是初始 Service Provider。声明的 owner 继续负责来源权威、清理，以及变化状态应归为 static 还是 dynamic。

源码：[`packages/context/runtime-facts/src/types.ts`](../../packages/context/runtime-facts/src/types.ts) 与 [`packages/context/runtime-facts/src/index.ts`](../../packages/context/runtime-facts/src/index.ts)

## 键、值与观测状态

键使用点分隔的小写 kebab-case 段。值保持为标量，使自动投影与检查可以确定性地紧凑渲染；标量限制不能代替提供方负责的 secret 清理。

```ts type-equiv
/** A dotted lowercase kebab-case runtime fact name. */
type RuntimeFactKey = Branded<'RuntimeFactKey'>
```

```ts type-equiv
/** Secret-free scalar value carried by a runtime fact. */
type RuntimeFactValue = string | boolean | number
```

观测会区分已返回值、未注册键、来源正常缺失，以及已收敛的 probe 失败。因此，消费方可以重试失败，而不会把不受支持的事实视为错误。

```ts type-equiv
/** Result of observing one runtime fact. */
type RuntimeFactObservationResult<T extends RuntimeFactValue = RuntimeFactValue> =
  | { readonly status: 'ok'; readonly value: T }
  | { readonly status: 'unknown' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'probe-failure'; readonly reason?: string }
```

## 三个相互独立的声明维度

evaluation 控制 resolver 时序，freshness 控制复用，exposure 控制自动投影。这些维度相互独立：例如，同步 dynamic inspect 事实有效；而异步 baseline 声明在实践中仍仅供 inspect，因为提示词组装绝不会等待事实 resolver。

```ts type-equiv
/** Whether a fact resolver completes synchronously or asynchronously. */
type RuntimeFactEvaluation = 'sync' | 'async'
```

```ts type-equiv
/** Whether one observation may be reused for the registration lifetime. */
type RuntimeFactFreshness = 'static' | 'dynamic'
```

```ts type-equiv
/** Whether a fact may enter automatic context or only explicit inspection. */
type RuntimeFactExposure = 'baseline' | 'inspect'
```

```ts type-equiv
/** Per-observation scope and cancellation input. */
interface RuntimeFactContext {
  readonly scope?: ScopeKey
  readonly signal?: AbortSignal
}
```

```ts type-equiv
/** Tool visibility required before a baseline fact is projected. */
interface RuntimeFactRelevance {
  readonly tools: readonly string[]
}
```

```ts type-equiv
/** One owned runtime fact declaration. */
interface RuntimeFact {
  readonly key: RuntimeFactKey
  readonly owner: string
  readonly description: string
  readonly evaluation: RuntimeFactEvaluation
  readonly freshness: RuntimeFactFreshness
  readonly exposure: RuntimeFactExposure
  readonly relevance?: RuntimeFactRelevance
  readonly resolveSync?: (context: RuntimeFactContext) => RuntimeFactValue | undefined
  readonly resolveAsync?: (
    context: RuntimeFactContext,
    signal?: AbortSignal,
  ) => Promise<RuntimeFactValue | undefined>
}
```

`list()` 会移除可执行 resolver，但保留全部策略元数据：

```ts type-equiv
/** Resolver-free metadata returned by the registry. */
interface RuntimeFactInfo {
  readonly key: RuntimeFactKey
  readonly owner: string
  readonly description: string
  readonly evaluation: RuntimeFactEvaluation
  readonly freshness: RuntimeFactFreshness
  readonly exposure: RuntimeFactExposure
  readonly relevance?: RuntimeFactRelevance
}
```

## 注册表与生命周期

每个键只能由一个活动 owner 注册。注册会在安装 effect 前校验 resolver 互斥性与 relevance 名称；重复所有权会快速失败。dispose owner 会移除声明及其缓存。static 同步事实会在注册时观测；static 异步事实共享并保留首次检查结果；dynamic 事实每次观测都重新解析。

`list()` 暴露不含 resolver 函数的元数据。`inspect()` 独立收敛每个 resolver，并返回所有请求状态。`render()` 只考虑同步 baseline 事实，通过 `ctx.tools` 针对所给作用域集中应用工具 relevance，按键排序可用行，并在无适用值时不返回文本。

## 宿主提供方

Host 提供方把 `host.arch`、`host.os` 与 `runtime.execution-world` 注册为 baseline 事实。它让 PID、清理后的代理元数据和当前已绑定 Web 服务器 URL 保持 inspect-only。进程常量与启动环境代理快照为 static；执行环境与 Web URL 为 dynamic，因为其 Service Provider 可以热加载。[subprocess 子系统](subprocess.zh.md)拥有权威的 local/remote 分类。

## 运行时上下文投影

注册表通过 `ctx.systemPrompt` 贡献 order-120 的 `runtime-facts` 上下文。提示词组装不求值任何异步 probe。可用行渲染为稳定片段，其完整的模型可见包装由 [system-prompt 子系统](system-prompt.zh.md)拥有。agent loop 会把变化后的片段记录为带来源的替换运行时上下文快照，因此模型可见事实可以从 Session 日志重建。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxruntimefacts--runtimefacts"></a>

### `ctx.runtimeFacts` — `RuntimeFacts`

Registry for uniquely owned runtime facts.

```ts cordis-catalog
/**
 * Register one uniquely owned fact for the calling plugin fiber.
 * @param declaration - resolver, ownership, projection, and freshness declaration.
 * @returns the exact effect disposer that removes the fact and its cached observation.
 * @throws when the declaration is malformed or its key already has an owner.
 */
registerFact(declaration: RuntimeFact): () => Promise<void>

/**
 * List resolver-free fact declarations in code-unit key order.
 * @returns detached metadata that callers may not use to mutate a registration.
 */
list(): RuntimeFactInfo[]

/**
 * Observe selected facts, awaiting asynchronous resolvers while containing each failure.
 * @param keys - valid fact keys; an unregistered key produces `unknown`.
 * @param context - optional scope and cancellation signal.
 * @returns one observation per requested key.
 */
async inspect( keys: readonly RuntimeFactKey[], context: RuntimeFactContext = {}, ): Promise<Record<string, RuntimeFactObservationResult>>

/**
 * Render available synchronous baseline facts in code-unit key order.
 * @param context - scope used for centralized tool-relevance filtering.
 * @returns the complete compact snapshot, or an empty string when none is active.
 */
render(context: RuntimeFactContext): string
```

Source: [`packages/context/runtime-facts/src/index.ts`](../../packages/context/runtime-facts/src/index.ts)
<!-- END GENERATED cordis-surface -->
