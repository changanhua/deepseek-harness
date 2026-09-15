---
description: "Local source-backed project memory with durable revisions, human command authorization, and bounded recall."
kind: "package-reference"
---

# @changanhua/dsh-memory-local

English | [中文](README.zh.md)

## Summary

This provider preserves project memory across sessions and storage reopen, with candidate, acceptance, revision, and retirement history. It checks current file bytes or physically persisted Session events before exposing accepted claims. Conflicting claims and unavailable or overdue sources are withheld from ordinary recall.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the provider after Storage Domain, Workspace Registry, Session Store and persistence, Session Query, and the filesystem. A live caller Session must belong to a registered canonical Workspace; an unregistered directory never falls back to global memory. Files use the Agent's filesystem execution world, not a host-file bypass.

| Field | Default | Meaning |
| --- | --- | --- |
| `ownershipRoot` | required | Absolute local lock directory shared by compositions targeting the same memory store |
| `reviewAfterDays` | 30 | Default period until an accepted revision requires human review |
| `maxRecordsPerWorkspace` | 500 | Project record cap |
| `maxRevisions` | 50 | Immutable content versions per record |
| `maxReceipts` | 200 | Committed mutations per record |
| `maxSourceBytes` | 1048576 | Bytes from one source |
| `maxOutputBytes` | 16384 | Complete model-facing service result bytes |
| `maxSearchResults` | 5 | Checked usable hits per query |

Claims have at most 2,000 Unicode characters and five sources. Record, revision, receipt, source-byte, and output-byte limits may be lowered, not raised beyond their schema ceilings. Full stores reject writes without evicting existing data. Human inspection returns detached domain records; the Command consumer must separately bound the final presentation.

One owner lock protects `project_memory`, which uses the existing Storage Domain backend route. An existing lock refuses startup. After a crash, verify that the previous Host has exited before removing the exact `owner.lock`; never delete the memory domain as a recovery step. Unload drains admitted operations and closes persistence before releasing the matching ownership token.

<a id="understand-the-implementation"></a>
## Understand the implementation

[Store mutations](src/store.ts) commit one record with its receipt through atomic domain updates. [Scope checks](src/scope.ts) derive Workspace identity and require the exact active human `command/run` for decisions and history inspection. [Source reads](src/sources.ts) bind complete file bytes or physical Session text to SHA-256; changed or unavailable observations do not rewrite the captured fingerprint. [Ranking](src/search.ts) uses normalized Latin words and Chinese bigrams, with explicit topic conflicts.

Acceptance review dates live in immutable decision records, so re-confirming an unchanged claim does not rewrite its content revision. Retiring a memory preserves its history. Unavailable reads return reasons and source locators without the old claim body or source previews.

Reads recheck the live Session, record version, deadline, and topic conflicts after source IO. Searches also fence the complete project record snapshot before returning earlier hits. A changed snapshot permits one retry; continued changes return `concurrent-change`. Cancellation during source checks admits no mutation. A dispatched atomic write is drained to a definite outcome; its committed receipt survives cancellation or a lost acknowledgment.

<a id="model-experience"></a>
## Model Experience

None, as this provider registers no tools, prompts, or model requests and its Consumers own those effects.

#### KV Cache effect

None, because memory operations do not change request prefixes directly.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The provider requires one Host per memory store. Locks are not automatically stolen, including after a crash; network-shared roots are unsupported.
- Lexical ranking and identical-topic conflict groups do not detect arbitrary semantic relationships or contradictions. Natural-language applicability conditions remain explanatory text.
- Source checks describe the observed instant, not a transaction with later code execution. File restoration to identical bytes can restore eligibility while the review deadline remains unchanged.
- Withdrawal stops ordinary reuse but does not erase domain history or Session logs. Automatic extraction, external sources, and cross-Workspace sharing are absent.

<a id="dev-note"></a>
### Dev Note

None.
