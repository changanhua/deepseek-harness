# Agent Note: Delivery local records use one Storage Domain

Status: implemented

English | [中文](2026-08-30-delivery-local-storage-domain.zh.md)

## Problem

Personal Delivery needs immutable Contract revisions, Work Packets, Queue dispatch bindings, and human decisions to survive host restarts. Keeping only an in-memory projection would lose the authority needed to reconcile an unfinished Queue admission, while storing Queue Work, Attempt, or evidence bytes beside Delivery records would create a second owner for those facts.

The Service Definition also promises operation-wide idempotency. A durable provider must return the original result for an exact replay, reject the same key with another operation or request, and serialize concurrent calls before either allocates a different durable identity.

## Decision

`delivery-local` opens one private Storage Domain named `personal_delivery` at format version 1. Its four tables store schema-validated `ContractRevision`, `WorkPacket`, `DispatchBinding`, and `AcceptanceDecision` objects. Synchronous reads and snapshots project directly from the opened domain, and every write becomes visible only after Storage Domain commits it.

The provider keeps Queue Work and Attempt state, Git checkouts, verification execution, and evidence bytes outside this domain. This realizes the local persistence part of the broader [Personal Delivery architecture](../../proposed/architecture/2026-08-29-personal-delivery-above-queue.md) without changing the frozen Protocol or its three Service Definitions.

### Durable idempotency

Each idempotent record key contains a SHA-256 identity of the caller key, operation name, and complete request digest. Before a write, the provider scans every owned table for the caller-key prefix. An exact operation and digest returns the stored object; any other use rejects with `idempotency-conflict` before invoking a repository, Queue, or evidence resolver.

An in-process tail serializes calls sharing one idempotency key. Storage Domain serializes the durable writes themselves. A rejected write changes neither the in-memory projection nor the backing medium, so a retry can run the operation again with the same key.

### Acceptance commit boundary

Decision recording resolves the exact bound change and verification Queue Work identities, validates their Attempt facts, completion claim, verification intent, verdict, Packet plan, base, and target, then integrity-reads every referenced evidence object. Only after those checks succeed does the provider persist the human-authored decision. A rejection or waiver still needs the exact Queue candidate but does not claim that failed evidence passed.

## Alternatives considered

**Persist a second Delivery lifecycle state machine.** Rejected because Queue already owns Work and Attempt lifecycle. Delivery stores only its immutable records and the submitting/bound cross-store handshake.

**Use random record ids without durable idempotency metadata.** Rejected because a restart after an ambiguous response could create another Contract, Packet, binding, or decision for the same request.

**Store idempotency rows in a fifth custom-schema table.** Rejected because every durable table value should use the frozen Protocol schemas. Encoding the key, operation, and request digest in each result record's storage key preserves replay detection without widening Protocol or adding another record type.

**Trust a passed verdict without rereading evidence.** Rejected because a verdict is a claim about evidence integrity, not the immutable bytes or metadata themselves. Ordinary acceptance resolves every referenced evidence id through the host-owned integrity-reading capability.

## Testing

Focused tests mount the real Storage hub and Domain Facility over a persistent in-memory medium. They cover restart recovery, concurrent and cross-operation idempotency, source lineage, Contract readiness, Contract-field and bounded Git-blob plan resolution, submitting-to-bound Queue handshakes, acceptance authority mismatches, evidence provenance and integrity failures, and the package-owned durable-projection invariant. Per-file coverage is 100% for statements, branches, functions, and lines.

## Consequences

Delivery records remain restart-stable without borrowing Queue or evidence authority. The storage-key format becomes part of the private version-1 medium even though callers only observe Protocol ids. A future format change requires an explicit Storage Domain version decision rather than silently accepting old media.

The provider is a single-process owner. Storage Domain notifications do not synchronize another host process, and immutable records have no automatic retention; backend selection must account for exclusive ownership and continued history growth.
