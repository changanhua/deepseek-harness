# Agent Note: Eval recovery, independent decisions and explicit continuation

Status: implemented

English | [中文](2026-10-03-eval-recovery-decisions-and-continuation.zh.md)

## Problem

A successful Subject result cannot prove an independent decision or authorize another Goal round. Process loss can separate Queue commit, evidence handoff, decision retention and message delivery. Reconstructing those boundaries from Agent narration or replaying their side effects loses both authority and idempotency.

## Decision

EvalRuns retains coordination intent and acknowledged private materials while Queue remains the sole Attempt owner. Historical Plan recovery returns original source facts without minting new execution authority. Conditional Queue controls compare the observed status, attempt count and active Attempt inside the mutation transaction. Unknown execution uses a new explicitly authorized Attempt and fresh world rather than reusing an uncertain directory.

EvalGates reads original materials through a Host-only capability. A separately launched, fixed checker recomputes supported criteria from actual output. Its persistent Session, complete pinned core, approved build provenance, Profile, configuration and exact report are retained with the decision. Verifier build provenance never substitutes the Subject repository commit. Concurrent evaluations serialize; a repeated decision does not dispatch another checker. Historical decisions and current validity are separate so expiry preserves history without authorizing new action.

EvalActivation reserves a single-use Grant before resuming the target Session. Host composition fixes the target, Goal revision, Budget and message; public callers cannot invent Queue terminal facts. The Host rechecks current Gate validity, terminal Attempt, workspace membership, budget ancestry and authorization immediately before delivery. Only an exact durable Goal message receipt proves consumption. A restart at an uncertain resume or delivery boundary produces needs-attention rather than a resend.

The local continuation provider owns one round in a dedicated Profile without the automatic Goal round driver. It reuses the canonical Goal prompt renderer without mounting that driver. The original Agent loop, Goal service, Session persistence and Budget remain authoritative. Cold handles belong to the continuation operation and are released after quiescence.

Continuation serialization follows the target Session rather than the Grant id, because independent Grants can target the same mutable Goal. Authorization is asynchronous, so expiry, Goal state and Agent idleness are checked again at delivery. Owner disposal aborts its in-flight round and drains it before releasing persistence. A retained pass also revalidates its exact original verifier material; a decision label alone cannot survive missing or contradictory evidence.

## Alternatives considered

**Treat a safe report or passing Agent output as authority.** Rejected because safe projections omit private evidence, exact attempts and receipt integrity. They are suitable for display, not authorization.

**Replay an unknown operation until it succeeds.** Rejected because a lost acknowledgement does not prove absence of a model dispatch or Goal message. Recovery reads committed owners; uncertain effects need explicit reconciliation.

**Share an automatic Goal driver without a reservation contract.** Deferred because two independent owners can dispatch the same next round. The exclusive Profile is an explicit current deployment boundary, not support for every existing Host.

## Consequences

The [CLI flow](../../../../packages/eval/eval-app/README.md) requires explicit Host composition and private synchronous storage. Its built-Profile tests cover isolated Subject/Grader execution, a separate checker, cold Session continuation, persisted receipts, duplicate requests and budget revocation with both deterministic and real DeepSeek Flash/Pro adapters. The live case confirms five settled model requests and one durable Goal message; it does not establish task-quality baselines, Web usability, filesystem quotas or certification of arbitrary modified Harness cores.

The [trusted producer decision](2026-10-02-trusted-eval-producers-and-resource-budgets.md), [isolated core decision](2026-10-03-pinned-core-isolated-eval.md) and [Eval contract decision](2026-08-31-deterministic-eval-contract-and-snapshot-adapter.md) remain active. Their admission, isolation and pure-value responsibilities are unchanged; this decision owns recovery and the connection between decisions and explicit continuation. No existing note is fully superseded.
