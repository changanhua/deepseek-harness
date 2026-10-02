# Agent Note: Durable initiative without authority

Status: implemented

English | [中文](2026-10-02-initiative-candidate-core.zh.md)

## Problem

Early observations need durable investigation history without becoming canonical Planning commitments. Human and Agent entry points need different authority while sharing one Candidate owner.

## Decision

The [Candidate owner](../../../../packages/initiative/README.md) retains Human and Agent initiative before Planning. Strict caller-free JSON and live runtime checks keep actor identity out of model control. Human commands bind exact active command events, while the provider's Host-configured operator label remains stable across restart. Immutable origin, revisions and separate counter-evidence avoid rewriting the original hypothesis. The bounded read projection selects one revision rather than repeatedly emitting accumulated history.

Promotion uses Planning's existing pending Proposal operation. Its prepared intent reserves the request key and future settlement capacity before the Planning call. A frozen downstream request recovers a commit even when Candidate finalization fails. Only a definite CAS rejection with no matching Proposal can refresh a downstream attempt. The aggregate Board version changes; canonical items, Plan revisions and Delivery handoffs do not.

## Alternatives considered

Using a Planning Item for early hypotheses would create commitment too soon. A second Agent runtime or scanner would confuse initiative with activation. Caller-supplied human labels or verified evidence flags would let untrusted JSON become authority. A simplified RIR scorer would misrepresent an unavailable owner. These alternatives are excluded.

## Consequences

The [full Initiative proposal](../../proposed/feature/2026-10-02-initiative-loop-v0-shared-candidate-intake.md) remains broader than this core. Real RIR and spontaneous live-model initiative are not proven by keyless integration tests. Source references remain explicitly unverified, unknown or unavailable; the owner does not fetch them or detect secrets. Prepared promotions block further Candidate edits until the original operation recovers. The provider rejects writes exceeding the complete single-revision view bound; consumers keep output limits above that bound plus the response envelope.

Loader tests exercise real Commands, Tools, Storage and Planning with an inert Agent handle, including restart, CAS, actor spoofing and promotion failure windows. They establish the composed entry contract, not a real provider conversation. No default profile activates this feature.
