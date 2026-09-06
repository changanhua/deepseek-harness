# Agent Note: DSH-native placement validation for architecture intelligence

Status: proposed

English | [中文](2026-08-25-dsh-native-placement-validation.zh.md)

## Problem

Architecture guidance can quote DSH rules while still producing a parallel runtime. A generic umbrella such as a “Cognitive Kernel” can silently take ownership of Agent, Session, Tool, LLM, and event lifecycles that DSH already owns. Prose-only reminders do not stop that design from reaching implementation, so a system intended to teach DSH-native architecture can fail its own dogfood task.

The first Architecture Intelligence design placed V0 correctly as repository tooling under `.agents/` and `scripts/`, but its Architecture Decision Packet did not make that placement a first-class decision. Its validators checked seam completeness and model-visible logging without deterministically rejecting redefined DSH concepts, domain mutations collapsed into Session events, UI-only branches presented as Session forks, domain records stored in Settings, an unnecessary public Service for one internal caller, or a “compose” decision that names no existing extension point.

## Proposal

Architecture Intelligence V0 remains repository development tooling. It owns reviewable knowledge, command implementations, and rebuildable run artifacts; it does not register a Cordis Service or own DSH Agent, Session, Tool, LLM, or event state. A checked-in self-ADP records `implementation_kind: repo-tool`, `seam_disposition: none`, the existing DSH runtime owners, an empty concept-redefinition set, and the exact repository artifacts V0 owns.

Every ADP gains a required `dsh_placement` section before package or service design. It records the implementation kind, domain owner, `none/reuse/compose/invent` seam disposition, existing runtime owners, referenced and redefined DSH concepts, event mapping, current Consumers, and evidence that seam roles must evolve independently. A domain component may own its own records while referring to DSH identities; it must not re-own their execution or lifecycle. A `compose` decision must identify the existing extension points it composes; a `new-seam` decision must provide the Service Definition / Provider / current Consumer triple and a complete invention proof.

The deterministic validator rejects these conditions before semantic review:

- `placement.parallel-runtime`: a domain abstraction re-owns Agent, Session, Tool registry, LLM, or their lifecycle.
- `placement.unjustified-public-service`: a public Service lacks current Consumer evidence or independent-role-evolution evidence.
- `placement.compose-without-existing-seams`: a `compose` decision names no existing extension point or seam.
- `placement.event-domain-collapse`: an ordinary domain mutation becomes a generic DSH event, or a model-visible projection lacks replayable Session history.
- `placement.visual-branch-fork`: a display-only branch claims Session fork without durable history divergence.
- `placement.settings-domain-data`: domain records or workspace results use Settings as their source of truth; Settings remains valid for user-adjustable tunables.
- `placement.redefined-dsh-concept`: an ADP declares any redefined DSH core concept.

Phase 0 keeps a public Thinking Workspace mutation regression task that deliberately suggests a “Cognitive Kernel.” A passing design keeps inquiry, hypothesis, evidence link, and branch relation in the workspace domain; reuses DSH execution owners; maps only selected model-visible content into existing Session history; and rejects the umbrella runtime. Because the task contains its expected design in the repository, it is a regression fixture, not a holdout. Formal paired holdouts live only under ignored `.dsh-intelligence/private-evals/` inputs.

## Process boundary

This note governs the repository workflow, ADP fields, validation rules, and dogfood regression for Architecture Intelligence. It does not approve a runtime package, new `ctx.*` service, event type, persistence format, or Web surface. Any later runtime placement requires its own ADP, invention proof, proposed Agent Note, current Consumers, complete seam roles, and focused negative controls.

## Alternatives considered

**Keep placement guidance only in the Contract Kernel and Reviewer checklist.** Rejected because the failure is precisely that fluent prose can coexist with a non-DSH-native decision. Placement must be represented and mechanically rejected before review.

**Implement Architecture Intelligence as a DSH runtime service so it can dogfood plugins directly.** Rejected for V0 because repository snapshotting, retrieval, ADP validation, and evaluation do not require a live product capability or runtime state owner. A service would create the unjustified seam the system is meant to prevent.

**Require a mechanical second Consumer before every public Service.** Rejected because Consumer count is only a smell, not the architectural rule. A current Consumer may need replacement, or roles may need independent evolution, even when one package initially owns multiple roles. The ADP records those concrete reasons instead.

**Forbid all new seams.** Rejected because DSH permits invention when existing extension points and composition cannot meet current obligations. The validator requires complete roles and evidence; it does not replace evidence-based invention with a blanket ban.

## Acceptance criteria

- Architecture Intelligence V0 has a schema-valid self-ADP that records repository-tool placement, no new public service, no redefined DSH concept, and only repository artifact ownership.
- Every non-mechanical ADP supplies `dsh_placement`; `new-seam` requires the complete capability triple, while `compose` names concrete existing extension points.
- Every `placement.*` rule has a deterministic invalid fixture and a valid counterexample.
- The public Thinking Workspace regression rejects a Cognitive Kernel that owns DSH runtime identities and accepts a domain model that references existing DSH owners.
- Model-visible workspace projection is replayable from existing Session history, while ordinary workspace mutations remain in the workspace domain.
- Domain records cannot use Settings as their source of truth, while unrelated Settings-backed tunables remain valid.
- A one-caller public Service without current replacement or independent-evolution evidence fails validation and points to a private capability closure.
- Evidence Capsule IDs are deterministically derived from the target revision and cross-checked against the ADP; formal paired holdouts are not committed with expected answers.

## Risks

The placement schema is intentionally DSH-specific and should not be generalized into a cross-framework ontology. Its stable values must remain small and source-pinned so vocabulary growth does not become another knowledge base.

Hard checks can reject a legitimate new seam if their inputs are too shallow. Validators therefore reject explicit ownership contradictions and missing evidence, while semantic suitability remains with the Reviewer. Evidence-backed invention stays possible, and every negative control is paired with a valid counterexample to expose over-broad checks.

Repository tooling can drift from DSH runtime ownership as packages evolve. The self-ADP and Evidence Capsule must pin a revision, and source-anchor drift must invalidate rather than silently refresh the result.
