# Project Memory subsystem

English | [中文](project-memory.zh.md)

## Scope

Project Memory stores short reusable claims under an existing Workspace identity. The [package family](../../packages/memory/README.md) separates its Definition from local source checking and persistence. Original documents and Session logs remain authoritative for their own contents.

## Records and decisions

The [record schemas](../../packages/memory/memory/src/schema.ts) are the source of truth for fields and validation. One `MemoryRecord` contains immutable content revisions, active and pending pointers, human decisions, and ordered mutation receipts. A record-version fence protects each atomic mutation; its receipt commits with the changed data. Revision pointers must be derivable from the complete history.

| Operation | Durable effect |
| --- | --- |
| Propose | Append one candidate without replacing an unresolved candidate or changing the active revision |
| Accept | Activate an exact candidate or reconfirm the active revision; record command evidence and the next review deadline |
| Reject | Reject the pending candidate while preserving any active revision |
| Retire | Remove the active pointer while preserving every content version and decision |

Identical retry keys and canonical inputs return the first mutation result; changed input under the same key rejects. A failed write leaves the previous projection intact. There is no cross-record transaction or automatic deletion.

## Authority and source validity

Providers derive the project from the initiating live Session and Workspace Registry. A foreign record and an absent record are indistinguishable to callers. Decisions require the exact still-running human memory command and a successful Session durability checkpoint. Candidate creation alone cannot activate memory.

Accepted memory can be `usable`, `source-changed`, `source-unavailable`, `review-due`, `conflicted`, or `withdrawn`. Source observations distinguish a matching fingerprint, changed contents, unavailable data, and a check not attempted because another eligibility condition already failed. Unusable model-facing results contain no historical claim body or source preview. Reads recheck identity, version, review deadline, and conflicts after IO; searches additionally fence the complete project record snapshot before returning results. A changed snapshot permits one retry, then fails with `concurrent-change` if it keeps changing.

File fingerprints cover complete bounded bytes in the Agent's filesystem world. Session sources retain an event identity and text digest from the physical stored prefix, excluding synthetic recovery events. Acceptance permits reuse; it is not an assertion of truth or a grant of execution authority.

## Lifecycle

The [local provider](../../packages/memory/memory-local/README.md) owns the exclusive lock, the `project_memory` domain, and pending operations. Unload refuses new work, drains admitted operations, closes storage, and then releases the matching lock. An interrupted Host leaves a lock requiring operator verification before restart. Session history is not the memory database; tool Consumers log the exact memory content they expose through normal tool results.

## Requests and results

The [public types](../../packages/memory/memory/src/types.ts) define the service boundary. `MemoryProposal` carries a candidate, source locators, and an idempotency key; amendments also carry the target id and expected record version. `MemoryDecisionRequest` binds an exact revision and record fence to an active human command. Both writes return a `MemoryMutation` with the durable id, revision, and record version.

`MemorySearchRequest` bounds a lexical query and optional tag filters. Its `MemorySearchResult` contains usable `MemoryReadResult` items and project-local excluded counts. A read includes source status, `checkedAt`, revision identity, and eligibility; only a usable result includes the claim body.

`MemoryInspectionRequest` authorizes a list, a shown revision, or a decision's exact target through a current human command. The returned `MemoryInspectedRecord` adds source observations and bounded previews for a shown revision to detached history. Inspection does not accept a candidate and is not exposed as a model tool.

## Cordis API

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxprojectmemory--projectmemory-abstract-seam"></a>

### `ctx.projectMemory` — `ProjectMemory` (abstract seam)

Providers own durable records and reauthorize every call against the Agent's Workspace.

```ts cordis-catalog
/**
 * Search accepted claims after source, deadline and conflict checks.
 * @param agent - Real initiating Agent; never a caller-provided workspace id.
 * @param request - Bounded lexical query.
 * @param signal - Cooperative cancellation.
 * @returns usable claims and withheld counts within this project only.
 */
abstract search(agent: Agent, request: MemorySearchRequest, signal?: AbortSignal): Promise<MemorySearchResult>

/**
 * Read one currently usable revision; unavailable bodies remain withheld.
 * @param agent - Initiating Agent.
 * @param id - Memory id in the caller's project.
 * @param signal - Cooperative cancellation.
 * @returns a checked revision or an unavailable result; inaccessible ids reject identically to unknown ids.
 */
abstract read(agent: Agent, id: string, signal?: AbortSignal): Promise<MemoryReadResult>

/**
 * Persist a candidate and its receipt together, without activating it.
 * @param agent - Initiating Agent and provenance owner.
 * @param input - Candidate input; all fields are runtime validated.
 * @param signal - Cancellation before commit prevents admission; committed retries use the same key.
 * @returns the durable mutation identity; changed input under one key rejects.
 */
abstract propose(agent: Agent, input: MemoryProposal, signal?: AbortSignal): Promise<MemoryMutation>

/**
 * Apply a human command to an exact revision under a record-version fence.
 * @param agent - Agent whose session contains the authenticated command invocation.
 * @param request - Command evidence and exact decision target.
 * @param signal - Cooperative cancellation before the commit boundary.
 * @returns the durable decision receipt; fabricated commands, stale versions and invalid sources reject.
 */
abstract decide(agent: Agent, request: MemoryDecisionRequest, signal?: AbortSignal): Promise<MemoryMutation>

/**
 * Inspect candidate and historical content through a current human command.
 * @param agent - Receiving Agent.
 * @param request - Exact logged list/show command or decision target identity.
 * @param signal - Cooperative cancellation.
 * @returns detached records authorized for human inspection, never a model approval capability.
 */
abstract inspect(agent: Agent, request: MemoryInspectionRequest, signal?: AbortSignal): Promise<readonly MemoryInspectedRecord[]>
```

Types: [Agent](core.md)

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
