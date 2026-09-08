# Agent Note: Knowledge libraries with native Codex execution

Status: implemented

English | [中文](2026-09-08-knowledge-base-native-codex.zh.md)

## Problem

A generated knowledge library needs editable content, attributable sources, reproducible checks and resumable execution. A model response can exist before its process is cleaned up or its files are committed. Treating every interruption as a retry risks repeating paid work; treating Markdown as execution history loses the distinction between a returned result and an unknown outcome.

## Decision

The personal [knowledge package family](../../../../packages/knowledge/README.md) separates business records, typed Queue execution and user operations. The knowledge Domain owns approved specifications, immutable source versions, stage inputs, captured responses and release records. Queue owns Work/Attempt state. Source snapshots, version exports, and immutable artifacts retain execution evidence. An optional SiYuan projection owns editable document mappings, observed baselines, and create intents. A Profile bundle composes these services over existing storage and subprocess capabilities.

Stages freeze the prompt and input identity before admission. The Queue bridge binds the Work before invoking the existing native Codex App Server adapter. It captures a returned response before cleanup, then accepts content only after cleanup completes. An explicit recovery operation verifies the captured response or publishing candidate; it does not manufacture a response for an unknown remote call. Native inherited model identity and usage remain unknown when the adapter does not expose them.

Generation is serialized through declared Queue resources. A persistent stop record prevents new calls after a quota failure and survives restart. Format correction uses a new input tied to the rejected response; finite build limits prevent correction and review loops from running indefinitely. Unknown results require an explicit operator decision.

Formal publication requires current passing required coverage and reviews. Each release has a manifest covering content and metadata files. Source exports contain provenance metadata; quoted excerpts remain with their entries. Partial drafts are explicit and cannot become the current formal release. The Domain is authoritative for the current release; opening the repository reconstructs its file projection after a publication interruption. Rollback verifies a released version and changes its selection without replacing the editable workspace.

When SiYuan is configured through an existing native MCP client, synchronization creates the initial editable entry documents from a formal release. Later generated content is stored as a separately named candidate and never overwrites an existing entry document. A person inspects a title/body snapshot before adoption; adoption records the accepted content and invalidates its review. Source and applicable-condition sections remain source-controlled and reject adoption changes. Create intent is durable before dispatch. A missing document after a dispatched create remains an unknown continuation for operator reconciliation; this version has no operator-resolution action.

## Alternatives considered

**A standalone knowledge CLI and file scheduler.** This would duplicate supported application startup, Queue attempts, storage ownership and process cleanup. The feature uses DSH tools and commands instead.

**Automatic retries for every interrupted call.** The native adapter exposes a fresh one-shot turn, not a durable remote result lookup. An unknown call cannot safely be treated as a known failure; locally captured responses and explicit operator resolution preserve this distinction.

**Rewriting working files during rollback.** This would discard user changes made after publication. Immutable release selection keeps historical reading separate from current editing.

**Using SiYuan as an untracked render target.** This would leave human edits outside the project evidence and allow a later generated write to overwrite them. The projection records stable document identity and accepts an inspected edit through the same project record.

## Consequences

The split preserves editable content and execution evidence without a second writable task ledger. Backups must include source snapshots, exports, the corresponding Domain/Queue data, and any SiYuan mapping record. File publication and SiYuan projection provide no cross-store transaction or power-loss durability guarantee. Source location checks and model review do not prove domain completeness or replace reader verification. The first configured content focuses on AI-assisted game development; a smaller photography example exercises the same contracts.
