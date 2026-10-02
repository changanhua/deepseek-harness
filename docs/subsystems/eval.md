# Eval contracts

English | [中文](eval.zh.md)

This reference covers the pure [Eval library](../../packages/eval/eval/README.md): evaluation intent, recorded execution identities and internally consistent decisions. The library performs no observation, credential access, evidence retrieval, budget admission or activation. Its existing Suite/Run/report runner retains deterministic replay semantics.

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

Context validation requires the observed subject commit and route to match the Plan, repeat indexes to fit its count, and every manifest to name the same run, Plan, Suite and frozen verifier policy as the decision. Manifest ids and cell-attempt tuples are unique. A reused execution id must carry identical observations across all supplied roles and manifests. These are structural constraints, not proof of process isolation or actual Provider configuration.

## EvalGateDecision

A decision records `pass`, `block`, `retry` or `needs-attention`, a stable reason, run/Plan/Suite references, exact manifest references, report reference and reported outcome, optional verifier result, evidence-integrity and budget receipts, optional baseline delta reference, and a timestamp. A verifier result names its execution, frozen policy, exact report and manifest set, evidence reference and approved/rejected/unknown outcome.

`pass` requires nonempty manifest references, an approved verifier, intact evidence with a receipt, and either budget authorization/settlement references or an explicit exemption. Invalid or infrastructure-uncertain report outcomes never pass. A required Plan budget cannot be replaced by an exemption; a baseline Plan requires a comparison reference. Every passed manifest must bind the deciding verifier execution. Non-pass records may retain unknown evidence, missing verifier and no manifests, allowing refusal before execution without fabricating observations.

`criteria-satisfied` is reserved for pass. Other stable reasons are `criteria-failed`, `invalid-result`, `infrastructure-uncertain`, `identity-mismatch`, `evidence-missing`, `evidence-corrupt`, `verifier-missing`, `verifier-rejected`, `budget-unknown`, `budget-exhausted`, `non-comparable` and `pending-verification`. The library rejects contradictory claims; it does not choose statistical thresholds or translate every failure into a fixed decision. A task-failure sample does not by itself determine regression policy. Retry never grants another model call or expenditure.

The decision context checks that supplied manifest contents hash to the referenced identities and that verifier report/manifest references match the decision. It does not load a report, prove its summary, check case completeness, recompute baseline statistics, enforce expiry or authenticate receipts. Those remain trusted producer/Consumer responsibilities. JSON and Markdown formatters expose the same complete normalized records; Markdown includes a decision summary and an explicit structural-validation limitation.

## Canonical identity

`serializeEvalContract` rejects non-JSON values, sorts object keys and preserves array order. Parse contracts before hashing: parsers sort only entrypoint, capability and manifest-reference sets after duplicate checks. Route order, parameter arrays and the supplied manifest sequence remain significant. SHA-256 covers the entire canonical parsed record, including its kind and schema version; a changed fact produces a different content reference. Unsupported formats are rejected rather than upgraded through compatibility shims.

## Ownership

Eval owns these values and the existing runner/report calculations. RepoWorkspace, execution Providers and Host composition supply observations; evidence Consumers verify retained artifacts; the budget owner supplies resource decisions; Activation owns permission to continue. This pure library publishes no Cordis service, config row, Storage Domain, model tool or runtime authority factory. Accordingly, it contributes no new Cordis/config/persistence catalog entries.
