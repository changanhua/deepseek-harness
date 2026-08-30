# Durable Cross-Session Task Queue

English | [中文](task-queue.zh.md)

The host-plane typed work queue (`ctx.taskQueue`). The contract package is [`dsh-task-queue`](../../packages/task-queue/task-queue/README.md), the durable provider is [`dsh-task-queue-local`](../../packages/task-queue/task-queue-local/README.md), and the generic model toolkit is [`dsh-tool-task-queue`](../../packages/task-queue/tool-task-queue/README.md).

## Service

`ctx.taskQueue` is the abstract `TaskQueue` seam implemented by `LocalTaskQueue` (`@deepseek-ai/dsh-task-queue-local`). Agent and operator facades require verified authority. Both may admit work, but operator admission is a trusted host capability: it creates ownerless WorkItems under a separate idempotency namespace and no Session Notification. A `WorkHandler` resolves immutable admission facts, derives retry policy, declares resources, prepares dispatch, and synchronously returns a `LiveAttempt`; the provider persists the admitted policy and claims, then owns durable scheduling and attempt settlement.

## Work model and state machine

`WorkItem` stores caller intent plus resolved facts. `WorkState` is event-derived from atomic `ChangeSet`s: `queued`, `starting`, `running`, `unknown`, `succeeded`, `failed`, or `canceled`. `attempt/started` is durable before a handler may start a side effect; an unprovable post-crash outcome becomes `unknown`. An operator may confirm failure or authorize another attempt, but cannot reconcile an unverified success.

## Durable store

The schema-v3 root contains `manifest.json`, append-only `active.jsonl`, a digest-checked `snapshot.json`, and an exclusive owner lock. The provider rejects other schema versions. Startup records every stranded `starting` or `running` Attempt as `unknown` with pending Attention before dispatch. If a handler starts but the running append fails, the provider requests cancellation, awaits cancellation plus live settlement under the configured bound, and then records unknown with Attention; it never drops live ownership immediately after the durability fault. Unknown persistence gets one best-effort retry, and no post-start error can enter the pre-start automatic-retry path. At the deadline, Queue releases the in-process handle and scheduling claims while retaining durable uncertainty, so an operator must confirm external quiescence before authorizing another Attempt. Shutdown applies the same bounded quiescence rule before releasing the root lock. `ChangeSet` folding is fail-closed. Queue persists typed JSON results; byte storage belongs to services such as `ctx.attachments`, not to a Queue-local path writer.

## Scheduling

Handlers declare `ResourceClaim`s, which admission validates against deployment `resourceCapacity` and records on each WorkItem. Global `maxConcurrent`, persisted claims, and Batch `maxParallel` bound dispatch. `pause()` affects new dispatch only. The shipped image handler is `image.generate@1`; `agent.run@1` is the restricted DSH worker handler; `operation.run@1` claims `operation-run` capacity.

## Host operations

`operation.run@1` bridges one host-configured operation definition into durable work. Admission accepts only `operationId`; the Bridge resolves the closed host allowlist and persists the operation id, revision, argv, working directory, resource claim, retry policy, output limits, and timing limits as immutable facts. It starts the resolved argv through `ctx.subprocess`, retains bounded output, and settles only after the subprocess tree reaches quiescence; cancellation and timeout terminate that tree.

Operation definitions are trusted deployment configuration and must be secret-free. The Bridge rejects credential-shaped fields and common argv carrier structures as defense in depth; the finite host allowlist remains responsible for reviewing opaque positional text, and credential-bearing work belongs in a domain-specific WorkKind.

`dsh-tool-operation-run-task-queue` exposes `operation_run_enqueue` and `operation_run_enqueue_batch` to a live Agent Session, returning only durable Work ids. The generic queue tools retain result reads and owner Notification delivery, so execution output reaches the owner only through the generic result path. The Bridge and Consumer are CLI-resolvable packages, but the base bundle does not mount either by default.

Operation work is a host allowlisted subprocess bridge, not the `agent.run@1` restricted DSH executor, a Skill invocation, or Workflow orchestration; those mechanisms keep their own configuration and lifecycle.

## Model tools and delivery

WorkKind-specific Consumers own admission schemas: `dsh-tool-agent-run-task-queue` admits `agent.run@1`, `dsh-tool-image-generation-task-queue` admits `image.generate@1`, and `dsh-tool-operation-run-task-queue` admits `operation.run@1`. The generic `dsh-tool-task-queue` package remains WorkKind-independent and owns listing, cancellation, explicit typed result reads, and replay-safe owner Notification delivery. A terminal Notification contains stable metadata and a Result id, never executor output. The owner Session acknowledges it only after the message is durably flushed.

Image results contain Attachment references produced through `ctx.attachments`; Queue does not copy or reinterpret image bytes. The current implementation does not provide automatic Goal continuation, byte-exact generic artifact storage, operator-confirmed success for unknown work, or multi-host scheduling.

## Events

`task-queue/changed` is emitted only after a complete `ChangeSet` is durable and folded.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctximagegeneration--imagegeneration"></a>

### `ctx.imageGeneration` — `ImageGeneration`

Shared provider registry and two-phase image generation dispatcher.

```ts cordis-catalog
/**
 * Register one provider for the calling fiber's lifetime.
 * Throws {@link ImageGenerationError} with
 * `IMAGE_GENERATION_PROVIDER_DUPLICATE` when the id is already registered.
 * @param provider - provider keyed by its stable id.
 * @returns disposer that removes this exact registration.
 */
registerProvider(provider: ImageGenerationProvider): () => void

/**
 * Select a provider and resolve all execution facts before generation starts.
 * Rejects with {@link ImageGenerationError} for blank sizes, a missing
 * explicit provider, no providers, or ambiguous automatic selection.
 * Provider validation failures and cancellation rejections pass through
 * unchanged; providers must honor `context.signal`.
 * @param request - provider/model/format requirements without a prompt.
 * @param context - cancellation context forwarded unchanged to the provider.
 * @returns fully resolved facts stamped with the selected provider id.
 */
async resolve( request: ImageGenerationRequest, context: ImageGenerationContext, ): Promise<ResolvedImageGenerationSpec>

/**
 * Generate images through the provider recorded in a resolved input.
 * Throws {@link ImageGenerationError} with
 * `IMAGE_GENERATION_PROVIDER_MISSING` when the resolved provider has been
 * disposed. Provider failures and cancellation rejections pass through
 * unchanged; providers must honor `context.signal`.
 * @param input - prompt and spec returned by {@link resolve}.
 * @param context - cancellation context forwarded unchanged to the provider.
 * @returns provider result with provider/model attribution and encoded images.
 */
generate(input: ImageGenerationInput, context: ImageGenerationContext): Promise<ImageGenerationResult>
```

Source: [`packages/image/image-generation/src/index.ts`](../../packages/image/image-generation/src/index.ts)

<a id="ctxtaskqueue--taskqueue-abstract-seam"></a>

### `ctx.taskQueue` — `TaskQueue` (abstract seam)

Durable typed work queue whose provider verifies authority before facade creation.

```ts cordis-catalog
/**
 * Bind queue operations to verified Agent authority.
 * @param authority - Opaque capability verified by the provider.
 * @returns Agent-scoped operations.
 */
abstract forAgent(authority: VerifiedAgentAuthority): AgentWorkQueue

/**
 * Bind queue operations to verified operator authority.
 * @param authority - Opaque operator capability verified by the provider.
 * @returns Operator-only operations.
 */
abstract forOperator(authority: VerifiedOperatorAuthority): OperatorWorkQueue

/**
 * Register one typed WorkHandler for admission and optional dispatch.
 * A staged registration remains available to receipt lookup and admission,
 * but cannot dispatch until its own `activate()` succeeds. Activation throws
 * after disposal or repeated activation. The callable disposer removes only
 * this registration.
 * @param handler - Typed handler to register.
 * @param options - Optional staged dispatch while admission remains available.
 * @returns The callable owner of exactly this registration.
 */
abstract registerHandler<K extends WorkKind>( handler: WorkHandler<K>, options?: { readonly activation?: 'immediate' | 'staged' }, ): (() => void) & { activate(): void }

/**
 * List registered WorkKinds.
 * @returns Registered WorkKinds in stable order.
 */
abstract listKinds(): readonly WorkKind[]
```

Source: [`packages/task-queue/task-queue/src/index.ts`](../../packages/task-queue/task-queue/src/index.ts)

<a id="task-queue-events"></a>

### `task-queue/*` events

<a id="task-queuechanged--emit"></a>

#### `task-queue/changed` — emit

Emitted after one complete ChangeSet is durable and folded.

```ts cordis-catalog
/**
 * Emitted after one complete ChangeSet is durable and folded.
 * @param payload - Durable ChangeSet identity.
 * @mode emit
 */
'task-queue/changed'(payload: { seq: number; changeId: string }): void
```

Source: [`packages/task-queue/task-queue/src/index.ts`](../../packages/task-queue/task-queue/src/index.ts)
<!-- END GENERATED cordis-surface -->
