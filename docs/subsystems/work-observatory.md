# Work Observatory

English | [中文](work-observatory.zh.md)

Work Observatory is a local evidence view for answering a narrow question: during a selected day or project, when was the Web page visible, when was a person recently active, and when was at least one Session step open? It presents observed wall-clock intervals and never translates them into productivity, effort, CPU use, or time saved.

Source: [`packages/host/work-observatory`](../../packages/host/work-observatory) and [`packages/client/ui-work-observatory`](../../packages/client/ui-work-observatory)

## User flow

Open **Work Observatory** from the persistent sidebar. Select a local calendar date; the page converts it to the correct local midnight boundaries, including daylight-saving transitions. If the current Session belongs to a project, the query follows its canonical `cwd`. The 24-hour band shows source intervals before five totals, and each contributing Session row opens that Session.

The totals mean:

- **Human active** — the page is visible and focused after a recent pointer, keyboard, wheel, or touch interaction.
- **Page visible** — the browser reports the document visible, whether or not a person is interacting.
- **Agent steps** — one or more Session `step/start` intervals are open; this may include provider, tool, subagent, or human-wait time.
- **Together** — human-active and Agent-step intervals overlap.
- **Agent solo** — Agent-step time outside human-active intervals.

Concurrent tabs and Sessions are unioned before totals are calculated. One wall-clock instant therefore contributes at most once to each headline number.

## Evidence path

The browser owns one activity tracker per document. It sends a random document identity, a monotonic sequence, visibility, recent-activity state, and the current Session id. It sends no timestamp. The Host rejects stale sequences and stamps accepted observations with `Date.now()`, so a manipulated or drifting browser clock cannot manufacture duration.

Unchanged visible heartbeats update the latest Host evidence without appending another transition. Hiding the document clears the active state; becoming visible again requires a fresh interaction. Browser sleep, abrupt termination, and transport loss stop evidence at the last received heartbeat rather than extrapolating activity.

The Host projects Session `step/start` and `step/end` events into the same storage domain. These event timestamps remain the Session log's durable execution evidence. Reads clip half-open intervals to the requested range, union overlaps, derive intersection totals, and return per-Session drilldown rows from the same algebra.

## Persistence and bounds

`@changanhua/dsh-host-work-observatory` stores the `work_observatory` version-1 domain through `ctx.storageDomain`; it does not open SQLite or files directly. Separate `samples`, `clients`, and `steps` tables keep transition history, the latest client state, and Session-step rows. Per-record keys are path-safe hashes so the JSON and SQLite storage providers accept the same records.

The default retention period is 90 days. One deployment accepts at most 128 concurrent browser identities, one query spans at most 31 days, and a range read consumes at most 10,000 retained transition and step records. These values are deployment safety bounds, not analytics sampling targets.

## Authority and privacy

All evidence stays in the configured local Host storage. The first version has no multi-Host aggregation, telemetry export, background desktop monitoring, keystroke content, pointer coordinates, or browser-history capture. It records only coarse state transitions and Session identity. Queue, Delivery, and Skill records remain separate; future bridge packages may add fact tags, but they must not claim that a Skill caused a duration or productivity change.

## Package ownership

The [Host package](../../packages/host/work-observatory/README.md) owns validation, Host time, retention, Session projection, interval algebra, and the `ctx.workObservatory` Remote. The [Client package](../../packages/client/ui-work-observatory/README.md) owns the document tracker, local-date controller, sidebar entry, dedicated workspace, and Session navigation. The shipped Web bundle composes both packages.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkobservatory--workobservatory"></a>

### `ctx.workObservatory` — `WorkObservatory`

Host service owning durable browser samples, Session-step projection, and range reads.

```ts cordis-catalog
/**
 * Accept one Host-stamped browser state transition or heartbeat.
 * @param observation - monotonic browser state without a client timestamp.
 * @returns whether the sequence was newer than the last accepted observation.
 */
@Remote('observeClient') observeClient(observation: ClientObservation): Promise<{ readonly accepted: boolean }>

/**
 * Read a bounded range; totals and Session rows derive from the same interval algebra.
 * @param request - finite epoch range and optional canonical project path.
 * @returns normalized timelines, headline totals, and contributing Session rows.
 */
@Remote('readRange') async readRange(request: WorkObservatoryRangeRequest): Promise<WorkObservatoryRange>
```

Source: [`packages/host/work-observatory/src/index.ts`](../../packages/host/work-observatory/src/index.ts)
<!-- END GENERATED cordis-surface -->
