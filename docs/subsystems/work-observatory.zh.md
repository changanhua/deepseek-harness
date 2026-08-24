# Work Observatory

[English](work-observatory.md) | 中文

[`@deepseek-ai/dsh-host-work-observatory`](../../packages/host/work-observatory) 把浏览器在场与 Agent 步骤的保守墙钟证据记录到独立版本控制的 SQLite 数据库。Host 接收时钟具有权威性：浏览器时间戳只用于诊断，Agent 证据来自规范 Session 事件。服务暴露直接 Remote `workObservatory/observeClient` 与 `workObservatory/range`，不改写 Session 日志或模型输入。

源码：[`types.ts`](../../packages/host/work-observatory/src/types.ts)、[`index.ts`](../../packages/host/work-observatory/src/index.ts)

## Remote 数据词汇

```ts type-equiv
/** One browser-document activity snapshot delivered to the Host. */
interface ClientObservation {
  /** Fresh identity for one document lifecycle. */
  readonly clientId: string
  /** Monotonic producer sequence used for duplicate and reordering rejection. */
  readonly seq: number
  /** Whether the DSH main document is currently visible. */
  readonly visible: boolean
  /** Whether the visible, focused document has recent interaction. */
  readonly active: boolean
  /** Browser timestamp retained only for diagnostics; never used for accounting. */
  readonly clientObservedAt: number
}
```

```ts type-equiv
/** Acceptance result for one browser observation. */
interface ClientObservationAck {
  /** False when the sequence was duplicate or older than accepted state. */
  readonly accepted: boolean
}
```

```ts type-equiv
/** Inclusive start and exclusive end in Host epoch milliseconds. */
interface WorkInterval {
  readonly start: number
  readonly end: number
}
```

```ts type-equiv
/** Host range query over one non-empty epoch interval. */
interface WorkObservatoryRangeRequest {
  readonly from: number
  readonly to: number
}
```

```ts type-equiv
/** Normalized Work Observatory durations and source timelines for one range. */
interface WorkObservatoryRange {
  readonly from: number
  readonly to: number
  readonly summary: {
    readonly humanActiveMs: number
    readonly pageVisibleMs: number
    readonly agentRunningMs: number
    readonly agentSoloMs: number
    readonly togetherMs: number
  }
  readonly timeline: {
    readonly humanActive: readonly WorkInterval[]
    readonly pageVisible: readonly WorkInterval[]
    readonly agentRunning: readonly WorkInterval[]
  }
}
```

## Human 证据

每个浏览器文档使用新的 `clientId` 与单调递增的 `seq`。一个 SQLite 事务拒绝重复或乱序观测且不刷新证据，校验 `active` 蕴含 `visible`，在 Host 接收时间关闭发生变化的区间，并持久化新状态。产生方失联时，区间结束于最后一条已接受证据，而不是扫描时间；若扫描尚未运行，范围查询也会对仍开放的区间应用同一上限。多个浏览器文档会先做并集，因此重叠标签页不会重复累计时间。

## Agent 证据与回放

记录以 `(session_id, turn, step)` 为键。`step/start` 打开步骤，`step/end` 权威关闭步骤；低频的 `assistant/message`、`tool/call` 与 `tool/result` 事件推进崩溃证据，token 级 chunk 不写数据库。启动时先把遗留的开放记录关闭到最后证据，再接管当前 Session 并幂等回放规范事件。子 Session 回放会排除 `SessionHeader.seedLength` 之前的事件，避免再次累计继承的父历史。观测与回放故障会记录日志并被隔离，因此可观测性不会拒绝 Session 发布。

## 范围代数

`range` 把源记录裁剪到请求的非空半开区间，并规范化 Page Visible（`V`）、Human Active（`H`）与 Agent Running（`A`）。Together 派生为 `H ∩ A`，Agent Solo 派生为 `A - H`；概述时长使用相同的规范化数组。发布前断言 `H ⊆ V` 且 `Agent Solo + Together = Agent Running`。开放 Agent 步骤延伸到 `min(now, to)`，开放 Human 区间只延伸到最后浏览器证据。

## 限制

- Human Active 是可见性、焦点与近期交互代理，不是注意力证明。
- Agent Running 是步骤墙钟时间，可能包含模型工作、工具、等待用户及等待子 Agent；它既不是计算时间，也不是节省的人工时间。
- 一个 Host 被视为一个用户；schema 不携带操作者或租户身份。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkobservatory--workobservatorygateway"></a>

### `ctx.workObservatory` — `WorkObservatoryGateway`

Host Remote owning Work Observatory persistence, capture, and range derivation.

```ts cordis-catalog
/**
 * Accept one browser snapshot using the Host receive clock.
 * @param input - browser state and monotonic producer sequence.
 * @returns whether this snapshot advanced persisted producer state.
 */
@Remote('observeClient') observeClient(input: ClientObservation): ClientObservationAck

/**
 * Return normalized Human and Agent timelines and their shared summary algebra.
 * @param input - non-empty Host epoch range.
 * @returns normalized source timelines and derived metric durations.
 */
@Remote('range') range(input: WorkObservatoryRangeRequest): WorkObservatoryRange
```

Source: [`packages/host/work-observatory/src/index.ts`](../../packages/host/work-observatory/src/index.ts)
<!-- END GENERATED cordis-surface -->
