# Agent Note: Project planning preserves intent separately from execution

Status: implemented

English | [中文](2026-09-27-project-planning-and-execution-boundaries.zh.md)

## Problem

Useful work emerges across conversations before its scope or acceptance is settled. Requiring a complete task form loses these ideas; treating every suggestion as an executable task invents commitment. Later discussion must refine the same object while preserving its source and the version actually handed to an executor.

The existing [same-session Goal](../feature/2026-07-19-persisted-same-session-goal-domain.md) owns continuation within one Session. [Delivery and Queue](2026-08-30-delivery-queue-bridge.md) own governed execution and recovery, and [Project Memory](../feature/2026-09-08-project-memory-v1.md) owns source-checked lessons and human acceptance. None owns a cross-session pool of evolving project intentions. These decisions remain authoritative in their separate domains.

## Decision

The optional Planning composition owns project-local cards, immutable revisions, pending proposal generations, manual lanes and order, estimates, dependencies, reviews, and durable links to execution. The Agent loads a packaged Skill from ordinary conversational intent. Explicit, identified user changes use the current version directly; inferred material changes remain proposals whose exact generation can be accepted. Source content supplies evidence, never authority.

An unstructured capture stores the exact text as an unverified source on a pending Proposal. Optional scope, acceptance, estimate, and boundary detail remain empty until Planning refines them. The workbench does not create an active item from this capture; accepting one exact Proposal generation performs that transition.

The Planning Definition derives an evolution view from a detached Board snapshot. Sources, Proposal generations, accepted revisions, reviews, dependencies, and Delivery handoffs form stable nodes and edges. Pending and dismissed alternatives remain visible outside the accepted spine. This projection performs no model call and does not invent historical lane or dependency values that the Board did not retain.

The Planning MCP gateway uses the Provider already owned by its Host. A deployment fixes one Workspace and actor and authenticates requests with an environment-supplied bearer token. Its loopback endpoint exposes list, read, and pending-Proposal creation only. External callers cannot select another Workspace or actor, accept a Proposal, mutate Project Memory, or dispatch Delivery work.

One bounded Board record commits a mutation, its audit event, and its retry receipt together. A single Host owns writes for each storage namespace. Board and object version checks reject stale edits; replaying an identical request returns its committed result. A review references an immutable item revision. Creating a follow-up from a review commits the new item and the review link atomically.

For a direct Agent create or revise, the Provider adds the validated initiating user message to revision sources if the model omitted it. This capture occurs after receipt replay lookup without changing the submitted command, so an identical retry retains its request identity. A full source list rejects the write instead of dropping the initiating message.

Execution handoff freezes the exact planning revision, source snapshot, mapper identity, and request digest before calling Delivery. The bridge reuses the durable idempotency key after an uncertain result and links the returned Case only after creation. It creates no Queue lifecycle, requirement approval, dispatch, or human acceptance. Product scope carries into the Delivery contract; Packet path permissions and executable verification remain Delivery-owned. Later planning edits do not rewrite the frozen handoff.

Planning reads Delivery's current projections and immutable evidence through the linked Case. It does not persist an execution-state copy. Execution, verification, human acceptance, and review remain distinct facts. Remembered lessons use Project Memory's existing candidate and human-acceptance flow. Knowledge capture preserves versioned source text without implying generation or publication.

## Alternatives considered

- **Use one Session Goal for the project backlog.** Rejected because a Goal's continuation authority, budget, and Session lifetime do not represent several independently arranged intentions across conversations.
- **Infer and dispatch immediately.** Rejected because recognizing an idea is neither approval of an inferred plan nor permission to execute it. Proposals preserve progress without fabricating commitment.
- **Add a second execution or memory state machine.** Rejected because Delivery, Queue, and Project Memory already own those transitions and their recovery rules. Durable identities and read-time projections connect them without competing truth stores.
- **Rely on an in-memory handoff or a cross-store transaction.** Rejected because a process may stop after Delivery creation and before Planning receives the result. Prepared state plus deterministic replay closes that window without assuming atomic writes across stores.
- **Rely on the model to include the initiating source.** Rejected because a model can preserve older sources while omitting the message that authorized a new revision; the Provider already validates that message and can capture it without changing the request digest.
- **Create a separate capture store or Planning Provider for MCP.** Rejected because Proposal generations already represent incomplete understanding, while a second Provider would introduce competing project authority and storage ownership.

## Consequences

Users can refine plans through conversation and inspect the same objects in a workbench. Source-backed revisions make a later execution or lesson traceable to the discussion that produced it. Unknown estimates remain unknown, suggested priority does not overwrite manual order, and archiving does not establish completion.

Capturing an idea is cheap and reversible, while adopting it remains explicit. The evolution graph is reproducible across refreshes and Sessions from the same snapshot. MCP clients gain a narrow contribution path; deployment must select the Workspace and supply the endpoint credential through the Host environment.

The bounded, single-writer Board deliberately does not provide multi-host concurrent mutation. Semantic intent recognition belongs to the model and Skill; the Host enforces project access, actual source identity, strict commands, and version checks rather than claiming to prove natural-language intent. Live model behavior therefore needs separate acceptance from provider and schema tests.

Real Loader tests exercise proposal and handoff recovery, while the execution lifecycle test uses real Git, Queue, evidence, and verification with the external Codex transport replaced. That test does not establish live external execution or personal Profile installation; those require their own observations.
