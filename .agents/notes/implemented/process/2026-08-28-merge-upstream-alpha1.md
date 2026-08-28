# Agent Note: Merge upstream dsh 0.1.2-alpha.1 into the fork

Status: implemented

English | [中文](2026-08-28-merge-upstream-alpha1.zh.md)

## Problem

The fork was 1,079 commits behind official upstream `dsh-v0.1.2-alpha.1` (`cd5ef81481`). Upstream replaced the browser ApiProxy and client-runtime layers with API Gateway, generated Remotes, and split client services; it also changed the headless entry, application composition, generated catalogs, and package inventory. The fork had 81 conflicting paths because its task queue, capability views, runtime facts, module ring, concise repository rules, and documentation policy occupied the same surfaces.

## Decision

Merge the official tag and adopt its Gateway/Remote browser architecture, package removals, headless task contract, application launcher, UI service split, and generated documentation. Preserve the fork's deliberate features by mounting task-queue and capability Remotes in the new assembly, projecting Skills management through `capabilityRegistry.management`, retaining `shell.view` and `sidebar.modules`, keeping runtime facts and the restricted DSH queue executor, allowing explicit trusted-network Web binding with a warning, and leaving translation pairing outside `doc-sync`.

Generated catalogs and bilingual records are rebuilt from the combined source. The retired ApiProxy, client-runtime, ACP demo, JSON-RPC demo, and ACP snapshot packages are removed with upstream.

## Verification

`pnpm run typecheck` passes. The focused merge suite covers 30 test files and 257 tests: 252 passed initially, one was skipped, and four expected-interface assertions were updated and then passed in isolation. Sixteen affected bilingual pairs pass their named consistency checks.

## Alternatives considered

**Keep the retired ApiProxy and client-runtime packages as compatibility shims.** Rejected because this pre-release fork has no compatibility promise, and parallel browser architectures would duplicate session, transport, and Remote ownership.

**Drop the fork-only UI and queue features.** Rejected because they are deliberate product capabilities; adapting them to the official Remote and renderer services keeps one architecture without discarding the fork's purpose.

## Consequences

The fork now follows the official `0.1.2-alpha.1` architecture and can receive later upstream work from the new merge base. Fork-only features remain explicit in `FORK-DIVERGENCE.md`. Future browser work must use API Gateway generated Remotes and the official client service packages rather than reintroducing ApiProxy or client-runtime.
