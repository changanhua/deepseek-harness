# Agent Note: Planning Review feedback without activation

Status: implemented

English | [中文](2026-10-02-planning-review-feedback.zh.md)

## Problem

Execution outcomes can expose useful improvements, but generating a Candidate for every outcome creates work without selection. Retrying an uncertain cross-owner write can also create duplicate hypotheses.

## Decision

The [Review consumer](../../../../packages/initiative/tool-initiative-review/README.md) reads one selected Planning Review in an explicitly started restricted Session. It persists create, enrich and no-op decisions. Review facts remain unverified; they do not inherit Trusted Eval authority. Candidate writes reuse the [existing Candidate owner](2026-10-02-initiative-candidate-core.md), whose ownership and promotion rationale remain independently applicable.

The consumer records a frozen intent before a Candidate write. Recovery uses the original Session and key because Candidate receipts bind the actor; completed outcomes can be read from another authorized Session. Definite CAS conflicts permit a fresh decision, while uncertain outcomes cannot be overwritten. Capability restrictions are enforced by the Tool executor and rechecked at decision commits.

Freshness follows the actual comparison basis rather than the Review alone: referenced Planning heads and the complete Candidate set can change a no-op or create decision. Owner-side Candidate checks prevent a bridge-only check from racing its write. Receipt replay must precede these checks because an acknowledged write is recovery, not a new decision; a stale uncommitted intent instead becomes conflict so it cannot pin the Review forever. The consumer uses optimistic admission rather than cross-owner transaction locks, retaining the local ownership and recovery boundaries.

## Alternatives considered

**Generic Signal and Observer services** add lifecycle and scheduling contracts before a single feedback source proves useful. The bridge uses the existing Review contract and owns only its consumption result.

**Always generating a Candidate** rewards activity rather than selection. Durable no-op preserves why nothing happened and prevents retries from becoming fresh proposals.

**Replaying as a replacement Agent** conflicts with actor-bound Candidate receipts. Requiring the original authorized Session avoids forged identity or broadening Candidate authority for recovery convenience.

## Consequences

Feedback does not alter Planning or activate execution. An orphaned prepared decision requires the original Session to resume; the consumer neither wakes it nor transfers ownership. Context identities cover referenced follow-up heads and Candidate comparisons. A changed comparison requires a new read; an already committed result remains stable. Loader tests cover restart, lost acknowledgement, CAS and denied capabilities; the bounded real-provider fixture assesses decision behavior on supplied isolated scenarios, not production frequency or long-term selection quality.
