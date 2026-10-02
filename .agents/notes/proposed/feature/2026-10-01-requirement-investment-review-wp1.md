# Agent Note: Requirement Investment Review WP1 ownership

Status: proposed

English | [中文](2026-10-01-requirement-investment-review-wp1.zh.md)

## Problem

An investment assessment must remain readable after its subject changes without becoming a Planning decision or an execution approval. Existing Planning resource-link mutations advance the Plan revision, while historical Plan revisions do not retain old mutable Focus fields. Attaching assessments through that mutation or reconstructing old input from current context would undermine a read-only review.

## Proposal

The [RIR-WP1 specification](../../../../docs/specs/2026-10-01-requirement-investment-review-wp1.md) owns the target requirements and acceptance cases. Domain persistence, the bounded review runner, trusted Remote, and optional UI have an implementation in this branch; real-model quality acceptance remains unverified. RIR should own immutable assessments, the inputs used for each judgment, and subject-to-assessment associations. Reuse opaque ResourceRef identities and existing runtime mechanisms; expose associations to Planning through a read-only projection. The separate Planning UI redesign is not a prerequisite.

## Alternatives considered

**Write a Planning resource link automatically.** Rejected because the existing command advances canonical state even for a link-only change and can make a just-completed assessment stale.

**Keep only subject ids and reconstruct context later.** Rejected because current Focus and manual text can change; the old judgment would then be shown against different input.

**Require a particular route or a changed decision in the three cases.** Rejected because it rewards echoing expected conclusions. Real input, actual output, and human-reviewed reasoning must support a change or justified retention of the original choice.

## Acceptance criteria

Implementation must satisfy the specification's automated checks and three real-case evaluations. In particular, assessment operations leave Planning unchanged, historical input survives subject edits and reload, and unavailable real-model evidence remains unverified rather than being replaced by schema tests. This proposal does not claim those checks have passed.

## Risks

Captured input increases retained data and may preserve unverified user statements. Keep provenance explicit, exclude secrets, and limit capture to the judgment's actual authorized inputs. Do not turn input retention into a second Planning history store, automatic research pipeline, or WP2/WP3 outcome-learning system.
