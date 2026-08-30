# Agent Note: Delivery Queue Bridge owns governed execution and recovery

Status: implemented

English | [中文](2026-08-30-delivery-queue-bridge.zh.md)

## Problem

Personal Delivery persists immutable Packets and cross-store dispatch bindings, while Queue owns Work, Attempt, retry, cancellation, Result, and Attention. The two stores cannot share a transaction. The Bridge must execute Delivery work through Queue without duplicating either state machine, weakening browser authority, or inventing success after a crash or cleanup failure.

The frozen admission helpers already persist `submitting` before ownerless operator enqueue and conditionally bind the returned Work id. The missing runtime boundary was the pair of WorkHandlers, their Attempt-local runner and verifier capabilities, truthful settlement mapping, reversible registration, and restart reconciliation.

## Decision

`@deepseek-ai/dsh-delivery-task-queue` remains the only declaration and registration owner for `code.change@1` and `code.verify@1`. It is a function plugin and publishes no service, executor registry, browser Queue facade, durable cache, or acceptance operation. The broader [Personal Delivery proposal](../../proposed/architecture/2026-08-29-personal-delivery-above-queue.md) continues to own the product topology and remaining Bundle/Profile integration.

Admission resolves strict Protocol records and persists only immutable execution facts. This Bridge owns one Codex provider, and both Config and dispatch admission reject every other executor before a Delivery binding is created. The code-change policy digest covers executor identity, optional model, native permission mode, explicit environment, disposal grace, and model-output limit. Explicit environment entries are non-secret child overrides: only their digest is durable, but low-entropy secrets remain fingerprintable and belong in the runner's authentication mechanism. Queue separately persists the resource claim and retry ceiling. Verification derives its target and plan from the Packet, proves the exact successful bound change and Attempt before Work persistence, and independently proves exact base-to-target ancestry.

Preparation requires the requested Attempt to be the Work's active starting Attempt, cross-checks matching operator `list()` and `get()` views, parses the kind-specific resolved schema, and compares every persisted resolved fact with the prepared admission. It then materializes provider proofs plus operation-local closures. It may inspect revisions and bind evidence provenance, but it does not open a checkout, spawn a process, or publish evidence. Queue owns a thrown preparation as retriable `prepare-threw`; the default one-Attempt policy prevents an automatic repeat. `start()` calls the runner or verifier and synchronously returns its live cancellation and settlement owner.

Runner and verifier success is parsed again at the Bridge with exact Packet, Work, Attempt, target, plan, and verifier identities. Cancellation settles `canceled`. Proven validation and startup failures settle non-retriable `failed/not-started`; quiescent product, completion, workspace-boundary, or execution failures settle non-retriable `failed/started`; ownership, cleanup, unexpected rejection, or malformed successful output settles `unknown/unknown`.

Activation obtains operator authority only inside the trusted Host composition. It registers both handlers behind a closed execution barrier so Queue can find a handler before receipt lookup or new recovery admission. It then validates the Delivery snapshot, cross-checks exact Queue `list()` and `get()` views, and reconciles every `submitting` binding before opening the barrier. Recovery accepts only an exactly reconstructed canonical input and deterministic key, including 40- or 64-hex Git targets. A failed activation rejects blocked preparation before runner or verifier start, and rollback or normal disposal attempts every registered disposer before reporting collected failures. Recovery stores no projection and never creates an acceptance decision.

## Alternatives considered

**Publish a generic executor or Bridge service.** Rejected because one Codex runner and one Delivery consumer do not justify selection, registry, wire, or lifecycle policy. Package-local factories and operation-local closures cover the current use.

**Let the Remote or Config carry operator authority.** Rejected because Queue enqueue, result lookup, and recovery are trusted Host operations. The plugin creates the verified operator facade internally and exposes only the existing narrow admission functions.

**Retry every failure automatically.** Rejected because a started or uncertain execution can have external effects or an owned worktree. The Bridge preserves Queue's side-effect classifications and keeps every mapped failure non-retriable under the default single Attempt.

**Recover from transient Queue events or another Bridge cache.** Rejected because missed events and cache state cannot prove cross-store truth. Activation reconstructs only from durable Delivery records and current Queue views.

## Consequences

Delivery work has one Queue lifecycle and one Delivery binding lifecycle. Handler disposal removes both registrations, restart converges both pre-receipt and post-receipt incomplete handshakes through Queue idempotency, and no runtime path automatically accepts a delivery.

Package tests pin strict resolved facts, policy identity, resources, retry policy, Attempt lookup, side-effect-free preparation, synchronous live ownership, provenance, typed outputs, cancellation, settlement truth, registration disposal, crash-window convergence, malformed views, and absence of automatic acceptance at per-file 100% source coverage.

Bundle/Profile composition and the eight product-level acceptance scenarios remain integration-owned. This decision proves the package behavior and Host activation boundary, not assembled product runtime behavior.
