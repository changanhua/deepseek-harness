# DSH Skill handoff and evidence protocol

Use this protocol for an actual transfer between agents or sessions, an explicitly requested structured report, or evidence whose identity cannot be established from the current task. The same agent moving between phases reuses its conversation, plan, and tool results without creating receipts. A receipt is an optional handoff representation, not a repository Registry, durable format, or prerequisite for continuing work.

## Minimum useful handoff

Send only what the recipient needs: accepted outcome and constraints, owned work and next action, evidence locations with the inputs they concern, and unresolved questions. An existing task message, plan, or result can carry these facts. Do not restate the same decision in several named receipts or fill irrelevant fields with boilerplate. The structures below are references for recipients that need explicit fields; they are not required output templates for every task.

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

When a recipient requires this envelope, preserve the fields it actually consumes and enough identity to interpret the evidence. Otherwise use a compact natural-language handoff. Missing formatting is not missing evidence; verify relevant facts from their existing source and investigate only what is absent.

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

Reuse evidence only when its relevant inputs, environment, subject identity, and claim still match. Known edit history and tool results in a continuous task can establish this without a new serialized record or digest. At a transfer, preserve the identity needed to make that comparison; unknown identity does not establish sameness. For records explicitly classified as time-bound, retain a finite validUntil; environment-bound evidence needs the relevant environment re-established. A failed record is diagnostic evidence, not a reason to run a broader suite.

Immutable snapshots, digests, and pre-execution verifier plans remain required by the owning self-development, security, or persistence contract when applicable. A shorter handoff cannot relax those guarantees.

## Invalidation rules

- Implementation changes invalidate focused behavior, type, build, generated, and runtime evidence that depends on those files; they do not invalidate an approved product outcome by themselves.
- Changes to relevant source inputs invalidate evidence that consumed them. A digest is one way to compare those inputs; changes to unrelated files do not by themselves invalidate the result. `not-observed` is not a wildcard and cannot establish sameness.
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

State each delegated lane's question or exclusive ownership, needed evidence, and stopping condition in its task message or existing plan. Include dependencies and prohibited overlap where relevant. Use this optional structure only when it helps coordinate the lanes:

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

## Receipt names for structured handoffs

These names identify different kinds of facts when a recipient needs that distinction. They do not require separate documents or a fixed sequence. Reuse one report or existing task context rather than generating parallel copies.

- `FeatureCharterReceipt`: Epic outcome, actor/entry/result, hard boundaries, non-goals, required real vertical, top-level closure, and open facts only.
- `ReuseDecisionReceipt`: direct-reuse/adapt/bridge/vendor/build decision with source evidence and rejected alternatives.
- `CurrentContractReceipt`: exact checkout Definition/Provider/Consumer/Bridge/Profile facts and uncertainty.
- `IssueStackReceipt`: requirement-to-Issue-to-evidence DAG, frozen shared contracts, parallelizable lanes, docs/generated obligations, and final acceptance dependency.
- `ChangeReceipt`: changed promises, owned paths, produced artifacts, worker-focused evidence, and remaining integration work.
- `DiagnosisReceipt`: exact identities, first divergence, classification, safe next action, and invalidated evidence layers.
- `VerificationReceipt`: five-layer ledger, reused and rerun evidence, omitted layers, and highest proven claim.
- `SelfDevelopmentReceipt`: controller/subject/verifier identities, frozen policy/verifier plan, isolation, authority stops, world evidence, and contamination status.
