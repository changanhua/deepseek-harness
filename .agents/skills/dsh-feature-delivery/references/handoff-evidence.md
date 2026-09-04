# DSH Skill handoff and evidence protocol

Use this protocol only for multi-phase or multi-agent DSH feature work. A receipt is a task-scoped handoff, not a new repository Registry, durable format, or required committed artifact.

## Common receipt envelope

```yaml
schemaVersion: 1
kind: FeatureCharterReceipt | ReuseDecisionReceipt | CurrentContractReceipt | IssueStackReceipt | ChangeReceipt | DiagnosisReceipt | VerificationReceipt | OrchestrationReceipt | SelfDevelopmentReceipt
repository:
  checkout: <absolute or task-stable identity>
  head: <commit or not-applicable>
  dirtyDiffDigest: <digest, clean, or not-observed>
scope:
  claim: <observable promise or decision>
  paths: [<owned or inspected paths>]
  packages: [<affected packages>]
inputs: [<upstream receipt ids or explicit facts>]
decisions: [<owned decisions only>]
evidence: [<EvidenceRecord ids>]
remainingGaps: [<unproven or undecided facts>]
invalidatesWhen: [<specific input changes>]
```

The producing Skill may render this as Markdown instead of YAML, but it preserves the same fields. A later Skill verifies identity and required fields before reuse. Missing optional detail causes focused discovery, not wholesale restart.

## Evidence record

```yaml
id: <stable task-local id>
claimOrLayer: <requirement, source-contract, generated-declaration, composed, runtime-observed, behavior-verified>
commandOrObservation: <exact command or read-only observation>
scope: [<files, packages, Profile, process, or external target>]
inputIdentity:
  head: <commit or not-applicable>
  dirtyDiffDigest: <digest, clean, or not-observed>
  relevantInputsDigest: <digest or not-observed>
environmentIdentity: <relevant runtime/platform/Profile/provider facts>
result: passed | failed | not-run | observed
proves: <bounded assertion>
doesNotProve: <nearest excluded boundary>
sideEffects: none | workspace-files | dependency-state | build-artifacts | runtime-state | external
freshness: source-bound | environment-bound | time-bound
observedAt: <UTC timestamp>
validUntil: <UTC timestamp or not-applicable>
```

Reuse a record only when its inputs, relevant environment, subject identity, and claim still match. Any `not-observed` field needed for that comparison makes the record non-reusable. A `time-bound` record requires a finite `validUntil` later than the reuse time; an `environment-bound` record requires the recorded environment to be re-established. A failed record is diagnostic evidence, not a reason to run a broader suite.

## Invalidation rules

- Implementation changes invalidate focused behavior, type, build, generated, and runtime evidence that depends on those files; they do not invalidate an approved product outcome by themselves.
- A changed dirty-diff digest or relevant-input digest invalidates source-bound evidence that consumed it. `not-observed` is not a wildcard and cannot establish sameness.
- Public Service, Remote, config, persistence, or package-export changes also invalidate the owning generated declarations and documentation surfaces.
- Package-manifest changes invalidate dependency-state and module-graph evidence.
- Profile, Bundle, Loader, Host/Client, or build-input changes invalidate composition and affected runtime evidence.
- Documentation-only changes invalidate documentation, link, pairing, metadata, and generated-doc evidence; they do not invalidate behavior tests whose inputs are unchanged.
- Environment-bound Provider, browser, restart, or platform evidence is reusable only for the recorded environment and target.
- Time-bound evidence expires at `validUntil` even when source and environment identities still match.
- A diagnosis invalidates only the diverged layer and dependent later layers. Earlier proven layers remain fresh unless the fix changes them.

## Verification levels

| Level | Owner | Purpose |
| --- | --- | --- |
| Authoring | implementation worker | smallest red/green focused test and affected type check |
| Slice checkpoint | slice integrator | package boundary, required generated/doc artifacts, and local negative paths |
| Feature acceptance | primary agent + independent verifier when required | composed real vertical and Charter-closing observation |
| Publish | pre-push workflow | outgoing diff, stack/base state, and publication mechanics |

Do not run Feature acceptance for every authoring edit. Do not use Publish checks to replace product acceptance.

## Multi-agent handoff

Every delegated lane records:

```yaml
owner: <agent/role>
mode: read-only-explorer | implementation-worker | reviewer
owns: [<questions or exclusive files/packages>]
dependsOn: [<receipt/contract ids>]
mustNotTouch: [<other WIP or shared decisions>]
focusedEvidence: [<commands the lane alone owns>]
stopWhen: <deliverable, conflict, or missing authority>
```

The primary agent integrates. Read-only explorers may run concurrently only for distinct questions. Implementation workers may run concurrently only after shared contracts are frozen and file ownership is disjoint. The reviewer receives the stable integrated diff, Charter/Issue receipts, and evidence ledger; it does not receive an intended verdict or rerun every fresh check by default.

## Skill-specific receipts

- `FeatureCharterReceipt`: Epic outcome, actor/entry/result, hard boundaries, non-goals, required real vertical, top-level closure, and open facts only.
- `ReuseDecisionReceipt`: direct-reuse/adapt/bridge/vendor/build decision with source evidence and rejected alternatives.
- `CurrentContractReceipt`: exact checkout Definition/Provider/Consumer/Bridge/Profile facts and uncertainty.
- `IssueStackReceipt`: requirement-to-Issue-to-evidence DAG, frozen shared contracts, parallelizable lanes, docs/generated obligations, and final acceptance dependency.
- `ChangeReceipt`: changed promises, owned paths, produced artifacts, worker-focused evidence, and remaining integration work.
- `DiagnosisReceipt`: exact identities, first divergence, classification, safe next action, and invalidated evidence layers.
- `VerificationReceipt`: five-layer ledger, reused and rerun evidence, omitted layers, and highest proven claim.
- `SelfDevelopmentReceipt`: controller/subject/verifier identities, frozen policy/verifier plan, isolation, authority stops, world evidence, and contamination status.
