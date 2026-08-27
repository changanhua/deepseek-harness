# Agent Note: Queue v2 image canary

Status: implemented

English | [中文](2026-08-26-queue-v2-image-canary.zh.md)

## Problem

The durable task queue combined generic worker routing, lifecycle state, provider discovery, and result files in one `Task` record. It could not preserve a typed image request's resolved Agent Plan facts before the generation side effect, nor safely give image bytes an attempt-owned durable identity.

## Decision

Queue v2 stores immutable `WorkItem` intent and resolved facts, event-derived state, and atomic `ChangeSet` records under an isolated schema-versioned root. The local provider serializes only durable mutations, while `WorkHandler.resolveAdmission()` and `prepare()` remain outside that FIFO. Handlers declare resources; local configuration supplies capacity. A live handler returns synchronous ownership at `start()`. The [Queue v2 ownership decision](2026-08-27-queue-v2-reuse-boundaries.md) assigns durable image bytes to `ctx.attachments`, not a Queue-owned artifact writer.

`image.generate@1` resolves the image provider, model, output settings, and prompt during admission. Its start phase consumes those stored facts through `ctx.imageGeneration`, saves returned images through `ctx.attachments`, and persists `ImageAttachmentRef` values in the typed result. The single and Batch image admission tools mint Agent authority from the live Session and cannot choose Queue execution internals.

The shipped composition stores the current record format under `$DSH_HOME/task-queue-v3` with manifest schema 3. An incompatible record change uses a new manifest version and root directory; the provider preserves and rejects earlier roots instead of inferring missing durable facts.

## Alternatives considered

**Keep images behind the generic DSH executor.** Rejected because provider discovery and image-specific result attribution would occur inside an opaque worker run, leaving no durable resolved facts or attempt-owned image references.

**Let a handler choose its own concurrency.** Rejected because simultaneous handlers cannot make a deployment-wide capacity decision; the handler declares demand and the local provider owns admission to available capacity.

**Write generated files directly into an output directory.** Rejected because a terminal result could point at unvalidated host paths instead of authorized, content-addressed Attachment references.

## Consequences

The canary adds a separate WorkKind package, a local durable store, and image admission tools. The image handler remains a typed WorkKind rather than a generic executor payload; generic Queue tools and owner delivery remain WorkKind-independent.

## Testing

Focused tests cover ChangeSet folding, snapshot tail recovery, manifest-version rejection, composed root selection, root ownership, handler execution, Attachment-backed result persistence, image handler resolve/start behavior, and ten-item Batch concurrency.
