# Personal Delivery Case and GitHub Publication Implementation Plan

English | [中文](2026-08-30-delivery-case-github-publication.zh.md)

**Goal / DoD:** Personal Delivery owns durable Cases, requirement revisions, requirement approval, execution, evidence, and human acceptance; an approved ready revision can be published once to a configured GitHub repository, executed through the existing Queue/Git/Codex/verifier chain, accepted by a human, and recovered truthfully after restart without exposing credentials or creating an untracked duplicate Issue.

**Architecture:** Add `DeliveryCase`, `RequirementDecision`, and `IssuePublication` to Delivery protocol version 2 while retaining `ContractRevision`, `WorkPacket`, dispatch, evidence, verification, and acceptance ownership. Keep local Git behind `ctx.repoWorkspace`, Queue execution behind `delivery-task-queue`, and GitHub publication in a narrow Host-only library consumed by `delivery-remote`; do not add a generic GitHub Service Definition until a second independent Consumer exists.

**Dependencies:** Current checkout `master@6300ab8dbf7106c02e234ca2c8b19b93888ed052`; preserve the existing `ui-delivery` WIP. The real GitHub slice requires a user-approved canary repository and a Host credential reference whose token can write Issues only in that selected repository. No external mutation occurs before the executor records the exact repository and receives approval for the canary operation.

**Real Acceptance Path:** On an isolated DSH home and disposable local Git repository, create and approve one Delivery Case, publish its exact revision to the approved GitHub canary repository through the Host boundary, verify the persisted `published` binding against the returned Issue, execute and verify one Packet, record human acceptance, restart the complete Loader composition, and prove the Case, publication, Packet, evidence, verdict, and decision remain queryable. A browser run must exercise the same Host records rather than a mock projection.

**Broad Verification Budget:** Run focused Vitest files per task. After code freeze, run the Personal Delivery Loader acceptance suites, `pnpm run build`, `pnpm run test`, `pnpm run test:docs`, `pnpm run doc-sync`, `pnpm run lint`, and `git diff --check` once each; duration is unmeasured on this checkout. Repeat a broad command only after a relevant source, generated artifact, build input, or environment change, and separate pre-existing failures from this diff.

## Global Constraints

- Preserve all unrelated WIP and persistent data; do not reset, clean, delete, overwrite, force-switch, or reuse the current Delivery v1 storage root for a destructive migration.
- Delivery owns Case identity, requirement revisions, readiness, requirement decisions, publication bindings, Packet identity, and human acceptance. Queue owns Work/Attempt lifecycle; Git owns commits and worktrees; evidence storage owns bytes; GitHub owns published Issue and PR facts.
- `DeliveryCase` is the product anchor. A local path, branch, Session, Queue Work, GitHub URL, or Issue number is a locator or projection, never the Case identity.
- Keep `ContractRevision`, `WorkPacket`, `DispatchBinding`, `CompletionClaim`, `VerificationVerdict`, `EvidenceRef`, and `AcceptanceDecision` semantics unless this plan names an exact version-2 field change.
- A revision must be ready and explicitly approved before Issue publication or Packet creation. Model-facing callers can propose or revise; they cannot approve, publish, dispatch, accept, waive, merge, or resolve uncertain external side effects.
- Browser DTOs carry configured references and bounded human inputs only. GitHub tokens, actor authority, idempotency keys, repository paths, and external-resolution authority remain Host-only.
- Persist publication intent and the transition to `publishing` before the HTTP request. A failure after the request may have crossed the side-effect boundary becomes `unknown`; it is never automatically retried or reported as published.
- Keep GitHub import as an optional secondary adapter. The primary product path starts from a Delivery-owned Case and publishes outward.
- Do not add a generic `ctx.github`, executor registry, project-management service, two-way free-form Issue synchronization, automatic PR/merge, GitHub Projects dependency, multi-repository Case, teams, RBAC, multi-host lease, or quota-triggered launch.
- Update English and Chinese docs together, re-record every touched pair, regenerate owned catalogs rather than hand-editing generated English output, and update the active Delivery Agent Note in the same implementation PR.

---

## Frozen Version-2 Contract

The contract task owns these names and transitions. Later tasks consume them without redefining their meaning.

```ts ignore-check
type RequirementOrigin =
  | { kind: 'human'; actorId: string }
  | { kind: 'github-import'; repository: GitHubRepositoryRef; issueNumber: number; contentDigest: Sha256Digest }

interface DeliveryCase {
  schemaVersion: 2
  id: DeliveryCaseId
  repositoryId: RepositoryId
  headRevisionId: ContractRevisionId
  createdAt: string
  updatedAt: string
}

interface RequirementDecision {
  schemaVersion: 2
  id: RequirementDecisionId
  caseId: DeliveryCaseId
  revisionId: ContractRevisionId
  decision: 'approved' | 'rejected' | 'deferred'
  reason: string
  actor: { kind: 'human'; actorId: string }
  decisionNonce: string
  decidedAt: string
}

type IssuePublication = {
  schemaVersion: 2
  id: IssuePublicationId
  caseId: DeliveryCaseId
  revisionId: ContractRevisionId
  repository: GitHubRepositoryRef
  renderedDigest: Sha256Digest
  marker: string
  createdAt: string
  updatedAt: string
} & (
  | { phase: 'prepared'; issue: null; failure: null }
  | { phase: 'publishing'; issue: null; failure: null }
  | { phase: 'published'; issue: GitHubIssueRef; failure: null }
  | { phase: 'failed'; issue: null; failure: PublicationFailure & { sideEffect: 'not-started' } }
  | { phase: 'unknown'; issue: null; failure: PublicationFailure & { sideEffect: 'unknown' } }
)
```

`ContractRevision` remains the immutable requirement content and gains `origin: RequirementOrigin` and a human-readable `title` (the authoritative replacement for the removed v1 `SourceRef.title`, consumed by Issue rendering, the canary label, and the Case card); the GitHub-only `sourceRef` requirement is removed. `WorkPacket.contractRevisionId` remains unchanged. `DeliveryCase.headRevisionId` advances through an expected-head compare-and-set, so concurrent revisions cannot silently branch one Case.

The service operations are fixed as:

```ts ignore-check
createCase(request: CreateDeliveryCaseRequest): Promise<{ case: DeliveryCase; revision: ContractRevision }>
reviseCase(request: ReviseDeliveryCaseRequest): Promise<{ case: DeliveryCase; revision: ContractRevision }>
recordRequirementDecision(request: RecordRequirementDecisionRequest): Promise<RequirementDecision>
createWorkPacket(request: CreateWorkPacketRequest): Promise<WorkPacket>
prepareIssuePublication(request: PrepareIssuePublicationRequest): Promise<IssuePublication>
markIssuePublicationStarted(publicationId: IssuePublicationId): Promise<IssuePublication & { phase: 'publishing' }>
completeIssuePublication(request: CompleteIssuePublicationRequest): Promise<IssuePublication & { phase: 'published' }>
failIssuePublication(request: FailIssuePublicationRequest): Promise<IssuePublication & { phase: 'failed' | 'unknown' }>
resolveIssuePublication(request: ResolveIssuePublicationRequest): Promise<IssuePublication>
```

`createCase()` atomically creates one Case and root revision. `reviseCase()` requires `expectedHeadRevisionId`, creates one child revision, and moves the head atomically. A revision has at most one requirement decision; conflicting decision content under the same revision fails closed. `createWorkPacket()` and `prepareIssuePublication()` require the selected revision to be the named Case revision, ready, and approved. A revision has at most one IssuePublication: a repeated `prepareIssuePublication()` returns the existing record rather than creating a second, and a `failed` publication is terminal - re-preparing a failed publication returns that same record to `prepared` for a new attempt - so one revision can never yield a duplicate Issue.

`resolveIssuePublication()` is human-authorized and supports only `confirm-published` after a Host GET validates the exact marker and rendered digest, or `confirm-not-created` to return an `unknown` or crash-stalled `publishing` publication to `prepared`. `confirm-not-created` requires an explicit Host verification basis recorded with the resolution - an authoritative HTTP response proving no Issue was created, such as the POST's error response or a Host GET returning 404 for the expected Issue location - and operator impression alone is not a basis. It never accepts browser-supplied Issue content as proof and never treats absence from search results as proof that no Issue exists.

---

### Task 1: Freeze Delivery protocol version 2

**Dependencies:** None.

**Ownership:**
- Modify: `packages/delivery/delivery-protocol/src/brand.ts`, `src/types.ts`, `src/schemas.ts`, `src/semantics.ts`, `src/canonical.ts`, `src/index.ts`.
- Modify: `packages/delivery/delivery-protocol/fixtures/valid.json`, `fixtures/invalid.json`.
- Test: `packages/delivery/delivery-protocol/tests/fixtures.spec.ts`, `tests/semantics.spec.ts`, `tests/canonical.spec.ts`, `tests/public-api.typecheck.ts`, `tests/github-source.spec.ts`.
- Modify: `packages/delivery/delivery-protocol/README.md`, `README.zh.md`, `README.i18n.yaml`.

**Interfaces:**
- Consumes: Existing version-1 branded-id, strict-schema, canonical-digest, readiness, verification-plan, Packet, dispatch, verdict, evidence, and acceptance conventions.
- Produces: The frozen version-2 types and schemas above for every later task.

**Verification:**
- Change type: High-risk durable public contract.
- Baseline or RED: Add compile/runtime tests for Case identity, expected-head revisions, human-only requirement decisions, publication discriminants, and removal of mandatory GitHub source; confirm they fail against version 1.
- Completion: `& .\node_modules\.bin\vitest.CMD run packages/delivery/delivery-protocol/tests` and `pnpm run doc-typecheck:contracts-ready` pass for the new contract.
- Escalation: Stop if an unchanged Queue intent/result, verification, evidence, or acceptance invariant would need semantic redesign rather than a schema-version update.

**Acceptance contribution:** Establishes one portable Delivery Case identity independent of GitHub, local paths, Sessions, and Queue Work.

1. Set `DeliverySchemaVersion` to `2`; add the three new branded ids, `RequirementOrigin`, `DeliveryCase`, `RequirementDecision`, `GitHubIssueRef`, `PublicationFailure`, and `IssuePublication`.
2. Replace the GitHub-only `SourceRef` field on `ContractRevision` with `origin` while retaining all requirement, readiness, base, plan, and Packet semantics.
3. Add strict valid and invalid fixtures for every publication phase, unknown-side-effect classification, expected-head identity, and human decision combination.
4. Keep GitHub URL parsing helpers only for the optional importer and publisher response validation; remove GitHub ownership from generic requirement semantics.
5. Update the protocol README pair and record it only after source and tests agree.

### Task 2: Implement Case, decision, and publication persistence

**Dependencies:** Task 1. The `adoptContractRevision()` removal and the `delivery-github-intake` migration in Task 3 land atomically - one PR or an inseparable stacked sequence - so the repository never breaks typecheck between them.

**Ownership:**
- Modify: `packages/delivery/delivery/src/types.ts`, `src/index.ts`.
- Modify: `packages/delivery/delivery-local/src/spec.ts`, `src/index.ts`.
- Modify: `packages/delivery/delivery-testkit/src/fake-delivery.ts`, `src/fixtures.ts`, `src/index.ts`.
- Test: `packages/delivery/delivery-local/tests/persistence.spec.ts`, `tests/invariant.spec.ts`, `packages/delivery/delivery-testkit/tests/contracts.spec.ts`.
- Modify: the README triplets under `packages/delivery/delivery/`, `delivery-local/`, and `delivery-testkit/`.

**Interfaces:**
- Consumes: Task 1 schemas and existing Storage Domain atomic-write/idempotency contracts.
- Produces: Provider-independent `ctx.delivery` operations and matching local/fake Providers for later importer, publisher, Remote, Queue, and UI tasks.

**Verification:**
- Change type: High-risk persistence, authorization, idempotency, and transition boundary.
- Baseline or RED: Add tests for atomic Case+root creation, expected-head CAS, duplicate requests including repeated publication preparation, conflicting decisions, approval-required Packet/publication, publication transitions, restart reconstruction, and v1-domain rejection without mutation.
- Completion: Focused local/testkit suites pass and a reconstructed provider returns byte-equivalent Cases, revisions, decisions, and publications in stable order.
- Escalation: Stop if Storage Domain cannot retain the existing v1 data while opening a separate canary root or failing before mutation; do not introduce an in-place migrator inside this task.

**Acceptance contribution:** Makes the new anchor and every authority decision durable and restart-safe before any external effect exists.

1. Replace `adoptContractRevision()` with `createCase()` and `reviseCase()` at the public Delivery boundary; keep `getContractRevision()` for Packet, runner, verifier, and acceptance consumers.
2. Add `getCase()`, `getRequirementDecision()`, `getIssuePublication()`, and detached snapshot arrays for the new record families.
3. Add Case, requirement-decision, and Issue-publication tables; bump the local domain format and reject v1 before writes. Preserve the old root and use a separate canary DSH home for version 2 acceptance.
4. Serialize Case-head and publication transitions through the existing local Provider write boundary; validate the complete candidate object with Task 1 schemas before commit.
5. Implement identical authority and failure behavior in the fake Provider, then update all shared fixtures and README pairs.

### Task 3: Migrate existing Delivery consumers without changing execution meaning

**Dependencies:** Tasks 1-2.

**Ownership:**
- Modify: `packages/delivery/delivery-github-intake/src/index.ts`, `src/work-brief.ts` and focused tests.
- Modify: Delivery fixtures and direct Contract literals in `delivery-task-queue`, `delivery-runner-codex`, `delivery-verifier`, `delivery-remote`, `delivery-evidence-local`, and `repo-workspace-git-local` tests only where version-2 construction requires it.
- Test: package-local suites for the six named Consumers plus `packages/bundle/personal-delivery/tests/acceptance-safety.spec.ts`.
- Modify: `packages/delivery/delivery-github-intake/README.md`, `README.zh.md`, `README.i18n.yaml`.

**Interfaces:**
- Consumes: Task 2 Case operations and the unchanged WorkPacket/dispatch/claim/verdict/evidence/acceptance semantics.
- Produces: A compiling, behavior-preserving execution chain and an optional GitHub importer that creates or revises a Case but never approves it.

**Verification:**
- Change type: Caller migration plus behavior-preserving refactor.
- Baseline or RED: Run the existing focused Queue bridge, runner, verifier, Remote, repository, evidence, and safety tests before migration; record any pre-existing failures.
- Completion: The same suites pass after migration, and an imported valid Issue yields an unapproved Case revision that cannot create a Packet until a human decision exists.
- Escalation: Stop if a consumer needs GitHub-specific requirement fields at execution time; relocate that dependency to the importer or publisher instead of widening generic protocol.

**Acceptance contribution:** Proves the reliable execution half survives the product-anchor change.

1. Convert the current GitHub importer from direct Contract adoption to Case creation/revision with `origin.kind='github-import'`; keep strict Work Brief parsing as an optional path, not the primary UI.
2. Remove automatic equivalence between explicit import and requirement approval.
3. Update direct fixtures to version 2 and Case-owned revision lookup without changing Queue intent digests beyond their protocol-version input.
4. Re-run the safety scenarios for cancellation, unknown outcomes, missing checkpoint, failed verification, corrupt evidence, distinct worktrees, and human acceptance denial.

### Task 4: Add the Host-only GitHub Issue publisher

**Dependencies:** Tasks 1-3.

**Ownership:**
- Create: `packages/delivery/delivery-github-publisher/package.json`, `tsconfig.json`, `src/index.ts`, `src/render.ts`, `src/failures.ts`, `src/invariant.ts`.
- Create: `packages/delivery/delivery-github-publisher/tests/render.spec.ts`, `tests/publication.spec.ts`, `tests/invariant.spec.ts`.
- Create: `packages/delivery/delivery-github-publisher/README.md`, `README.zh.md`, `README.i18n.yaml`.
- Modify: `packages/delivery/delivery-remote/package.json`, `src/index.ts`, `src/types.ts`, `src/failures.ts`, `tests/operations.spec.ts`, `tests/typert-wire.spec.ts`.

**Interfaces:**
- Consumes: Task 2 publication transitions, `ctx.credentials`, Host `fetch`, configured `repositoryId -> GitHubRepositoryRef + credentialRef`, and the existing Typert cancellation boundary.
- Produces: `publishIssue()` and `resolvePublication()` Host operations plus browser-safe publication views; no new Cordis service key.

**Verification:**
- Change type: High-risk credential, authorization, external side-effect, and recovery boundary.
- Baseline or RED: Fake-fetch tests cover rendered body, deterministic marker/digest, permission failure before start, `publishing` before I/O, 201 response validation, known non-started failure, transport uncertainty, cancellation before/after start, duplicate call, restart reconciliation, and operator resolution.
- Completion: Publisher/Remote focused tests pass; logs, errors, persisted records, and wire snapshots contain no token or credential value.
- Escalation: Stop if a second independent caller requires publication before this task finishes; promote a provider-neutral Issue Publisher Service Definition instead of adding another direct import.

**Acceptance contribution:** Adds the first Delivery-to-GitHub functional projection with truthful side-effect recovery.

1. Render a human-readable Issue from the exact approved revision with Outcome, Context, Scope, Acceptance, Open Decisions, References, Delivery Case/revision identifiers, and one bounded HTML marker containing publication id and rendered digest.
2. Resolve the credential before `markIssuePublicationStarted()`; reject missing target, credential, approval, readiness, or repository mapping without crossing the side-effect boundary.
3. Persist `publishing`, issue one bounded GitHub REST request, validate owner/name/number/URL/body marker from the 201 response, then commit `published`.
4. Classify a failure after request start as `unknown` unless an authoritative HTTP response proves no Issue was created. Never issue a second POST automatically.
5. Resolve `confirm-published` through a fresh Host GET and exact marker/digest validation. Require explicit human authority for `confirm-not-created`.
6. Expose only publication availability, phase, safe failure category, and published Issue coordinates through Remote.

### Task 5: Prove the earliest real GitHub publication slice

**Dependencies:** Task 4 and explicit approval for one canary mutation.

**Ownership:**
- Modify: `packages/bundle/personal-delivery/tests/acceptance-primary.spec.ts` with a separately selected, default-skipped real-provider lane.
- Evidence: execution log records canary repository, Delivery Case id, revision id, publication id, GitHub Issue URL, rendered digest, and persisted phase without recording credentials.

**Interfaces:**
- Consumes: Task 4 Host publisher and a user-approved credential reference scoped to Issues write on the canary repository.
- Produces: Real external and persisted evidence that later UI and bundle work can trust.

**Verification:**
- Change type: Real external boundary acceptance.
- Baseline or RED: Read-only GET verifies repository access and target identity, while `ctx.credentials.describe()` proves only that the reference is configured without printing the token; write permission remains unverified until the approved canary POST, and no Issue is created during readiness.
- Completion: One approved Case creates exactly one real Issue, the returned body contains the exact marker/digest, Delivery stores `published`, and a process reconstruction returns the same binding. Repeating the logical call returns the existing Issue without POST.
- Escalation: Stop before mutation when repository approval, token scope, network access, or cleanup policy is absent; fake success does not substitute for this acceptance fact.

**Acceptance contribution:** Establishes the earliest real side effect before UI expansion and final code freeze.

1. Use a disposable Case title and a documented canary label; do not target a production Issue backlog.
2. Capture the authoritative Delivery and GitHub identities, restart the Host composition, and verify the binding again.
3. Close the canary Issue only when the user-approved cleanup policy permits it; closing is cleanup, not Delivery acceptance evidence.

### Task 6: Replace the import-first workbench with Case-centered workflow

**Dependencies:** Tasks 2, 4, and 5, plus explicit user approval for the second canary mutation.

**Ownership:**
- Modify: `packages/delivery/delivery-remote/src/projection.ts`, `src/types.ts`, `src/index.ts`, `tests/projection.spec.ts`, `tests/operations.spec.ts`, `tests/typert-wire.spec.ts`.
- Modify: `packages/client/ui-delivery/src/client/DeliveryWorkbench.tsx`, `DeliveryWorkbench.module.css`, `contract.ts`, `runtime-controller.ts`, `locales.ts`.
- Modify: `packages/client/ui-delivery/tests/workbench.client.spec.tsx`, `runtime-controller.client.spec.ts`, `apply.client.spec.ts`, `fixtures.client.ts`.
- Modify: README triplets under `delivery-remote` and `client/ui-delivery` without overwriting unrelated current-checkout WIP.

**Interfaces:**
- Consumes: Task 2 Case/decision views, Task 4 publication operations, and existing Packet/run/verify/evidence/acceptance operations.
- Produces: One browser workbench whose primary card is a Delivery Case and whose actions follow requirement authority.

**Verification:**
- Change type: Product-visible Host/Client contract and browser workflow.
- Baseline or RED: Add component/controller tests for draft Case, revision readiness, approval, publication availability, publication unknown resolution, Packet creation, and existing evidence/acceptance flow; remove assertions that require raw Issue URL or repositoryId input.
- Completion: Focused Remote/UI suites pass, then a real browser against the Task 5 Host records creates a second local-only Case, approves and publishes it under the Task 5 canary label and cleanup policy, displays the returned Issue, and continues through one real Packet evidence review without manual internal ids.
- Escalation: Stop if current WIP changes the slot/observable contract in a way that conflicts with this task; reconcile ownership explicitly rather than overwriting it.

**Acceptance contribution:** Delivers the user-visible Case → approve → publish → execute → verify → accept path.

1. Project Cases with derived phases `shaping`, `ready`, `running`, `review`, `blocked`, and `accepted`, each with one stated entry condition: a head revision with decision `rejected` or `deferred` maps to `shaping` (revise before proceeding), `ready` follows an approved head revision, `running` an executing Packet, `review` verification-complete output awaiting human acceptance, `blocked` a published revision whose Packet failed verification or awaits external resolution, and `accepted` a human acceptance decision. Keep publication phase visible but separate from execution lane. Provide an ordered Case list (most recently updated first, showing each derived phase) whose selection opens that Case's primary card, asserted by projection tests. A fresh version-2 home with zero Cases shows an empty state with guidance text and the Case-creation action as the workbench entry point, covered by component tests.
2. Replace `ImportForm` with Case creation/revision editing. Bind the single configured repository on the Host and display a readable target; never ask the browser for `repositoryId`.
3. Show readiness reasons and approval as separate actions. Enable GitHub publication only for an approved ready head revision and configured Host target.
4. Keep optional existing-Issue import behind a secondary action and require human approval afterward.
5. Render every publication phase with its browser presentation and action: `prepared` shows the publish entry, `publishing` shows a busy indicator with cancel availability, `failed` shows the safe failure category with the re-prepare path, `published` shows the Issue link, and `unknown` shows the attention state with resolution actions. Render inline field errors, Packet evidence, and acceptance decision with keyboard and focus behavior.
6. Record a GIF from the real PR server and model flow after the full build refreshes Client artifacts.

### Task 7: Integrate bundle, documentation, generated artifacts, and final evidence

**Dependencies:** Tasks 1-6.

**Ownership:**
- Modify: `packages/bundle/personal-delivery/package.json`, `cordis.patch.yml`, `tests/acceptance-primary.spec.ts`, `tests/acceptance-safety.spec.ts`, `tests/scaffold.spec.ts`, README triplet.
- Modify: `packages/delivery/README.md`, `README.zh.md`, `README.i18n.yaml`, `docs/subsystems/delivery.md`, `delivery.zh.md`, `delivery.i18n.yaml`.
- Modify or move: `.agents/notes/proposed/architecture/2026-08-29-personal-delivery-above-queue.{md,zh.md,i18n.yaml}` according to the implemented-note lifecycle after real acceptance.
- Modify: `packages/README` pair, required package-group maps, TypeScript aggregate references, `knip.json`, root `package.json`, `pnpm-lock.yaml`, generated catalogs/graphs, and `FORK-DIVERGENCE.md` only where executed generators or package topology require them.

**Interfaces:**
- Consumes: Every earlier task and the existing base/Web bundle layers.
- Produces: One supported Personal Delivery composition and the authoritative current documentation/evidence set.

**Verification:**
- Change type: Cross-package integration, generated artifacts, docs, build, and real product closure.
- Baseline or RED: Loader acceptance first asserts Case/approval/publication records are absent from the old composition and that version-1 storage is rejected without mutation.
- Completion: The complete real acceptance path in the header passes; focused and broad commands run within the stated budget; every generated freshness and bilingual pairing check is green; the final diff contains no credential, canary token, private evidence bytes, or unrelated WIP.
- Escalation: Stop if real GitHub publication, browser interaction, restart persistence, or existing Queue safety evidence is unavailable; do not replace a missing boundary with docs or mocks.

**Acceptance contribution:** Proves every DoD item in one packaged, restart-stable, user-visible composition.

1. Configure optional GitHub target mappings without placing a credential value in shipped defaults. Preserve the single local repository and Attempt-owned worktree defaults.
2. Extend the primary Loader acceptance from Case creation through human acceptance and restart; retain all existing safety scenarios.
3. Update the Delivery subsystem, package maps, package contracts, bundle limitations, and Agent Note to state current implemented ownership rather than planned behavior.
4. Regenerate every affected catalog and graph through its owner. Re-record all bilingual pairs.
5. Run one full build so Host contract and dynamic Client bundles agree, then run the final focused/broad verification budget and inspect the real browser/GitHub evidence.

---

## Requirement-to-Task Traceability

| Requirement | Owning task | Completion evidence |
| --- | --- | --- |
| Delivery-owned stable Case and immutable revisions | 1-2 | Protocol and reconstructed-provider tests |
| Human-only requirement approval | 1-2 | Decision/authorization negative tests |
| Preserve existing Queue/Git/evidence/verifier chain | 3 | Same focused safety suites before and after |
| Optional Delivery-to-GitHub publication | 4 | Publisher/Remote state-machine tests |
| Real GitHub side effect and restart binding | 5 | Canary Issue identity plus persisted publication |
| Case-centered browser flow | 6 | Real browser path and GIF |
| Supported bundle and current docs | 7 | Loader E2E, full build, docs/generated gates |

## Stop Conditions

- A revision cannot be made both immutable and correctable without a new versioned identity.
- GitHub cannot provide a canary repository and least-privilege credential under explicit approval.
- The publisher cannot distinguish a known pre-effect failure from an uncertain post-start outcome.
- Existing Delivery v1 data would be deleted or rewritten to start version 2.
- The Case model requires Queue, Session, GitHub, or UI to become its persistence authority.
- A browser or model-facing request must carry a credential, actor authority, repository path, idempotency key, verdict, or acceptance proof.
- The final build cannot prove the Host/Client contract and the real browser still consumes stale generated artifacts.

## Final Review Checklist

- Every Case revision, requirement decision, publication, Packet, dispatch, verdict, evidence reference, and acceptance decision has one authority and one durable identity.
- Every external mutation has persisted intent, a start boundary, bounded output, truthful failure classification, and explicit unknown resolution.
- Every model/browser operation is narrower than its Host counterpart and has negative authorization coverage.
- The first real GitHub slice occurs before UI expansion and final code freeze.
- The current `ui-delivery` WIP is preserved and reconciled explicitly.
- Broad checks run once at freeze unless new evidence justifies a rerun.
- No deferred feature is hidden behind a placeholder or an invented compatibility shim.

## Deferred / Open Questions

### From 2026-08-30 review

- **Task 7 tool serves no stated goal** - resolved on implementation start: the proposal tool is moved out of this round, the `dsh` origin branch is removed from the version-2 contract (human and github-import remain), the final integration task is renumbered to Task 7 and depends on Tasks 1-6 only.
