# Agent Note: Work Observatory keeps human activity evidence separate from agent step time

Status: implemented

English | [中文](2026-08-22-work-observatory-accounting.zh.md)

## Problem

DSH needs durable collaboration metrics without treating an open browser tab as proof of human activity, double-counting concurrent agent work, or adding operational telemetry to the model-visible Session log.

## Decision

Work Observatory owns an independent SQLite accounting store. The browser package `@deepseek-ai/dsh-client-ui-work-observatory` installs a main-document, app-scope activity producer from its Client plugin `apply()`; it reports typed visibility and recent-interaction snapshots through the BFF Remote and never imports Host runtime code. Each document lifecycle has an in-memory client identity and monotonic sequence, with immediate state transitions, local 60-second idle expiry, and visible 15-second heartbeats.

The Host timestamps accepted observations, rejects invalid or out-of-order state, and derives Human Active and Page Visible intervals from received evidence. Agent Running is projected from canonical serial step brackets, and range results use normalized half-open interval algebra for Human Active, Page Visible, Agent Running, Together, and Agent Solo. The Client package registers the headless app-scope tracker and a read-only Work Observatory settings section that renders the five metrics and three normalized timelines from one Host range; the tracker stays independent of the section lifecycle.

## Alternatives considered

**Measure page-open to unload time.** Rejected because background, abandoned, and crashed tabs do not prove human activity.

**Mount the tracker inside the Observatory Settings page.** Rejected because that would measure dashboard viewing instead of work across the main DSH application.

**Use browser timestamps or sum agent component durations.** Rejected because browser clocks are not the Host accounting clock and concurrent or nested work would double-count wall time.

**Append browser activity to the Session log.** Rejected because the data is operational telemetry, not model-visible conversation truth.

## Consequences

The design is conservative: a vanished browser contributes only through its last accepted evidence, and a single Host unions all browser document instances for the V1 user. The package has no durable outbox, cross-tab identity, user or tenant attribution, or productivity interpretation. Those limits preserve a small auditable accounting core and leave later attribution decisions independent.
