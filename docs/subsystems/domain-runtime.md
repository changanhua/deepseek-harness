# Domain Runtime

English | [中文](domain-runtime.zh.md)

The [domain-runtime group](../../packages/domain-runtime/README.md) owns immutable artifact references and provider routing. Domain payloads stay with their provider; this page defines the shared semantics rather than a central store.

## Identity and metadata

`DomainArtifactRef` identifies `domain`, `kind`, opaque `id` and optional SHA-256 `digest`. FC refs always carry a digest; Plan creation requires the exact persisted Reality digest. A provider response must match the requested identity, and a supplied digest must match exactly.

`DomainArtifactHeader` carries capture-time timestamps, coverage, freshness, direct parent refs, source refs and bounded issues. The [schemas](../../packages/domain-runtime/domain-runtime/src/schema.ts) own exact types, per-field bounds and the complete 32,768-byte metadata envelope bound. Descriptor capabilities describe read/plan operations; they do not create an untyped invocation endpoint.

## Registry and lifecycle

`ctx.domainArtifacts` discovers one provider per domain and routes header, artifact and direct-parent reads. Duplicate domains, unknown domains, unknown kinds and mismatched returned refs fail closed. Registration follows the contributing Cordis fiber; disposal removes discovery/routing and rejects its in-flight read results. Returned metadata and JSON payloads are detached from provider-owned state.

## FC Reality and Plan

`fc27/sbc-reality` compiles supplied existing MAIN-world read or semantic probe evidence; it never invokes MAIN-world execution itself. Explicit field projection excludes undeclared credentials and raw DOM. Inventory completeness requires proven traversal and valid stable instance identities. Group coverage remains partial/unknown because the current read contract cannot prove unfiltered full-group traversal.

`fc27/sbc-plan` derives from exactly one Reality ref and retains solver limits, search incompleteness, provisional candidates and missing-quote blockers. It reuses the existing pure FC algorithms through the [FC owner](../../packages/domain-runtime/fc-sbc-domain/README.md). It is neither a Planning mutation, a Safety Approval Artifact nor an executable authorization.

## Freshness and persistence

Artifact headers record immutable capture-time evidence. Missing expiry produces unknown freshness; `getStatus` evaluates current expiry without changing historical artifacts. The FC owner persists payloads and idempotency receipts in Storage Domain `fc_sbc_artifacts` version 1, validates cold reads and publishes only after the owner write succeeds. The generic registry has no payload database.

## Integration boundaries

The [typed FC tools](../../packages/domain-runtime/tool-fc-sbc-domain/README.md) return refs and bounded summaries. Planning/Thinking consumers may retain external references under existing owner contracts, but this group changes neither schema nor canonical state. Quote providers, approval, Safety and execution remain outside this implementation.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdomainartifacts--domainartifactregistry"></a>

### `ctx.domainArtifacts` — `DomainArtifactRegistry`

Effect-scoped provider registry; no central payload store or action executor.

```ts cordis-catalog
/**
 * Register one domain until its contributing fiber is disposed. Duplicate domains reject.
 * @param provider - Trusted owner that supplies metadata and immutable payload reads.
 * @returns Effect disposer; existing reads reject if this registration is unloaded.
 */
register(provider: DomainRuntimeProvider): () => void

/**
 * Return detached provider descriptions; no owner payload is loaded.
 * @returns The bounded registered domain catalog.
 */
discover(): DomainDescriptor[]

/**
 * Route a metadata-only read, reject mismatched identities, and return a detached header.
 * @param ref - Exact owner, kind and identity; a supplied digest must match.
 * @param signal - Optional lifetime checked before and after the provider read.
 * @returns Owner metadata, or undefined for a missing artifact; unavailable providers reject.
 */
async readHeader(ref: DomainArtifactRef, signal?: AbortSignal): Promise<DomainArtifactHeader | undefined>

/**
 * Route one exact artifact read; validate JSON but never interpret domain payload fields.
 * @param ref - Exact owner, kind and identity; a supplied digest must match.
 * @param signal - Optional lifetime forwarded to the provider.
 * @returns A detached header and payload, or undefined for a missing artifact.
 */
async readArtifact(ref: DomainArtifactRef, signal?: AbortSignal): Promise<DomainArtifactView | undefined>

/**
 * Return direct immutable parent references without recursively loading their payloads.
 * @param ref - Child artifact identity.
 * @param signal - Optional lifetime forwarded to the metadata read.
 * @returns Detached direct parent references, or undefined for a missing child.
 */
async parents(ref: DomainArtifactRef, signal?: AbortSignal): Promise<DomainArtifactRef[] | undefined>
```

Source: [`packages/domain-runtime/domain-runtime/src/index.ts`](../../packages/domain-runtime/domain-runtime/src/index.ts)

<a id="ctxfcsbcdomain--fcsbcdomain"></a>

### `ctx.fcSbcDomain` — `FcSbcDomain`

Typed offline FC capability. It accepts read observations, never external-write callbacks.

```ts cordis-catalog
/**
 * Persist an allowlisted existing read/probe observation and return its immutable reference.
 * @param input - Typed observations, provenance and idempotency request identity.
 * @param signal - Optional cancellation checked before durable publication.
 * @returns The committed immutable Reality reference; changed request reuse rejects.
 */
async captureReality(input: CaptureFcReality, signal?: AbortSignal): Promise<DomainArtifactRef>

/**
 * Freeze existing-solver candidates from an exact persisted Reality; never approve or execute.
 * @param input - Exact Reality reference including digest, request identity and bounded search options.
 * @param signal - Optional cancellation checked before durable publication.
 * @returns The committed immutable Plan reference; identical canonical input reuses the first artifact.
 */
async buildPlan(input: BuildFcPlan, signal?: AbortSignal): Promise<DomainArtifactRef>

/**
 * Read one exact detached owner payload; unknown identity returns undefined.
 * @param ref - Artifact owner, kind, id and optional digest to verify.
 * @param signal - Optional cancellation checked before reading.
 * @returns Detached FC payload and metadata, or undefined for a missing artifact.
 */
async readArtifact(ref: DomainArtifactRef, signal?: AbortSignal): Promise<FcArtifact | undefined>

/**
 * Bounded summary; freshness is evaluated at read time without editing historical artifacts.
 * @param ref - Exact artifact identity.
 * @param signal - Optional cancellation forwarded to the owner read.
 * @returns Bounded status and blockers, or undefined for a missing artifact.
 */
async getStatus(ref: DomainArtifactRef, signal?: AbortSignal): Promise<FcArtifactStatus | undefined>
```

Source: [`packages/domain-runtime/fc-sbc-domain/src/index.ts`](../../packages/domain-runtime/fc-sbc-domain/src/index.ts)
<!-- END GENERATED cordis-surface -->
