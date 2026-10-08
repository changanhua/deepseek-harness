# Eval contracts

English | [中文](eval.zh.md)

This reference covers trusted Plan sources, Attempt workspaces and the pure [Eval library](../../packages/eval/eval/README.md): evaluation intent, recorded execution identities and internally consistent decisions. The library performs no observation, credential access, evidence retrieval, budget admission or activation. Its existing Suite/Run/report runner retains deterministic replay semantics.

## Trust boundary

`parseEvalPlan`, `parseResolvedExecutionManifest` and `parseEvalGateDecision` check structure. `validateEvalDecisionContext` additionally checks content references and execution bindings. None authenticates a producer or upgrades caller JSON into trusted observations. A Consumer must obtain records through trusted owners, resolve observation/report/integrity/budget references, and verify the approved verifier plan was frozen before subject execution. Matching hashes establish content identity only.

The contracts have separate `kind` discriminants and `schemaVersion: 1`. Unknown versions and extra fields are rejected. Existing `EvalSuite`, `EvalRun` and `EvalReport` retain their own version 1 semantics; their source revision, route and name-only `visibleSurface` are not execution attestations. No conversion fills missing observation identity from these fields.

## EvalPlan

| Field | Meaning |
|---|---|
| `id`, `version`, `suiteRef` | Plan identity and exact Suite reference |
| `repository` | Requested revision label plus expected full lowercase Git commit; abbreviated revisions are rejected |
| `routes` | Ordered Provider/model, preset artifact and non-secret parameter requirements |
| `repeatPolicy` | Explicit count, nullable seed and route/case/repeat ordering |
| `baselineRef`, `workspacePolicy` | Optional exact baseline and per-cell workspace policy |
| `allowedEntrypoints` | Unique, normalized web/cli/ci set; parsing grants none of them |
| `credentialAuthorizationRef`, `budget` | External authority references; required budget has a reference, explicit exemption has none |
| `verifierPlanRef` | Exact verifier policy to be approved and frozen by the Host before execution |

References contain `id`, `version` and lowercase SHA-256 `digest`. A Plan's content reference uses its id/version and `evalContractDigest(parseEvalPlan(input))`; there is no self-referential digest field. Plan validation does not resolve Suite membership or approve a caller-supplied budget exemption.

## ResolvedExecutionManifest

Each manifest binds an id/version to `planRef`, `suiteRef`, `runId` and one cell's `caseId`, `routeId`, zero-based `repeatIndex` and positive `attempt`. Subject observations are mandatory; grader and verifier observations may be null. The cell's subject route must agree with its route id. Grader/verifier cannot reuse the subject execution id.

Each recorded role identity contains an execution id, observer and evidence references, full observed commit and workspace lease reference, build/config digests, Profile artifact identity, nullable model route, and Tool/Skill artifact sets. The subject requires a model route. A non-model grader/verifier can use a null route. Artifact identities contain id, source and content digest; names alone are insufficient. Config bodies, credentials and artifact bytes do not belong in these identity records; producers must restrict route parameters to non-secret values.

Context validation requires the observed subject commit and route to match the Plan for pass; non-pass decisions retain those deviations as failure evidence. Repeat indexes must fit the Plan count, and every manifest must name the same run, Plan, Suite and frozen verifier policy as the decision. Manifest ids and cell-attempt tuples are unique. A reused execution id must carry identical observations across all supplied roles and manifests. These are structural constraints, not proof of process isolation or actual Provider configuration.

## EvalGateDecision

A decision records `pass`, `block`, `retry` or `needs-attention`, a stable reason, run/Plan/Suite references, exact manifest references, report reference and reported outcome, optional verifier result, evidence-integrity and budget receipts, optional baseline delta reference, and a timestamp. A verifier result names its execution, frozen policy, exact report and manifest set, evidence reference and approved/rejected/unknown outcome.

`pass` requires nonempty manifest references, an approved verifier, intact evidence with a receipt, and either budget authorization/settlement references or an explicit exemption. Invalid or infrastructure-uncertain report outcomes never pass. A required Plan budget cannot be replaced by an exemption; a baseline Plan requires a comparison reference. Every passed manifest must bind the deciding verifier execution. Non-pass records may retain unknown evidence, missing verifier and no manifests, allowing refusal before execution without fabricating observations.

`criteria-satisfied` is reserved for pass. Other stable reasons are `criteria-failed`, `invalid-result`, `infrastructure-uncertain`, `identity-mismatch`, `evidence-missing`, `evidence-corrupt`, `verifier-missing`, `verifier-rejected`, `budget-unknown`, `budget-exhausted`, `non-comparable` and `pending-verification`. The library rejects contradictory claims; it does not choose statistical thresholds or translate every failure into a fixed decision. A task-failure sample does not by itself determine regression policy. Retry never grants another model call or expenditure.

The decision context checks that supplied manifest contents hash to the referenced identities and that verifier report/manifest references match the decision. It does not load a report, prove its summary, check case completeness, recompute baseline statistics, enforce expiry or authenticate receipts. Those remain trusted producer/Consumer responsibilities. JSON and Markdown formatters expose the same complete normalized records; Markdown includes a decision summary and an explicit structural-validation limitation.

## Canonical identity

`serializeEvalContract` rejects non-JSON values, sorts object keys and preserves array order. Parse contracts before hashing: parsers sort only entrypoint, capability and manifest-reference sets after duplicate checks. Route order, parameter arrays and the supplied manifest sequence remain significant. SHA-256 covers the entire canonical parsed record, including its kind and schema version; a changed fact produces a different content reference. Unsupported formats are rejected rather than upgraded through compatibility shims.

## Ownership

Eval owns these values and the existing runner/report calculations. RepoWorkspace, execution Providers and Host composition supply observations; evidence Consumers verify retained artifacts; the budget owner supplies resource decisions; Activation owns permission to continue. This pure library publishes no Cordis service, config row, Storage Domain, model tool or runtime authority factory. Accordingly, it contributes no new Cordis/config/persistence catalog entries.

## Trusted sources and run admission

The [Plan source](../../packages/eval/eval-plans-local/README.md) owns complete Host-pinned contents under trusted roots and durable run admission. Discovery returns the same path-free summaries; resolution retains the declared keyless/live mode and fresh preflight. Admission accepts only this owner's immutable resolution and rechecks current source and the budget ancestor chain before writing. An identical request and resolution recover the same run; changed identities conflict. Neither resolution nor admission starts Queue work or a model.

Tool preflight compares the globally registered contract, Preset digests use newline-normalized composition text, and Skill identity includes instruction content and source. The executor still records the exact execution composition and visible capabilities; Host-declared keyless mode is not execution evidence. See the [configuration guide](../cookbook/trusted-eval-and-budget.md). The Host-only `resolvedRequirements.tools` and `.skills` preserve approved artifact identities, are deeply frozen and included in `resolvedDigest`; downstream Consumers compare them with observed Manifest identities. Live resolution also requires each route’s positive output bound and owner-verified, finite, expiring budget authority; only keyless resolution may be exempt.

## Attempt workspaces

The [RepositoryWorkspace bridge](../../packages/eval/eval-repo-workspace/README.md) resolves an actual full commit before opening a separate lease under the Queue Attempt id. Preparation supports an empty directory, contained and bounded exact-commit fixture files, or the repository checkout. Output retains the Provider-observed commit, preparation digest and lease disposition, without durable absolute paths.

The bridge removes the lease only after the executor reports known completion and child quiescence. Uncertain execution, reuse conflicts or uncertain cleanup cannot become success; the Queue wrapper returns unknown and Queue retains Attention. An existing preparation marker prevents reuse of an unknown directory after restart. This bridge implements neither the subject/grader nor a trusted GateDecision.

## Isolated cell execution

The [isolated execution library](../../packages/eval/eval-isolated/README.md) consumes owner-minted admission and binds one cell to its real active Queue Attempt and repository lease. The Host pins trusted core artifacts separately for Subject and Grader; Windows AppContainer identities and Jobs isolate task code and role-private state. Authenticated core registry snapshots supply actual capabilities, while Host observations supply build/config/process identity and final Budget-guarded model dispatch facts. Agent output remains untrusted task material.

`IsolatedCellBinding` is durable path-free selection data, not execution authority. `PreparedIsolatedCell.start` requires the matching active Attempt. `IsolatedCellResult` separates execution status from business outcome and includes a nullable actual Manifest plus the transferred evidence digest. `ExecutionEvidenceBundle` contains immutable, role-bound material references and content; only exact acknowledgement permits release. Unknown accounting, quiescence or transfer returns Queue unknown Attention with retained custody. These contracts neither certify arbitrary modified cores nor produce GateDecision.

## Durable runs and decisions

[EvalRuns](../../packages/eval/eval-runs/README.md) defines submission, queries, conditional controls and safe evidence reads. Its [local producer](../../packages/eval/eval-runs-local/README.md) reuses the original Plan admission and Queue Batch, records control intent durably, and derives a private Gate snapshot from original materials, current Attempts and Budget receipts. Historical Plan recovery does not require an available model and cannot mint a fresh admission. Public views omit raw prompts, credentials and Host paths.

[EvalGates](../../packages/eval/eval-gates/README.md) separates the retained EvalGateDecision from current/stale validity. The [local Gate producer](../../packages/eval/eval-gates-local/README.md) serializes evaluation of a run, launches the fixed checker in a separate Profile and retains original input, exact report and Host identity material. Expired decisions remain readable; an authorizing consumer must check current validity. The first producer supports deterministic output criteria without a baseline.

## Explicit continuation

[EvalActivation](../../packages/eval/eval-activation/README.md) uses a Host-fixed ContinuationPolicy and a request derived from real Gate/Queue owners to claim a Grant at most once. Its [local producer](../../packages/eval/eval-activation-local/README.md) checks target Session workspace, Goal revision and Budget ancestry before dispatching one round in an exclusive Profile without an automatic Goal driver. Consumed proves the exact durable message receipt, not Goal completion; unproven recovery boundaries remain needs-attention without automatic resend. The [CLI consumer](../../packages/eval/eval-app/README.md) accepts configured policy identifiers, never these private authority facts.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxevalactivation--evalactivation-abstract-seam"></a>

### `ctx.evalActivation` — `EvalActivation` (abstract seam)

Durable, explicit bridge from one approved Eval terminal result to at most one Goal round.

```ts cordis-catalog
/**
 * Persist or recover one exact single-use continuation intent.
 * @param access Current Host-bound actor and Workspace authorization.
 * @param request Host-derived Grant, terminal Attempt and fixed continuation message.
 * @param signal Caller cancellation; committed claims remain recoverable.
 * @returns Durable receipt state; consumption never asserts Goal completion.
 */
abstract activate(access: EvalActivationAccess, request: EvalActivationRequest, signal?: AbortSignal): Promise<EvalActivationView>

/**
 * Read a path-free continuation projection without resuming an Agent or sending a follow-up.
 * @param access Current Workspace read authorization.
 * @param id Exact retained continuation identity.
 * @returns Safe receipt without private message text or filesystem locations.
 */
abstract get(access: EvalActivationAccess, id: string): Promise<EvalActivationView>

/**
 * Reconcile persisted intent after a restart; uncertain delivery stays needs-attention.
 * @param access Current authorization for the actor that owns the claimed Grant.
 * @param id Exact existing continuation identity.
 * @param signal Cancellation of recovery; an unproven dispatch is never repeated.
 * @returns Refreshed receipt based on exact persisted Goal message identity.
 */
abstract reconcile(access: EvalActivationAccess, id: string, signal?: AbortSignal): Promise<EvalActivationView>
```

Source: [`packages/eval/eval-activation/src/index.ts`](../../packages/eval/eval-activation/src/index.ts)

<a id="ctxevalgates--evalgates-abstract-seam"></a>

### `ctx.evalGates` — `EvalGates` (abstract seam)

Gate producer contract for CLI and later Activation Consumers.

```ts cordis-catalog
/**
 * Re-read original Host facts, evaluate one frozen policy idempotently, and retain the conclusion.
 * @param access Current Workspace and principal authorization.
 * @param runId Existing admitted run whose original evidence is available to the Host.
 * @param policyId Host-approved fixed verifier policy.
 * @param signal Cancellation of verification; no partial pass is retained.
 * @returns Retained decision and independently refreshed evidence validity.
 */
abstract evaluate(access: EvalRunAccess, runId: string, policyId: string, signal?: AbortSignal): Promise<EvalGateView>

/**
 * Read one previously retained conclusion without re-running the verifier.
 * @param access Current Workspace read authorization.
 * @param id Exact retained decision identity.
 * @returns Historical decision with current or stale validity; neither implies permission to act.
 */
abstract get(access: EvalRunAccess, id: string): Promise<EvalGateView>
```

Source: [`packages/eval/eval-gates/src/index.ts`](../../packages/eval/eval-gates/src/index.ts)

<a id="ctxevalplans--evalplans-abstract-seam"></a>

### `ctx.evalPlans` — `EvalPlans` (abstract seam)

Trusted project Plan source. This owner does not execute, grade, enqueue or attest model outcomes.

```ts cordis-catalog
/**
 * Read safe source summaries under the caller's exact live Workspace authority.
 * @param access - Exact live Workspace and trusted entrypoint authorization.
 * @param signal - Optional caller cancellation.
 * @returns Safe Plan summaries without Host paths or credential material.
 */
abstract discover(access: EvalPlanAccess, signal?: AbortSignal): Promise<readonly EvalPlanSummary[]>

/**
 * Resolve approved immutable source and fresh runtime preflight. The returned object is Host-only.
 * @param access - Exact live Workspace and trusted entrypoint authorization.
 * @param selection - Only the configured Plan id and version.
 * @param signal - Optional caller cancellation.
 * @returns Owner-minted resolution with current readiness evidence.
 */
abstract resolve(access: EvalPlanAccess, selection: EvalPlanSelection, signal?: AbortSignal): Promise<ResolvedEvalPlan>

/**
 * Revalidate one Provider-minted resolution and durably mint/recover the same run identity.
 * @param access - Current Workspace authority, rechecked before persistence.
 * @param resolved - Exact resolution object issued by this Provider.
 * @param requestId - Stable admission identity; changed resolution reuse rejects.
 * @param signal - Optional caller cancellation.
 * @returns Durable admission receipt; replay recovers the original run identity.
 */
abstract admit(access: EvalPlanAccess, resolved: ResolvedEvalPlan, requestId: string, signal?: AbortSignal): Promise<EvalPlanAdmission>

/**
 * Recover original admitted facts without requiring current Provider availability or remaining Budget.
 * @param access - Current read authority for the exact live Workspace and an originally allowed entrypoint.
 * @param requestId - Original admission request identity in that Workspace.
 * @param signal - Read cancellation; this operation performs no execution or new admission.
 * @returns Frozen historical snapshot, or null when this Workspace has no matching admission.
 */
abstract recover(access: EvalPlanAccess, requestId: string, signal?: AbortSignal): Promise<RecoveredEvalPlan | null>

/**
 * Atomically publish a complete configured source generation, or retain the prior generation on error.
 * @param authorize - Host reload authority, rechecked before publication.
 * @param signal - Optional caller cancellation.
 */
abstract reload(authorize: () => void | Promise<void>, signal?: AbortSignal): Promise<void>
```

Source: [`packages/eval/eval-plans/src/index.ts`](../../packages/eval/eval-plans/src/index.ts)

<a id="ctxevalruns--evalruns-abstract-seam"></a>

### `ctx.evalRuns` — `EvalRuns` (abstract seam)

Shared run-control and report contract for CLI and future Web Consumers.

```ts cordis-catalog
/**
 * Admit or reconcile one exact request through the Plan owner and Queue.
 * @param access Current Workspace and principal authority.
 * @param input Stable request, approved Plan selection and Host policy id.
 * @param signal Caller cancellation; committed intent remains recoverable.
 * @returns Safe current view; repeated intent resolves the original run.
 */
abstract start(access: EvalRunAccess, input: StartEvalRun, signal?: AbortSignal): Promise<EvalRunView>

/**
 * Read one run without dispatching work or requiring unspent model budget.
 * @param access Current read authority.
 * @param runId Exact admitted run identity.
 * @returns Current Queue-derived status and checked evidence availability.
 */
abstract get(access: EvalRunAccess, runId: string): Promise<EvalRunView>

/**
 * List bounded run projections for one authorized Workspace.
 * @param access Current Workspace read authority.
 * @returns Views without private evidence bodies, raw Queue payloads or Host paths.
 */
abstract list(access: EvalRunAccess): Promise<readonly EvalRunView[]>

/**
 * Verify and inspect one historical Attempt without executing or exposing private material.
 * @param access Current Workspace read authority.
 * @param runId Exact admitted run identity.
 * @param cellId Exact cell identity from the run view.
 * @param attemptId Real Queue Attempt identity from that cell.
 * @returns Evidence availability, material identities and allowlisted role/accounting facts.
 */
abstract evidence(access: EvalRunAccess, runId: string, cellId: string, attemptId: string): Promise<EvalEvidenceView>

/**
 * Persist an operator action and conditionally apply it to the observed Queue state.
 * @param access Current operator identity and authority.
 * @param input Exact operation and expected safe-view revision.
 * @returns Reconciled view; uncertainty is retained instead of replaying against a later Attempt.
 */
abstract control(access: EvalRunAccess, input: EvalRunControl): Promise<EvalRunView>
```

Source: [`packages/eval/eval-runs/src/index.ts`](../../packages/eval/eval-runs/src/index.ts)
<!-- END GENERATED cordis-surface -->
