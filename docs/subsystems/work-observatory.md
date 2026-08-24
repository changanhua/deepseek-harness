# Work Observatory

English | [中文](work-observatory.zh.md)

[`@deepseek-ai/dsh-host-work-observatory`](../../packages/host/work-observatory) records conservative wall-clock evidence for browser presence and Agent steps in an independently versioned SQLite database. The Host receive clock is authoritative: browser timestamps are diagnostic only, and canonical Session events supply Agent evidence. The service exposes direct `workObservatory/observeClient` and `workObservatory/range` Remotes; it does not alter the Session log or model input.

Sources: [`types.ts`](../../packages/host/work-observatory/src/types.ts), [`index.ts`](../../packages/host/work-observatory/src/index.ts)

## Remote vocabulary

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

## Human evidence

Each browser document uses a fresh `clientId` and monotonic `seq`. One SQLite transaction rejects duplicate or reordered observations without refreshing evidence, validates `active` implies `visible`, closes changed intervals at Host receive time, and persists the new state. A missing producer closes at its last accepted evidence rather than at sweep time; a range query applies the same ceiling to an interval that remains open before the sweep runs. Multiple browser documents are unioned, so overlapping tabs never multiply credited time.

## Agent evidence and replay

Rows are keyed by `(session_id, turn, step)`. `step/start` opens a step, `step/end` closes it authoritatively, and low-frequency `assistant/message`, `tool/call`, and `tool/result` events advance crash evidence; token-level chunks do not write the database. Startup first closes orphaned open rows to their last evidence, then adopts current Sessions and replays canonical events idempotently. Events before `SessionHeader.seedLength` are excluded from child replay, preventing inherited parent history from being counted again. Observer and replay failures are logged and contained so observability cannot reject Session publication.

## Range algebra

`range` clips source rows to the requested non-empty half-open interval and normalizes Page Visible (`V`), Human Active (`H`), and Agent Running (`A`). It derives Together as `H ∩ A` and Agent Solo as `A - H`; summary durations use those same normalized arrays. Publication asserts `H ⊆ V` and `Agent Solo + Together = Agent Running`. An open Agent step reaches `min(now, to)`, while an open Human interval reaches only its last browser evidence.

## Limits

- Human Active is a visibility, focus, and recent-interaction proxy, not proof of attention.
- Agent Running is step wall time and may include model work, tools, user waits, and child-Agent waits; it is neither compute time nor saved human time.
- One Host is treated as one user; the schema carries no actor or tenant identity.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
