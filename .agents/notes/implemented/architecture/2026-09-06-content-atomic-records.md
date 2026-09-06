# Agent Note: Atomic content records and independent drafts

Status: implemented

English | [中文](2026-09-06-content-atomic-records.zh.md)

## Problem

Useful text needs to remain available after its source conversation disappears. Editing that text must not silently replace the original, and a lost response must not turn a retry into a duplicate version. Separate writes for content, revisions and receipts could acknowledge a state that is only partly committed.

## Decision

The personal [content definition](../../../../packages/content/content/README.md) separates immutable versions from an editable draft. The [domain provider](../../../../packages/content/content-domain/README.md) replaces one complete entry aggregate through Storage Domain, including the mutation receipt. A short library-wide command chain compares the latest revisions and accounts for total retained data before writing. It does not schedule agent work or persist another execution lifecycle.

Source capture receives a trusted host resolver rather than accepting verified text from a client payload. The provider checks authorization at admission and again after source preparation, inside the mutation chain. Reads also require authorization. The schema preserves exact text, and the provider verifies body digests on reopen. The service returns independent copies instead of exposing mutable Domain records.

Creation and version operations retain permanent request identities. The bounded recent receipt window supports other changes; requests outside that window still carry expected revisions. Metadata compares the entry revision while draft text compares its own revision and base, preventing unrelated metadata changes from manufacturing text conflicts.

The content domain requires the [storage guarantees](2026-09-06-storage-backend-guarantees.md) but owns no database connection. Its unavailable state is separate from existing Session and storage consumers. Backend ownership and shutdown remain in the storage plugin; recovery must replace both the content provider and its dedicated backend when the connection is suspect.

## Alternatives considered

**Store content in Session history.** Rejected because independent retention, editing and source availability need different ownership. Session remains a source reference, not the content library.

**Write versions, drafts and receipts in separate tables.** Rejected because the current public Domain API does not expose cross-record transactions. One aggregate supplies the required atomic commit without another transaction platform.

**Use last-write-wins text updates.** Rejected because concurrent edits could erase human input. Explicit revision conflicts preserve both the stored text and the caller's unsaved text.

**Record every keystroke as an immutable version.** Rejected because autosave and deliberate version formation have different retention costs. A draft absorbs autosaves until the consumer commits a version.

## Consequences

The definition and provider use the personal package namespace and can evolve without replacing native agent tools. Neither package contributes an agent tool, MCP endpoint, human Remote or UI. Source-bridge and browser workflow acceptance remain separate delivery work.

Whole-domain loading and aggregate replacement limit the initial library size. Configured byte limits reject additional writes without truncating history. Data exceeding a newly lowered limit remains readable and exportable. Physical connection disposal follows the dedicated backend's lifecycle; the content provider closes its Domain handle and stops serving a suspect cache.
