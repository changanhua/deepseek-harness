# Agent Note: Durable side-effect admission

Status: implemented

English | [中文](2026-09-30-side-effect-safety-kernel.zh.md)

## Problem

A plan approval and a successful transport request cannot prove that a particular external effect is authorized or completed. Restart must preserve uncertainty instead of repeating an action whose outcome is unknown.

## Decision

The [guard package](../../../../packages/guard/side-effect-safety/README.md) combines one Host service and one Storage Domain consumer. Existing guard packages remain unchanged. A lifecycle-bound adapter is the authority for human identity, domain scope and evidence verification; only its private sender crosses the synthetic execution boundary. No model tool or Remote mutator exports this authority.

One bounded global document makes intent, business lease, budget consumption and action phase atomic under one Host writer. Serialized CAS prevents races within that writer. Deployment must not share JSON storage between live Hosts; SQLite exclusive ownership is the existing option when a protected shared root is required. Business leases do not replace storage writer exclusion.

SENT records possible execution before invoking the sender. UNKNOWN never becomes executable. Restart invalidates process capabilities and business leases, preserves all prior action identities, and requires lookup-only evidence reconciliation. Idempotent retries return the current ledger fact, while conflicting content durably blocks new work. Budgets count attempted risk without refunds, and one approval cannot fund multiple executions.

Dynamic Cordis has no raw Storage, Storage Domain, or backend capability. The runner rejects registered aliases, prevents reflection from returning raw service objects, and detaches domain-change event snapshots. Static Host consumers retain storage access; dynamic packages retain business-service APIs and package-private harness state. This is an explicit capability boundary, not a claim that node:vm contains hostile code.

## Alternatives considered

A second generic provider package would add an unused replacement boundary: Storage Domain already owns media abstraction. Reimplementing BrowserTask journal or migrating Delivery would change independent owners outside the generic admission slice. Treating allowed-once as durable authority would confuse interaction outcome with bounded business authorization. Persisting domain payloads would make accidental recovery replay possible and duplicate adapter-owned data.

## Consequences

Atomic snapshots simplify crash reasoning but impose strict retained-record and byte limits. Exhaustion stops work; there is no eviction of uncertain actions. Trusted Host adapters still own actual human confirmation and readback truth. The synthetic Loader and process-loss tests prove kernel behavior; they do not prove any production browser integration or domain adapter. Conservative budgets may stop earlier than actual resource usage would require. A failed terminal write remains uncertain rather than advertising a success that did not commit.
