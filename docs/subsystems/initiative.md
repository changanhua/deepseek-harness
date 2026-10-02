# Initiative

English | [中文](initiative.zh.md)

Initiative owns pre-Planning Candidates shared by Human and Agent proposers. Immutable origin and append-only revisions distinguish the original hypothesis from later investigation. Evidence and counter-evidence remain distinct references to their original owners; a supplied locator or digest is not verification.

## Authority and persistence

The provider derives Workspace and actor from a live Agent/Session. Human operations require an exact unfinished Commands event. Agents may propose, refine and record investigation recommendations, but cannot defer, drop or promote. Investigation does not execute tools, create Agents or change available permissions. Candidate data is reference material, never executable policy.

Storage Domain retains one atomic Workspace record. Actor/payload-bound receipts survive restart. Human assess captures an exact immutable Candidate revision through the existing RIR owner and runner. Human promotion prepares a durable intent before Planning propose; optional assessmentId selects a validated fixed Assessment, including an older revision, and freezes its complete baseline with Human rationale. Recovery replays that request without evaluating again or replacing the baseline. A pending promotion freezes Candidate edits; a definitive Planning CAS rejection can refresh the Planning attempt. Canonical Planning items/revisions and Delivery state remain unchanged, although the aggregate Board version increases.

## Queries and dependencies

Read projections use CandidateSummary plus the selected immutable revision, revision count, investigation and latest disposition. Optional RIR relations validate Workspace, Candidate id, exact revision, digest and stored text. fresh means the assessed Candidate content matches the current head; drift means a valid older revision. Missing revisions are unavailable and inconsistent records are unknown. These states do not attest current DSH capabilities, backend identity or evidence truth. Missing or closed Assessment providers remain unavailable.

See [Candidate packages and opt-in setup](../../packages/initiative/README.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxinitiative--initiative-abstract-seam"></a>

### `ctx.initiative` — `Initiative` (abstract seam)

Candidate owner; callers supply a live Agent, never a claimed actor or Workspace.

```ts cordis-catalog
/**
 * Commit an authorized Candidate fact or explicit Human promotion.
 * @param agent - Exact live runtime caller, revalidated at durable commits.
 * @param input - Strict mutation with idempotency key and exact versions where required.
 * @param invocation - Commands-owned identity for Human calls; absent for model Tools.
 * @param signal - Caller cancellation, checked before commits.
 * @returns Original durable receipt on an identical authorized replay.
 */
abstract execute( agent: Agent, input: InitiativeCommand, invocation?: InitiativeInvocation, signal?: AbortSignal, ): Promise<InitiativeReceipt>

/**
 * Read detached Candidate history in the caller's current Workspace.
 * @param agent - Exact live runtime caller.
 * @param query - Exact revision or bounded filters.
 * @param invocation - Active Human command identity when outside an Agent turn.
 * @param signal - Caller cancellation.
 * @returns Candidate facts and bounded exact-subject RIR relations, never inferred evidence verification.
 */
abstract read(agent: Agent, query: InitiativeQuery, invocation?: InitiativeInvocation, signal?: AbortSignal): Promise<InitiativePage>
```

Types: [Agent](core.md)

Source: [`packages/initiative/initiative/src/index.ts`](../../packages/initiative/initiative/src/index.ts)
<!-- END GENERATED cordis-surface -->

## Dev Note

None.
