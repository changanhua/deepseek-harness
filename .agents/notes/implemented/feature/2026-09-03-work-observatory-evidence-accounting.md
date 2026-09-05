# Agent Note: Work Observatory evidence accounting

Status: implemented

English | [中文](2026-09-03-work-observatory-evidence-accounting.zh.md)

## Problem

The Web product needs a user-facing way to inspect when a person and one or more Agent Sessions were active without turning weak local signals into productivity claims. Browser clocks are not authoritative, several tabs and Sessions can overlap, Session execution has durable step boundaries rather than CPU accounting, and the storage subsystem already owns backend portability and lifecycle. A trustworthy view must state these limits in both its data model and its UI.

## Decision

Work Observatory is a dedicated Web workspace backed by a Host service. The browser sends state and a monotonic document sequence but no timestamp; the Host stamps accepted observations. Human activity means visible, focused, and recently interacted with. Agent activity means open Session-step wall-clock time. Page-visible, human-active, and Agent-step intervals are normalized independently; overlap and Agent-solo values derive from those normalized sets. Multiple tabs and Sessions never multiply one wall-clock instant in headline totals.

The Host persists a versioned per-record `work_observatory` domain through `ctx.storageDomain`. Transition rows, latest browser state, and Session-step rows have separate tables. Unchanged heartbeats only extend the latest Host evidence, record keys are path-safe hashes, retention and query size are bounded, and shutting down waits for queued writes before closing the domain. The Client owns one document-scoped tracker, serializes Remote writes, resets human activity when hidden, and disposes listeners and timers with its plugin fiber.

The workspace lets the user select a local day, follows the current Session's canonical project path when present, shows source intervals before totals, and opens contributing Sessions. Its explanatory copy explicitly rejects productivity and time-saved interpretations.

## Alternatives considered

**Reuse the previous direct-SQLite implementation.** That branch predates the current storage-domain contract and package composition. Reusing its product semantics is sound; copying its persistence path would bypass current ownership, backend portability, and shutdown rules.

**Place the view in Settings.** The view is an everyday work surface with date navigation and Session drilldown, not configuration. A dedicated sidebar workspace keeps it discoverable without mixing evidence with preferences.

**Report productivity or saved time.** Visible-page state and open-step wall time cannot establish output quality, causal effort, or counterfactual savings. The product reports evidence intervals only.

**Couple Queue, Delivery, and Skill data into the first package.** Those domains have separate lifecycles and semantics. Optional bridge packages may add explicit facts later; the base accounting remains useful and testable without them.

## Consequences

The first vertical gives a local deployment durable, inspectable human/Agent wall-clock evidence with one Host authority and one interval algebra. It does not observe activity outside the Web document, extrapolate across missing heartbeats, aggregate Hosts, or attribute a duration to a Skill. Agent time can include Provider, Tool, subagent, and human-wait intervals inside an open step. These negative guarantees remain part of the contract for future Queue, Delivery, Skill, or telemetry bridges.
