# Content

English | [中文](content.zh.md)

The [content packages](../../packages/content/README.md) preserve text independently of a conversation. The [definition](../../packages/content/content/README.md) owns the schema and provider-independent editing contract; [content-domain](../../packages/content/content-domain/README.md) owns persistence through Storage Domain.

## Records and revisions

[ContentEntrySchema](../../packages/content/content/src/schema.ts) is the runtime schema from which record types derive. An entry contains immutable versions, an optional working draft, source identity, project references and committed operation receipts. The content library does not own Project, Work, Attempt or Acceptance state.

An original has a first immutable version. A new idea starts with a draft and no head version. Starting a draft copies the head; saving edits changes only the draft. Committing a draft creates a version and removes the draft. Each successful mutation advances the entry revision; text writes compare the draft revision and base version, while metadata writes compare the entry revision. A metadata change therefore need not invalidate an independent text edit.

Versions retain their exact title and body. Text is neither trimmed nor normalized; lone UTF-16 surrogates reject because they cannot round-trip through UTF-8. The stored SHA-256 digest describes UTF-8 body text, not unobserved network bytes. Source identity and saved content remain separate, so losing access to a source does not remove the saved original.

## Commands and authority

[ContentCommandSchema](../../packages/content/content/src/schema.ts) accepts manual creation, text import, draft operations and metadata edits. Every mutation carries an operation identity. Recent receipts, creation records and version operations distinguish an identical retry from identity reuse with another request. A receipt returns the revisions at that commit; it is not a current entry snapshot. An absent receipt means unknown, and old expected revisions still reject.

Capture takes only Session and message references. Trusted host code supplies both a source resolver and a synchronous authorization callback. Preparation occurs outside the write chain; the provider checks authority again before committing. Manually supplied text remains `user-provided`. Read, snapshot and receipt methods also require authorization. Providers return detached data so a consumer cannot mutate durable state through a retained reference.

## Persistence and availability

The provider stores one aggregate per entry in `content_library` version 1, using the `entries` table and the `single` layout. It requires `single-writer`, `commit-sync` and `private-root`; [storage](storage.md) owns enforcement. The content provider owns the Domain handle, while the backend plugin owns the database connection.

Content state remains inspectable when storage is unavailable. A successful save requires the Domain write to resolve. An uncertain storage failure disables further reads and writes from the suspect cache; recovery reopens the provider and its backend. The [provider reference](../../packages/content/content-domain/README.md) owns size budgets and operational limits. Human transport, Session authorization and browser workflow acceptance belong to their consumers.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcontent--content-abstract-seam"></a>

### `ctx.content` — `Content` (abstract seam)

Providers own atomic entries, serial mutations and immutable versions behind this service.

```ts cordis-catalog
/**
 * Return payload-free state even when storage cannot open.
 * @returns Current availability and configured byte limits.
 */
abstract status(): ContentStatus

/**
 * Authorize a read; unavailable reads reject.
 * @param id - Stored entry identity.
 * @param authorize - Trusted synchronous access check.
 * @returns A detached committed entry, or undefined when absent.
 */
abstract get(id: string, authorize: ContentAccess): ContentEntry | undefined

/**
 * Authorize and copy a consistent logical snapshot.
 * @param authorize - Trusted synchronous access check.
 * @returns Every committed entry, including drafts and original versions.
 */
abstract snapshot(authorize: ContentAccess): ContentSnapshot

/**
 * Query a known committed outcome; absence never proves non-commit.
 * @param entryId - Stored entry identity.
 * @param operationId - Original command identity.
 * @param authorize - Trusted synchronous access check.
 * @returns The saved outcome, or undefined when unknown.
 */
abstract receipt(entryId: string, operationId: string, authorize: ContentAccess): ContentReceipt | undefined

/**
 * Validate and commit one mutation after checking authorization at admission and execution.
 * Identical retries return the stored receipt; reused identities or stale revisions reject.
 * Inputs and results are detached. A resolved promise confirms durable storage.
 * @param command - Exact command retained by the caller across retries.
 * @param authorize - Trusted access check, repeated inside the write chain.
 * @returns The original or newly committed receipt.
 */
abstract execute(command: ContentCommand, authorize: ContentAccess): Promise<ContentReceipt>

/**
 * Authorize before resolving completed text outside the write chain, then authorize again and commit.
 * Only trusted host code supplies resolveSource; the request cannot supply verified body text.
 * Repeated source identity and body return the canonical creation receipt, even under a new
 * operation id. This is a lookup, not another accepted mutation; its id is not echoed or retained.
 * A changed body rejects. Independently generated titles never overwrite the first saved title.
 * @param command - Session and message references with a retained command identity.
 * @param resolveSource - Trusted host callback that reads completed source text.
 * @param authorize - Trusted access check, before source reading and inside the write chain.
 * @returns The canonical creation receipt for the captured source.
 */
abstract capture( command: CaptureCommand, resolveSource: ContentSourceResolver, authorize: ContentAccess, ): Promise<ContentReceipt>
```

Source: [`packages/content/content/src/index.ts`](../../packages/content/content/src/index.ts)
<!-- END GENERATED cordis-surface -->
