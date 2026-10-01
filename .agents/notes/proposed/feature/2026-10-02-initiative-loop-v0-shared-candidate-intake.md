# Agent Note: Initiative Loop v0 shared candidate intake

Status: proposed

English | [中文](2026-10-02-initiative-loop-v0-shared-candidate-intake.zh.md)

## Problem

DSH already has Planning, Delivery, Queue, side-effect safety, and a roadmap for trusted Eval, Budget, and authorized Activation, but the initiative that precedes those owners still usually comes from the user. Reusing Planning Proposal directly would force an early hypothesis into a plan-shaped contract, while letting an Agent create work directly would confuse initiative with execution authority. The system needs a cheap, durable way for either a human or an Agent to propose and investigate what may be worth doing without turning every observation into backlog.

## Proposal

The [Initiative Loop v0 specification](../../../../docs/specs/2026-10-02-initiative-loop-v0-shared-candidate-intake.md) should add one small Candidate owner. Human and Agent proposers share the same durable contract and provenance rules. Candidate origin stays immutable; investigation appends evidence, counter-evidence, uncertainty, and refined revisions. Existing Agent, Tool, Session, Storage, RIR, and Planning owners keep their authority. A Candidate may be assessed by RIR, but only an explicit human promotion may create a non-canonical Planning Proposal. Candidate creation, investigation, or an RIR route never grants new execution authority.

## Alternatives considered

**Use Planning Proposal as the Candidate store.** Rejected because a very early problem, opportunity, simplification, or removal hypothesis should be cheaper than a plan-shaped draft with scope, acceptance, estimates, and Planning-specific lifecycle.

**Store initiative only in Session text.** Rejected because lineage, revision, disposition, restart recovery, and Human/Agent provenance would remain implicit and difficult to query or connect to RIR.

**Let RIR own Candidates.** Rejected because RIR owns investment assessment, not the earlier initiative hypothesis or its investigation lifecycle.

**Create a generic Governance or Experience Plane.** Rejected because current owners already cover execution, evaluation, planning, authority, and durable facts; v0 needs a narrow composition object, not another canonical control system.

**Allow Agent promotion immediately.** Rejected for v0 because initiative quality is not yet calibrated and promotion crosses into engineering commitment. The design keeps Agent initiative broad while leaving final promotion authority human until evidence justifies a wider policy.

## Acceptance criteria

A Human and an Agent can each create a Candidate through distinct trusted entry paths that converge on one durable contract. An Agent can append bounded investigation evidence without gaining capabilities, Candidate history survives restart and stale writes fail, an exact Candidate revision can be assessed by the real RIR owner, and only a Human promotion can create a Planning Proposal without accepting it or dispatching Delivery. Negative tests prove that Agent initiative, RIR routes, and investigation cannot bypass existing authority owners.

## Risks

A Candidate inbox can become a new backlog or architecture-idea generator if creation is cheap but pruning and counter-evidence are weak. v0 therefore keeps Candidate pre-Planning, makes simplify/remove first-class kinds, records counter-evidence, and excludes automatic scanning, cold activation, promotion, portfolio scoring, and outcome learning. A separate risk is duplicating provenance or artifact storage; the implementation should reuse existing references where appropriate and otherwise add only the smallest opaque locator required by the Candidate owner.
