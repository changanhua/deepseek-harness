# Agent Note: Personal Control Plane as a composition layer

Status: proposed

English | [中文](2026-09-23-personal-control-plane-composition.zh.md)

Baseline: `changanhua/deepseek-harness` `master@6ddb5ca503da7b8a0da286a716565963efcb2f50`

## Context

DSH is used by a single owner who can replace model providers while preserving projects, accounts, tools, work in progress, evidence, and decisions. As models improve, planning, coding, browsing, summarization, routing, review, and other cognitive strategies can be replaced. The durable value of DSH is therefore not a second intelligence layer around the model. It is the owner-controlled layer that preserves truth, intent, authority, and evidence across model changes.

A naive Personal Control Plane implementation would introduce generic `WorkItem`, `StateFact`, `Evidence`, and `Decision` tables. The current baseline already has narrower authorities with stronger semantics:

- [Personal Delivery](../../../../docs/subsystems/delivery.md) owns requirement adoption, immutable revisions, bounded work packets, artifacts, verification reports, and human acceptance decisions.
- [Project Memory](../../../../docs/subsystems/project-memory.md) owns source-backed project claims, proposals, review, acceptance, conflict, supersession, expiry, withdrawal, and retention.
- Workspace, Content, Queue, Session, BrowserTask, Credentials, Interaction, and Context already own their respective scope, source, execution, transcript, action, permission, approval, and context-assembly semantics.

Creating another durable authority above them would duplicate state, require reconciliation, and turn the control plane into the next monolith. The missing capability is composition: a model-neutral view of the owner's current world, a routed command surface, and an explicit path by which accepted work can propose durable project knowledge.

## Decision

The Personal Control Plane is an architectural composition layer, not a new durable authority domain.

Version 1 MUST NOT introduce a generic control-plane database, a generic fact store, or a second work lifecycle. It derives read models from existing owners, routes writes to those owners, and preserves provenance back to the canonical record.

The composition layer has three responsibilities:

1. Build a model-neutral `PersonalControlSnapshot` from authoritative records.
2. Route a `ControlCommand` to the domain that owns the requested state transition.
3. Convert selected, accepted delivery outcomes into `MemoryProposal` candidates without accepting them automatically.

The composition layer MUST NOT become authoritative merely because a model or UI reads it. A model response, Session transcript, generated summary, or control snapshot is not truth by itself.

No package named `control-plane` is required for the first implementation. The first projection SHOULD live at an existing application or bundle composition edge. A dedicated package may be extracted only after at least two independent consumers require the same stable contract.

## Authority map

| Concern | Canonical owner | Control-plane use | Forbidden duplication |
| --- | --- | --- | --- |
| Personal or project scope | Workspace | Select the active scope and resolve scoped services | A second workspace registry |
| Source documents, drafts, versions, and stored artifacts | Content and owned evidence storage | Reference immutable source or artifact revisions | Copying source bodies into a control record |
| Durable project propositions | Project Memory | Read accepted claims; submit proposals for review | Writing model summaries directly as accepted facts |
| Requirement, bounded work, verification, and acceptance | Personal Delivery | Expose active cases and route delivery transitions | A second WorkItem or acceptance state machine |
| Execution scheduling and attempts | Queue | Reference current execution and outcomes | Treating Queue status as product acceptance |
| Raw execution trajectory | Session | Provide trace and recovery context | Treating the transcript or final message as truth |
| Browser target, resource ownership, and browser-task lifecycle | BrowserTask | Expose usable authority references | Copying browser ownership into memory |
| Temporary permission and human approval | Credentials and Interaction | Expose active leases and pending decisions | Persisting secrets or bypassing approval |
| Model-specific context assembly | Context | Compile a provider-ready view from the snapshot | Making compiled context canonical |
| Single-turn goal evaluation | Goal | Supply an optional evaluation signal | Turning evaluation output into an automatic decision |

The earlier conceptual objects map onto existing records rather than new tables:

| Conceptual object | Existing representation |
| --- | --- |
| Work Item | `DeliveryCase` + `RequirementContract` or `ContractRevision` + `WorkPacket` |
| Evidence | `DeliveryArtifact` + `VerificationReport` + typed `EvidenceRef` |
| Decision | Delivery `DecisionRecord` for case outcomes; Project Memory review and accepted claim state for durable knowledge |
| State Fact | The current record in its owning domain, or an accepted source-backed `MemoryClaim` when the proposition is genuinely durable |

Transient operational state remains with Queue, Session, BrowserTask, Credentials, or Interaction. It may appear in a snapshot by reference, but it MUST NOT be copied into Project Memory merely to create a unified view.

## PersonalControlSnapshot

`PersonalControlSnapshot` is an immutable, derived read model generated for a workspace and purpose. It is disposable and reproducible. It carries enough provenance to let a consumer fetch or validate every material claim.

A version 1 snapshot contains four views:

- **Truth:** accepted Project Memory claims, pinned Content revisions, and owner-specific current-state references.
- **Intent:** active Delivery cases, frozen requirement revisions, bounded work packets, constraints, and acceptance criteria.
- **Authority:** usable BrowserTask references, credential-lease metadata, pending Interaction decisions, and the permitted command set. Secrets are never included.
- **Evidence:** delivery artifacts, verification reports, decision records, and links to raw Session or Queue traces when needed.

Every snapshot includes `schemaVersion`, `generatedAt`, workspace identity, owner record identifiers, owner revisions or freshness markers where available, and provenance. Consumers MUST treat missing, stale, withdrawn, superseded, or inaccessible source records explicitly rather than silently filling gaps with model inference.

The snapshot MAY be cached for transport, but a cache is not an authority. Any command that changes state must revalidate the relevant owner revision or precondition.

## Control commands and write routing

A control command expresses user or model intent but does not own the resulting state. The composition layer validates scope and routes the command to the canonical service.

Representative commands include:

- open or revise a Delivery case through Delivery;
- freeze a requirement revision or issue a WorkPacket through Delivery;
- record an artifact or request verification through Delivery and its evidence provider;
- accept, reject, revise, or close through Delivery's human-decision path;
- submit a `MemoryProposal` through Project Memory;
- request approval through Interaction;
- acquire or use a temporary permission through Credentials;
- perform a browser action through the Session-bound BrowserTask authority.

Version 1 MUST NOT expose a generic `writeFact`, `setState`, or `markDone` command. Such commands erase ownership boundaries and allow a model to promote its own narration into truth.

Each routed command records the initiating actor, model and Session when applicable, workspace, target owner, target record, expected revision or precondition, result reference, and audit timestamp. Domain-specific audit records remain canonical.

## Promotion from accepted work to durable memory

The learning boundary is deliberately asymmetric:

```text
Session or Queue trace
        -> Delivery artifact and verification
        -> human Delivery decision
        -> optional MemoryProposal
        -> Project Memory review
        -> accepted MemoryClaim
```

A rejected, abandoned, or merely completed Session cannot update durable Project Memory automatically. An accepted Delivery case still does not imply that every observation should become memory.

A promotion candidate must state:

- the proposed durable proposition;
- why the proposition is expected to matter in future work;
- the supporting source revisions, artifacts, verification reports, and decision record;
- its intended scope and freshness or expiry expectation;
- whether it supersedes or conflicts with an existing accepted claim.

The first implementation creates a draft or pending `MemoryProposal` only after an explicit human action. Automatic proposal generation may be evaluated later, but automatic acceptance is outside version 1.

Operational details such as a current Queue attempt, an expiring credential lease, or a transient BrowserTask status are not promotion candidates unless they support a separate durable proposition.

## First vertical slice

The first slice uses DSH to complete one real DSH repository task. It does not create a demonstration-only workflow.

1. Select the DSH workspace and an active Delivery case.
2. Freeze or select the requirement revision and bounded WorkPacket.
3. Generate a `PersonalControlSnapshot` from accepted Project Memory claims, the Delivery contract, current authority references, and existing evidence.
4. Hand the same snapshot contract to one replaceable execution model.
5. Execute through existing Session, Queue, BrowserTask, repository, and credential boundaries.
6. Store outputs as Delivery artifacts and run independent verification.
7. Require an explicit Delivery decision: accept, reject, revise, or block.
8. On acceptance, let the user explicitly create zero or more Project Memory proposals from selected outcomes.
9. Generate a new snapshot and prove that a different model can continue without migrating authority or replaying the full conversation.

The slice is successful only if rejected work cannot change durable truth, accepted work is supported by inspectable evidence, and model replacement does not require a new project explanation outside the authoritative records.

## Implementation sequence

### PR0: Architecture decision

This note records ownership, negative guarantees, the first slice, and kill criteria. It intentionally changes no runtime behavior.

### PR1: Read-only control projection

Add a versioned `PersonalControlSnapshot` query at an existing composition edge. Reuse existing Delivery, Project Memory, Workspace, Content, Interaction, Credentials, Session, Queue, and BrowserTask read contracts. Do not add a new durable table and do not create `packages/control-plane`.

The first consumer SHOULD be the existing Personal Delivery workbench or a narrow server endpoint. Package extraction is deferred until the contract has two independent consumers.

### PR2: Routed commands and evidence continuity

Expose only the bounded commands needed by the vertical slice. Preserve expected revisions, actor identity, source references, and audit continuity. Acceptance remains a Delivery human decision.

### PR3: Explicit promotion bridge

From an accepted Delivery decision, create a prefilled Project Memory proposal with evidence references. The user may edit, submit, or discard it. No claim is accepted automatically.

### PR4: Model-replacement evaluation

Run the same snapshot and command contract with at least two model providers. Compare completion, evidence, token and latency cost, required re-explanation, and any provider-specific leakage into authority domains.

## Acceptance criteria

The first implementation is accepted only when all of the following hold:

- no new canonical database or duplicated work lifecycle is introduced;
- every material snapshot item resolves to an authoritative owner record;
- stale or superseded inputs are visible and commands enforce relevant preconditions;
- a model cannot mark its own work accepted or write an accepted MemoryClaim;
- rejected work leaves no accepted project-memory residue;
- accepted work has inspectable artifacts, verification, and a human decision;
- a second model can resume the case from authoritative state without conversation replay;
- deleting and rebuilding the snapshot does not lose any canonical state;
- provider-specific prompts and strategies remain outside authority records.

## Kill criteria

Stop or remove the composition layer if any of these conditions persist after five real DSH tasks:

- operators must reconcile the snapshot against another control-plane database;
- the snapshot becomes a manually maintained summary;
- most fields merely rename existing DTOs without reducing re-explanation or improving verification;
- promotion produces more stale, duplicate, or conflicting claims than useful durable knowledge;
- the UI becomes the only place where state transitions can be understood;
- a stronger model is prevented from using owner services directly because it must follow a fixed orchestration ritual.

Failure of the full composition layer does not justify deleting the existing owner domains. It means the projection or command surface has not earned its maintenance cost.

## Consequences and risks

This decision reduces greenfield implementation but increases the need for precise cross-domain contracts. Existing owners may use different revision, freshness, and identity conventions. The snapshot must expose these differences rather than flattening them into false uniformity.

The main architectural risk is a new god layer. It is mitigated by three negative guarantees:

1. the composition layer owns no canonical business state;
2. owner services remain callable and testable without the composition layer;
3. commands cannot bypass owner validation, revision checks, audit, or human approval.

The main product risk is building an impressive dashboard that does not improve work. The first slice therefore measures re-explanation, evidence completeness, rejection isolation, and model replacement before broader UI investment.

The main learning risk is memory pollution. Project Memory's existing proposal and review lifecycle remains the mandatory boundary. Most Sessions and many accepted deliveries should produce no durable claim.

## Non-goals

Version 1 does not build:

- a universal personal ontology or knowledge graph;
- automatic analysis of every Session;
- a fixed Planner/Executor/Critic/Supervisor pipeline;
- a second task queue, workspace store, evidence store, or approval system;
- model training, reinforcement learning, or fine-tuning;
- a generic cross-domain mutation language;
- a polished personal operating-system dashboard;
- automatic acceptance of generated memory.

## Validation plan

Documentation validation follows the repository's bilingual pairing and docs-only checks. Runtime PRs must add owner-boundary tests, snapshot provenance tests, stale-revision tests, rejection-isolation tests, and an end-to-end model-replacement scenario.

The first runtime PR must name the exact existing composition edge it extends, list every owner API it reads, and demonstrate why package extraction is not yet necessary. Any proposal to add durable control-plane storage requires a new architecture decision with a concrete case that cannot be represented by an existing owner.
