# Agent Note: Trusted Eval sources, Attempt workspaces and resource budgets

Status: implemented

English | [中文](2026-10-02-trusted-eval-producers-and-resource-budgets.zh.md)

## Problem

Parsed evaluation intent cannot prove who approved a budget exemption, which repository revision actually exists, or whether another model request is affordable. These facts have different owners. Combining them in caller JSON permits self-certification; adding another scheduler or Git lifecycle would duplicate existing ownership without improving the evidence.

## Decision

The project Plan provider accepts complete Host-approved content identities under trusted roots. Workspace access uses the live registry object and a Host authorization callback. Discovery is path-free. Resolution checks current availability and content identity, then admission revalidates an owner-issued immutable resolution before committing an idempotent run identity. It does not execute a subject, grader or verifier.

The Eval workspace bridge obtains a provider-minted full revision and opens the existing RepositoryWorkspace lease under the actual Queue Attempt id. Preparation copies bounded fixture blobs from that exact commit. Known quiescent completion removes the checkout; uncertainty preserves it and produces Queue unknown Attention. An exclusive preparation marker refuses reuse of an uncertain directory after restart. The bridge owns neither Git state transitions nor a replacement Queue.

Budget owns one versioned durable ledger for scopes, reservations, decisions, actual usage and unknown outcomes. Parent scopes constrain children. The final LLM adapter-dispatch boundary covers direct and prepared calls, with a durable claim and live recheck before invocation. Unknown usage holds its reservation. A storage failure closes admission; capacity reserves room for terminal evidence before a call begins.

Interactive exceptions use the existing approval service and are bound to one request/attempt and its exhausted ask scopes. They cannot bypass denying ancestors or transfer unused allowance to another request. Session and Goal identity come from live owners; Workflow children share a run scope and retain their Session binding. Human commands can configure and revoke scopes or reconcile unknown usage. Automatic Activation and independent evaluation decisions remain separate consumers.

Storage Domain checks declared backend guarantees before opening a medium. This enforces the guarantees already expressed by durable owners instead of treating a declaration as proof. The shared base profile routes its JSON backend and Domain through the same realm used by its projection cache; optional private ledgers add named backend routes.

## Alternatives considered

**Trust a parsed Plan or a contained project file.** Rejected because containment identifies a location, while Host approval identifies the complete allowed content, including credential bindings and exemptions.

**Enforce budgets only in Agent middleware or a selected adapter.** Rejected because direct calls, prepared calls and retry paths must share the final dispatch decision. The LLM runtime owns the final guard; resource policy stays in the budget owner.

**Release uncertain reservations or retry an interrupted question.** Rejected because missing usage is not zero usage and interrupted approval is not consent. Durable uncertainty requires reconciliation or another explicit authorized attempt.

**Replace RepositoryWorkspace, Queue capacity or Token Meter.** Rejected because checkout ownership, scheduling capacity and measured usage already have owners. The new consumers add user policy and connect evidence without duplicating those mechanisms.

## Consequences

Host configuration, owner-private synchronous storage and scoped bindings are explicit deployment requirements. Input estimates are labeled, image requests without trustworthy bounds are refused, immutable scopes cannot be silently enlarged, and retained history has finite configured capacity. Tool preflight checks its registered contract rather than claiming implementation-byte attestation. Full execution, verifier trust, automatic Activation and remote-provider accounting remain outside these producers.

The [Eval contract decision](2026-08-31-deterministic-eval-contract-and-snapshot-adapter.md) and [background-job decision](2026-06-20-generic-long-running-tool-runtime.md) remain active: their replay/evidence and lifecycle/capacity responsibilities are not superseded. No existing decision record is archived by this change. The [Eval reference](../../../../docs/subsystems/eval.md), [Budget reference](../../../../docs/subsystems/budget.md) and [configuration guide](../../../../docs/cookbook/trusted-eval-and-budget.md) own current usage details.
