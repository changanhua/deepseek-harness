# Agent Note: Source-backed project memory records

Status: implemented

English | [中文](2026-09-08-project-memory-v1.zh.md)

## Problem

Session retrieval preserves what was said, but a reusable project claim also needs explicit acceptance, provenance, revisions, and conditions that prevent stale reuse. Treating an agent's summary as current truth loses those distinctions and lets obsolete instructions accumulate across sessions.

## Decision

The memory Definition separates candidates, human decisions, and derived source eligibility. The local provider binds records to the existing Workspace identity, captures source fingerprints itself, and persists a record with its idempotency receipt in one Storage Domain update. Immutable content revisions do not contain a mutable acceptance deadline; each human acceptance owns its review date.

Recall excludes pending, withdrawn, overdue, conflicting, changed-source, and unavailable-source claims. An unavailable source does not prove the claim false. File sources use the Agent's filesystem capability, while Session sources use physically stored events rather than live-only or synthetic recovery facts. Memory text never grants tool authority or replaces current user instructions.

## Consequences

The local domain has one Host writer, protected by an exclusive ownership file. Existing locks are never automatically removed. Normal teardown drains writes before releasing ownership; crash recovery requires checking the former process before removing its exact lock. This trades unattended recovery for a bounded first implementation without cross-process CAS or automatic ownership transfer.

## Alternatives considered

Session history alone cannot express accepted knowledge or current source eligibility. External memory servers remain independently useful through the [generic MCP examples](2026-07-31-third-party-memory-mcp-examples.md), but their vendor contracts do not own DSH Workspace authorization and native human command decisions. The two capabilities retain separate state ownership.

A vector database or automatic consolidation does not close the source-validity or authority boundary. Lexical ranking and explicit topic conflicts provide a measurable baseline without introducing another durable truth store.

## Verification

Package tests exercise the real Storage Domain with JSON and SQLite reopen, concurrent version fences, failed writes, and idempotent recovery. Source tests use real file reads, Windows junction containment, and JSONL persisted events. A separate process exercises owner exclusion; service tests cover candidate isolation, exact human command binding, fresh-session reads, source changes, and conflicting claims. These checks do not establish a shipped Profile, real model use, or browser acceptance; those observations are required separately before claiming the complete user workflow.

## Further Exploration

- [Project Memory subsystem](../../../../docs/subsystems/project-memory.md) owns record and operation semantics.
- [Local provider](../../../../packages/memory/memory-local/README.md) owns configuration and lifecycle constraints.
- [Storage domain implementation](../../../../packages/storage/storage-domain/src/domain.ts) owns atomic per-record updates.
