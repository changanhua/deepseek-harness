# Project Planning

English | [中文](planning.zh.md)

Planning owns a durable Board per Workspace. A Board records manually arranged items, immutable revisions, dependency links, reviews, proposals, source provenance, and handoff references. It helps a project retain decisions without treating a plan card as execution authority.

## Board and revision boundary

Every write carries the current Board version and commits through compare-and-set. An item revision is immutable after creation. A later revision changes the head but retains prior revisions, their sources, reviews, and Delivery handoffs. A review names its exact item and revision, so an older Packet can still be traced and reviewed after the item has a newer head.

The local provider captures sources itself. It accepts manual and link references as unverified, validates Workspace-owned stored Session events, and reads exact saved Content versions when Content is available. A missing or unavailable Board provider fails the operation; callers must not replace it with a synthetic Board or infer execution state from a handoff.

## Canonical work objects

A Plan remains an item with an immutable head revision. Optional state entries have stable ids and objective, accepted, or open kinds; legacy intent, scope, and acceptance are retained without synthetic migration. A Focus is an optional independently selectable part of one Plan, with its own version and status. It is not an execution task, and done never completes the parent.

Subject references identify either a Plan or Focus explicitly. Resource links retain only extensible kind/id/provider/revision/label locators. External owners retain Session transcripts, SBC data, solver results, browser facts, and Delivery state. Context packs project current canonical entries and references without expanding those resources.

The existing Proposal generation can hold a delta with subject, base revision, operations, origin and evidence. Adoption verifies the exact generation and current base, then applies all operations and the new revision in one Board commit. A stale base rejects; the caller refreshes and prepares another proposal. Session bindings retain the original subject and base revision independently of browser selection.

## Authority and review

The optional FC27 SBC Design Case freezes an existing Plan revision and selected Focus into a separate exploratory record. Selection, coordinates and movement undo belong to that record, not the Board. Reads compare the retained base identifiers with current Planning facts and expose drift without replacing either the projection or layout. The [Planning Remote](../../packages/planning/planning-remote/README.md) owns its bounded persistence; the [Planning UI](../../packages/client/ui-planning/README.md) owns its interactions.

The browser Remote uses the authenticated local human identity. The model tools derive the initiating Agent, its current Workspace, and its latest direct user message. Neither caller supplies a different actor, Workspace, source hash, or durable receipt. Planning records a completed review as a review fact only; it does not make a Delivery acceptance decision.

## Delivery boundary

The optional bridge freezes one exact adopted revision and creates a recoverable Delivery shaping Case. It carries the revision source and stable mapping identity into Delivery. Delivery alone owns requirement approval, Packet readiness, dispatch, execution, verification, evidence publication, and human acceptance.

The browser snapshot may join linked Delivery summaries as read-only `executions`. Without Delivery it returns an empty list. A linked shaping Case is not proof of completion. Packet evidence remains readable only through the Planning Remote when the selected Plan's linked packet declares that exact evidence id; Delivery performs the checked byte read.

## Further exploration

- [Planning package group](../../packages/planning/README.md)
- [Delivery subsystem](delivery.md)

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxplanning--planning-abstract-seam"></a>

### `ctx.planning` — `Planning` (abstract seam)

Trusted Host-only planning seam. A trusted composition supplies PlanningAccess; this contract does not isolate callers from a malicious Host plugin. Providers reauthorize that supplied access before source reads and commits so a stale legitimate caller cannot write.

```ts cordis-catalog
/**
 * Read a detached Board snapshot.
 * @param access - Trusted Host-derived caller authority for one Workspace.
 * @param signal - Optional caller lifetime; cancellation prevents a result from being returned.
 * @returns A consumer-safe current Board snapshot without provider-private replay receipts.
 * @throws {PlanningError} When the caller is no longer authorized, the Workspace is unavailable, or the provider is closed.
 */
abstract snapshot(access: PlanningAccess, signal?: AbortSignal): Promise<PlanningBoardSnapshot>

/**
 * Atomically apply one CAS-fenced command.
 * @param access - Trusted Host-derived caller authority rechecked before the durable commit.
 * @param command - Strict command carrying the expected Board version and idempotency request id.
 * @param signal - Optional caller lifetime checked before externally observed work and commit.
 * @returns The committed or replayed mutation receipt; an identical request id returns its original receipt.
 * @throws {PlanningError} When authorization, references, version, capacity, source capture, or provider lifetime prevents the mutation.
 */
abstract execute( access: PlanningAccess, command: PlanningCommand, signal?: AbortSignal, ): Promise<PlanningMutationResult>

/**
 * Freeze one exact current revision for deterministic Delivery mapping without creating external work.
 * @param access - Trusted Host-derived caller authority rechecked before the durable handoff record is written.
 * @param input - Exact revision, repository, mapping version, and stable request identity to freeze.
 * @param signal - Optional caller lifetime checked before the durable write.
 * @returns The prepared durable handoff; retries with the same identity return that frozen record.
 * @throws {PlanningError} When direct-user authorization, revision identity, mapping identity, or provider lifetime is invalid.
 */
abstract prepareDeliveryHandoff( access: PlanningAccess, input: PrepareDeliveryHandoffInput, signal?: AbortSignal, ): Promise<PlanningHandoff>

/**
 * Bind a prepared handoff to the exact Case and Contract revision returned by Delivery.
 * @param access - Trusted Host bridge authority; providers reject a direct user or Agent caller for this transition.
 * @param input - Stable handoff key plus the Case and Contract revision identities returned by Delivery.
 * @param signal - Optional caller lifetime checked before the durable link is committed.
 * @returns The linked durable handoff; an identical recovery retry returns the same record.
 * @throws {PlanningError} When the prepared handoff is absent, identities conflict, authorization is invalid, or the provider is closed.
 */
abstract linkDeliveryHandoff( access: PlanningAccess, input: LinkDeliveryHandoffInput, signal?: AbortSignal, ): Promise<PlanningHandoff>
```

Source: [`packages/planning/planning/src/index.ts`](../../packages/planning/planning/src/index.ts)

<a id="ctxplanningdelivery--planningdelivery"></a>

### `ctx.planningDelivery` — `PlanningDelivery`

Host-only Planning-to-Delivery bridge. It freezes a Planning revision before it creates or links a recoverable shaping Case; it neither approves requirements nor accepts execution.

```ts cordis-catalog
/**
 * Prepare and recoverably link one adopted Planning revision to a Delivery shaping Case.
 * @param access - Trusted Host-derived direct-user authority; the bridge switches only its final link to bridge authority.
 * @param input - Exact Planning item and revision selected for handoff.
 * @param signal - Optional caller lifetime checked before bridge-side work.
 * @returns The prepared or linked durable Planning handoff, including Delivery identities once linked.
 * @throws {PlanningError} When authorization, route, revision, digest, or Delivery linkage is unavailable or conflicts.
 */
async handoff( access: PlanningAccess, input: PlanningDeliveryHandoffInput, signal?: AbortSignal, ): Promise<PlanningHandoff>
```

Source: [`packages/planning/planning-delivery-bridge/src/index.ts`](../../packages/planning/planning-delivery-bridge/src/index.ts)

<a id="ctxthinkingcase--thinkingagentowner"></a>

### `ctx.thinkingCase` — `ThinkingAgentOwner`

Host capability restricted to the real bound Thinking Agent; model-supplied identities are not accepted.

```ts cordis-catalog
/** Read the admitted run's frozen input after revalidating its live Agent and binding.
 * @param agent - Exact live caller in the restricted Thinking preset.
 * @param signal - Caller cancellation.
 * @returns Detached frozen context; rejects stale scope or missing admission.
 */
context(agent: Agent, signal: AbortSignal): Promise<ThinkingContextPack>

/** Persist a versioned suggestion without applying it to Planning or the canvas.
 * @param agent - Exact live caller bound to the run.
 * @param input - Draft, expected result version and stable retry identity.
 * @param signal - Caller cancellation.
 * @returns Committed result or the original receipt on identical retry.
 */
submit( agent: Agent, input: Omit<SubmitThinkingInput, 'runId'>, signal: AbortSignal, ): Promise<ThinkingResultRecord>

/** Check current preset membership without admitting a read or write.
 * @param sessionId - Native Session to inspect.
 * @returns Whether the live Agent is composed with the Thinking preset.
 */
isThinkingSession(sessionId: string): Promise<boolean>
```

Types: [Agent](core.md)

Source: [`packages/planning/planning-remote/src/thinking-types.ts`](../../packages/planning/planning-remote/src/thinking-types.ts)
<!-- END GENERATED cordis-surface -->

## Dev Note

None.
