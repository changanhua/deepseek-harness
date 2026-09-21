# Extensions

English | [中文](extensions.zh.md)

The extensions subsystem lets an agent define versioned Cordis packages, run their host and browser halves, and query approved runtime metadata before writing code. Package lifecycle and sandbox behavior belong to the [`packages/extensions`](../../packages/extensions/README.md) package group.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcordisinspect--cordisinspectregistryservice"></a>

### `ctx.cordisInspect` — `CordisInspectRegistryService`

Registry and cross-page router behind the two model-facing inspect tools.

```ts cordis-catalog
/**
 * Register one Host provider. Provider ids are process-global and first-wins:
 * the same provider directory is registered by every composition that mounts
 * the cordis tool package (each agent preset carries its own row), and the
 * catalogs it answers with are static or keyed by the QUERYING agent, so a
 * duplicate registration carries no additional information.
 * @param registration - manifest and local query handler.
 * @returns idempotent disposer.
 */
register(registration: HostCordisInspectProviderRegistration): () => void

/**
 * Replace the mirrored Client provider directory.
 * @param providers - complete Client manifest snapshot.
 */
syncClientManifest(providers: readonly CordisInspectProviderManifest[]): void

/**
 * Return the complete known Host and Client provider directory.
 * @returns Host providers followed by the Client providers.
 */
list(): CordisInspectProviderView[]

/**
 * Execute one provider query on its owning platform.
 * @param platform - Host or Client runtime.
 * @param providerId - provider selected from {@link list}.
 * @param methodName - declared method name.
 * @param input - optional lossless JSON input.
 * @param agent - requesting Agent and scope.
 * @param signal - tool-call cancellation.
 * @returns provider JSON data.
 */
async query( platform: CordisInspectPlatform, providerId: string, methodName: string, input: JsonValue | undefined, agent: Agent, signal: AbortSignal, ): Promise<JsonValue>

/**
 * Accept the first valid Client response for a pending query.
 * @param agent - Agent whose Session owns the query.
 * @param requestId - Pending Client query identity.
 * @param resolution - Client provider result or failure.
 * @returns whether this response settled the still-pending query.
 */
resolveClientQuery( agent: Agent, requestId: CordisInspectRequestId, resolution: CordisInspectQueryResolution, ): CordisInspectResolveAck
```

Types: [Agent](core.md)

Source: [`packages/extensions/cordis-host-runner/src/inspect-registry.ts`](../../packages/extensions/cordis-host-runner/src/inspect-registry.ts)

<a id="ctxdynamiccordisrunner--dynamiccordisrunnerservice"></a>

### `ctx.dynamicCordisRunner` — `DynamicCordisRunnerService`

Dynamic Plugin registry and Host-half lifecycle.

```ts cordis-catalog
/**
 * Define a new Plugin's first Package or append a Package to an existing Plugin.
 * @param agent - Exact live Agent that owns the Plugin and browser operations.
 * @param request - Plugin selection, metadata, and source code.
 * @returns Host-minted Plugin and Package identities with declared-half metadata.
 */
define(agent: Agent, request: DynamicCordisDefineRequest): DynamicCordisDefineReceipt

/**
 * Remove a Plugin, its active run, and all immutable Packages.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to remove.
 * @returns Whether removal succeeded and whether it stopped an active run.
 */
async undefine(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisUndefineReceipt>

/**
 * Remove a Plugin from the user panel and queue the resulting state change for the model's next step.
 * @param agent - Agent whose Session owns the Plugin and receives the context.
 * @param pluginId - Stable Plugin identity to remove.
 * @returns Whether removal succeeded and whether it stopped an active run.
 */
@Remote('undefineFromPanel') async undefineFromPanel(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisUndefineReceipt>

/**
 * Start or update one Package for a model tool call. An unauthorized Client
 * Package waits for approval; Plugin-wide authorization covers later versions.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to activate.
 * @param packageId - Immutable Package version to activate.
 * @param mode - Whether to run the current version or switch versions.
 * @param signal - Tool-call cancellation signal while the activation request is being created.
 * @returns The successful activation identity or an actionable refusal.
 */
async run( agent: Agent, pluginId: CordisDynamicPluginId, packageId: CordisDynamicPackageId, mode: CordisDynamicRunMode, signal?: AbortSignal, ): Promise<DynamicCordisRunResponse>

/**
 * Start Host code for an approved request or a direct panel gesture.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to activate.
 * @param packageId - Immutable Package version to activate.
 * @param mode - Whether to run the current version or switch versions.
 * @param requestId - Model-driven request identity, or null for a direct user gesture.
 * @param approveFutureVersions - Whether this approval covers later Packages of the same Plugin.
 * @returns The exact Host activation or a failure message.
 */
@Remote('runHostHalf') async runHostHalf( agent: Agent, pluginId: CordisDynamicPluginId, packageId: CordisDynamicPackageId, mode: CordisDynamicRunMode, requestId: ApprovalRequestId | null, approveFutureVersions: boolean, ): Promise<DynamicCordisHostHalfResult>

/**
 * Fetch Client code for the exact active run.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to read.
 * @param pluginRunId - Exact active run authorized to receive source.
 * @returns Client source and its Plugin, Package, and run identities.
 */
@Remote('getClientCode') getClientCode( agent: Agent, pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, ): DynamicCordisClientSource

/**
 * Resolve one model-driven Client activation request.
 * @param requestId - Request identity to settle once.
 * @param resolution - Browser refusal or exact Client activation result.
 * @returns Whether the still-pending request accepted this resolution.
 */
@Remote('resolveRequestRun') async resolveRequestRun( requestId: ApprovalRequestId, resolution: DynamicCordisRunResolution, ): Promise<DynamicCordisResolveAck>

/**
 * Settle a direct panel run after this page loaded or failed its Client half.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity being settled.
 * @param resolution - Exact Client activation result from the acting page.
 * @returns The committed activation or its failure.
 */
@Remote('settleUserRun') async settleUserRun( agent: Agent, pluginId: CordisDynamicPluginId, resolution: DynamicCordisRunResolution, ): Promise<DynamicCordisRunResponse>

/**
 * Stop the active run while retaining every Package version.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to stop.
 * @returns Success or the reason no run was stopped.
 */
async stop(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisStopResponse>

/**
 * Promote one exact settled run only after BrowserTask durably records the
 * corresponding resource handoff. The callback is deliberately synchronous:
 * the owner changes at the same commit point as that external fact.
 * @param agent - Exact live Agent that owns the running Plugin.
 * @param request - Exact run, installation owner, handoff identity, and delivery scope.
 * @param persist - Synchronous callback that commits the BrowserTask handoff fact.
 * @returns The committed handoff, or a refusal that leaves ownership unchanged.
 */
handoffToInstallation( agent: Agent, request: DynamicCordisFunctionHandoffRequest, persist: (handoff: DynamicCordisFunctionHandoff) => unknown, ): DynamicCordisFunctionHandoffReceipt

/**
 * List only functions promoted to one exact authenticated installation grant.
 * @param owner - Installation and grant epoch derived from the authenticated peer.
 * @returns Source-free inspections for functions owned by that exact grant.
 */
listForInstallation(owner: DynamicCordisInstallationOwner): DynamicCordisPluginInspection[]

/**
 * Inspect one function only when the installation and current grant epoch match exactly.
 * @param owner - Installation and grant epoch derived from the authenticated peer.
 * @param pluginId - Stable delivered-function identity.
 * @returns A source-free inspection, or `undefined` when ownership does not match.
 */
inspectForInstallation( owner: DynamicCordisInstallationOwner, pluginId: CordisDynamicPluginId, ): DynamicCordisPluginInspection | undefined

/**
 * Stop one delivered function while retaining its original cleanup ledger.
 * @param owner - Installation and grant epoch derived from the authenticated peer.
 * @param request - Exact Package and Run compare-and-set fence.
 * @returns The stop outcome, including unresolved cleanup when present.
 */
async stopForInstallation( owner: DynamicCordisInstallationOwner, request: DynamicCordisFunctionStopRequest, ): Promise<DynamicCordisStopResponse>

/**
 * Immediately fence one revoked grant, then converge only the captured cleanup ledger.
 * @param owner - Installation and grant epoch whose authority was withdrawn.
 */
async revokeInstallation(owner: DynamicCordisInstallationOwner): Promise<void>

/**
 * Run one delivered function for the authenticated installation.  This is a
 * direct command path: it never gives the new conversation general access to
 * the creating Agent's Plugin registry.
 * @param agent - Exact live Agent selected by the user for this activation.
 * @param owner - Installation and grant epoch derived from the authenticated peer.
 * @param request - Idempotency, version, run, and target revision fences.
 * @returns The activation receipt or a typed refusal; retries reuse the first result.
 */
async runForInstallation( agent: Agent, owner: DynamicCordisInstallationOwner, request: DynamicCordisFunctionRunRequest, ): Promise<DynamicCordisFunctionCommandReceipt>

/**
 * Read bounded command progress without exposing the edit instruction or installation identity.
 * @param owner - Installation and grant epoch derived from the authenticated peer.
 * @param requestId - Previously admitted function command identity.
 * @returns Owner-scoped progress, or `missing` after restart, eviction, or ownership loss.
 */
commandStatusForInstallation( owner: DynamicCordisInstallationOwner, requestId: string, ): DynamicCordisFunctionCommandStatus

/**
 * Reserve an edit without granting model tools until its exact prompt RPC is claimed.
 * @param agent - Exact live Agent selected by the user for the edit turn.
 * @param owner - Installation and grant epoch derived from the authenticated peer.
 * @param request - Idempotency, version, target, and natural-language instruction.
 * @returns A prepared receipt or a typed refusal without activating tool access.
 */
prepareEditForInstallation( agent: Agent, owner: DynamicCordisInstallationOwner, request: DynamicCordisFunctionEditRequest, ): DynamicCordisPreparedEditReceipt

/**
 * Activate only from the exact SessionController RPC claimed for this pre-step.
 * @param agent - Exact live Agent whose inbox claimed the prompt.
 * @param requestId - RPC identity emitted by the Agent Loop claim receipt.
 * @returns The authorized Plugin reference, or `undefined` without an exact prepared match.
 */
activatePreparedEdit(agent: Agent, requestId: string): DynamicCordisReference | undefined

/**
 * Read the instruction retained inside one active Host capability.
 * @param agent - Exact live Agent that activated the edit.
 * @param requestId - Exact prepared command identity.
 * @returns The instruction only while that command remains active.
 */
preparedEditInstruction(agent: Agent, requestId: string): string | undefined

/**
 * Withdraw a prepared or active edit after prompt admission or turn failure.
 * @param requestId - Exact prepared command identity to revoke.
 */
revokePreparedEdit(requestId: string): void

/**
 * Stop a Plugin from the user panel and queue the resulting state change for the model's next step.
 * @param agent - Agent whose Session owns the Plugin and receives the context.
 * @param pluginId - Stable Plugin identity to stop.
 * @returns Success or the reason no run was stopped.
 */
@Remote('stopFromPanel') async stopFromPanel(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisStopResponse>

/**
 * Replace the Host mirror of the Client inspect provider directory.
 * @param providers - complete Client provider manifest.
 * @returns null after accepting the manifest.
 */
@Remote('syncInspectManifest') syncInspectManifest(providers: readonly CordisInspectProviderManifest[]): null

/**
 * Claim one pending Client inspect query with its live result.
 * @param agent - Session that owns the query.
 * @param requestId - exact pending query identity.
 * @param resolution - provider result or structured refusal.
 * @returns whether this answer won the query.
 */
@Remote('resolveInspectQuery') resolveInspectQuery( agent: Agent, requestId: CordisInspectRequestId, resolution: CordisInspectQueryResolution, ): CordisInspectResolveAck

/**
 * Frame-wide inventory, grouped as one row per stable Plugin.
 * @returns Source-free metadata for every process-local Plugin.
 */
@Remote('inventory') inventory(): DynamicCordisInventoryRow[]

/**
 * Read one Session's Host-rich state for inspection and result rendering.
 * @param agent - Agent whose Session selects visible Plugins.
 * @returns Plugin versions, active runs, Host fibers, and render failures.
 */
snapshot(agent: Agent): DynamicCordisSnapshotRow[]

/**
 * Read source-free context for an explicit `@pluginId` user gesture.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity referenced by the user.
 * @returns The preferred modification base, or undefined when unavailable.
 */
reference(agent: Agent, pluginId: CordisDynamicPluginId): DynamicCordisReference | undefined

/**
 * List source-free Plugin summaries owned by one Session.
 * @param agent - Agent whose Session selects visible Plugins.
 * @returns one summary per Plugin in creation order.
 */
listPlugins(agent: Agent): DynamicCordisPluginInspection[]

/**
 * Inspect one Plugin without returning Package source.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - stable Plugin identity.
 * @returns version pointers, latest run, and all Package summaries.
 */
inspectPlugin(agent: Agent, pluginId: CordisDynamicPluginId): DynamicCordisPluginInspection

/**
 * Read one exact immutable Package and its Host and Client source.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity that owns the Package.
 * @param packageId - Exact immutable Package identity to inspect.
 * @returns Package metadata, source, and the Plugin's lifecycle pointers.
 */
inspectPackage( agent: Agent, pluginId: CordisDynamicPluginId, packageId: CordisDynamicPackageId, ): DynamicCordisPackageInspection

/**
 * Record a post-load render failure for the exact active run.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity that rendered.
 * @param pluginRunId - Exact active run that produced the failure.
 * @param failure - Slot, message, and entry-retirement result.
 * @returns Null after recording or ignoring a stale report.
 */
@Remote('reportRenderFailure') async reportRenderFailure( agent: Agent, pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, failure: DynamicCordisRenderFailure, ): Promise<null>

/**
 * Report a Client guard rejection that happened after the Package completed activation.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity whose Client code was rejected.
 * @param pluginRunId - Exact active run that produced the rejection.
 * @param failure - Original guard message and stack.
 * @returns Null after reporting or ignoring a stale/startup failure.
 */
@Remote('reportClientGuardFailure') async reportClientGuardFailure( agent: Agent, pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, failure: CordisErrorDetails, ): Promise<null>

/**
 * Invoke an active Host method while rejecting stale Client runs.
 * @param pluginId - Stable Plugin identity that owns the method.
 * @param pluginRunId - Exact active run authorizing the call.
 * @param method - Registered Host handler name.
 * @param args - JSON argument delivered to the handler.
 * @returns The JSON result or a typed invocation failure.
 */
@Remote('invoke') async invoke( pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, method: string, args: JsonValue, ): Promise<DynamicCordisInvokeResult>
```

Types: [Agent](core.md)

Source: [`packages/extensions/cordis-host-runner/src/index.ts`](../../packages/extensions/cordis-host-runner/src/index.ts)

<a id="ctxinspector--inspectorservice"></a>

### `ctx.inspector` — `InspectorService`

Shared Host/Client service façade over the realm's source publisher.

```ts cordis-catalog
/**
 * Publish one JSON observation without waiting for Worker delivery.
 * @param topic - Domain-owned topic name.
 * @param payload - JSON value validated before it reaches the carrier.
 * @param monotonicMs - Source-clock timestamp; defaults to `performance.now()`.
 */
publish(topic: string, payload: InspectorJsonValue, monotonicMs?: number): void
```

Source: [`packages/experimental/inspector/src/index.ts`](../../packages/experimental/inspector/src/index.ts)

<a id="cordis-events"></a>

### `cordis/*` events

<a id="cordisdynamic-package--emit"></a>

#### `cordis/dynamic-package` — emit

One exact Plugin/Package activation is now live in the Host.

```ts cordis-catalog
/**
 * One exact Plugin/Package activation is now live in the Host.
 * @param pkg - stable plugin, immutable package, run identity, and label.
 * @mode emit
 */
'cordis/dynamic-package'(pkg: DynamicCordisPackage): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisdynamic-retract--emit"></a>

#### `cordis/dynamic-retract` — emit

One exact activation was withdrawn.

```ts cordis-catalog
/**
 * One exact activation was withdrawn.
 * @param retracted - plugin, package, and run identity.
 * @mode emit
 */
'cordis/dynamic-retract'(retracted: DynamicCordisRetracted): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisinspect-query--emit"></a>

#### `cordis/inspect-query` — emit

Request a live read-only query from the Client inspect registry.

```ts cordis-catalog
/**
 * Request a live read-only query from the Client inspect registry.
 * @param request - correlation, Session, provider, method, and JSON input.
 * @mode emit
 */
'cordis/inspect-query'(request: CordisInspectQueryRequest): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisinspect-query-resolved--emit"></a>

#### `cordis/inspect-query-resolved` — emit

Notify every Client that an inspect query has settled or been cancelled.

```ts cordis-catalog
/**
 * Notify every Client that an inspect query has settled or been cancelled.
 * @param resolved - exact query identity that is no longer answerable.
 * @mode emit
 */
'cordis/inspect-query-resolved'(resolved: CordisInspectQueryResolved): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisrequest-run--emit"></a>

#### `cordis/request-run` — emit

A Client-bearing activation needs a browser page, and may require a user decision.

```ts cordis-catalog
/**
 * A Client-bearing activation needs a browser page, and may require a user decision.
 * @param request - correlation identity, owner, target version, mode, and approval requirement.
 * @mode emit
 */
'cordis/request-run'(request: DynamicCordisRunRequest): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisrequest-run-resolved--emit"></a>

#### `cordis/request-run-resolved` — emit

A pending Client activation request left the answerable state.

```ts cordis-catalog
/**
 * A pending Client activation request left the answerable state.
 * @param resolved - request identity and outcome.
 * @mode emit
 */
'cordis/request-run-resolved'(resolved: DynamicCordisRequestResolved): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)
<!-- END GENERATED cordis-surface -->
