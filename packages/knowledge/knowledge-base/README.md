---
description: "Durable source-grounded knowledge projects for profiles that need editable Markdown, verified artifacts, checks, and explicit publication."
kind: "package-reference"
---

# @changanhua/dsh-knowledge-base

English | [中文](README.zh.md)

## Summary

`dsh-knowledge-base` keeps a source-grounded knowledge project durable while leaving each committed entry editable in its configured content store. It records source snapshots, prepared generation inputs, captured responses, accepted candidates, reviews, checks, immutable releases, and optional SiYuan mappings in Domain-backed records. A later Queue recovery can finish a verified receipt or candidate without calling a model again. Choose it when a profile needs managed content and explicit publication; it does not supply a model tool or schedule work by itself. A file write is complete before the package reports it, but this package does not promise power-loss durability.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this service with a Storage Domain provider and give it an absolute managed content root.

### Minimal configuration

```yaml
- name: '@changanhua/dsh-knowledge-base'
  config:
    root: /absolute/path/to/knowledge-base
```

| Field | Default | Meaning |
|---|---|---|
| `root` | required | Absolute root containing managed projects, source snapshots, version exports, artifacts, reports, and releases. |
| `siyuan` | `false` | Optional trusted SiYuan target. When enabled, use an existing `mcp-client` server by name and configure its notebook, root path, and optional fixed project-root documents. |

The generated [configuration catalog](../../../docs/config-catalog.md) is the exhaustive source for accepted configuration. To make SiYuan the editable library, configure the already-composed MCP client; the service invokes that client's native `mcp__<serverName>__document`, `block`, and `search` tools. It does not install a client or alter a daily-use Profile.

```yaml
- name: '@changanhua/dsh-knowledge-base'
  config:
    root: /absolute/path/to/knowledge-base
    siyuan:
      serverName: siyuan
      notebook: your-notebook-id
      rootPath: /AI 生成知识库
      projectRoots:
        game-vibe: existing-project-document-id
```

### Content and publication

Create a project, ingest or fetch source snapshots through a consumer, confirm its plan hash, and prepare stages for `plan`, `generate`, or `review`. Accepted generation stores an immutable artifact and an editable working entry. When SiYuan is configured, `siyuan-sync` creates the first editable entry documents from a formal release; later generated versions become separately named candidates and never overwrite that original document. `siyuan-inspect` returns the current title, body, and confirmation hash. A user changes the original title or body in SiYuan, then uses `siyuan-adopt` with that hash to accept the edit and invalidate its prior review. Changes to the source-and-conditions section are rejected for adoption. `siyuan-status` reports the durable mapping, and `siyuan-verify` reads the live documents and search index; a version directory is only a reading entry point, not live completion evidence.

`check` compares current managed content, sources, dependencies, recorded review decisions, and configured SiYuan mappings. `publish` only succeeds after the current checks pass, and it creates a versioned immutable release rather than automatically publishing on generation completion. Source snapshots and version exports remain under `root`; the SiYuan mapping records write intent and stable document identifiers. If a dispatched document creation has no matching document on recovery, the service stops at that continuation point for operator reconciliation instead of retrying the create.

Projects under one managed root are shared by sessions in the same trusted Profile. The package does not attach session-private ACLs to a project, entry, artifact, or release.

Release `sources.json` records source metadata and snapshot identities, not full source text. Copying an editable document or a Markdown export to another installation does not restore the Domain record, its prepared stage, Queue work item, or SiYuan mapping.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One Domain project record is the business authority. A stage moves through prepared, publishing, and completed business states while the Queue retains Work and Attempt state separately. `captureResponse` records a completed native response before cleanup, and `recoverStage` validates that receipt or a candidate before it writes a missing entry or replays a completed stage. Files retain source snapshots, exports, and immutable content-addressed artifacts. The optional SiYuan projection holds write intent, stable document IDs, observed baselines, and candidates; it reads before adoption and does not update an existing entry document in place.

| File | Role |
|---|---|
| [`src/repository.ts`](src/repository.ts) | Project operations, stage acceptance and recovery, checks, and publication. |
| [`src/files.ts`](src/files.ts) | Managed Markdown, immutable artifacts, and release file publication. |
| [`src/state.ts`](src/state.ts) | Domain records for projects, stages, candidates, and releases. |
| [`src/siyuan.ts`](src/siyuan.ts) | Optional SiYuan mapping, readback, adoption, and create recovery intent. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge package map](../README.md) — adjacent Queue and tool owners.
- [Knowledge Queue bridge](../knowledge-base-task-queue/README.md) — stage admission, native Codex execution, and unknown-result recovery.
- [Knowledge tool bundle](../tool-knowledge-base/README.md) — user operations and supported profile composition.
- [Storage subsystem](../../../docs/subsystems/storage.md) — Domain persistence provider semantics.

-----

<a id="model-experience"></a>
## Model Experience

### Stored stage input

#### What the model sees

Nothing from this service directly. A Queue consumer later sends the prepared `prompt`, which contains the selected project, source snapshots, prerequisites, and review context; source text is treated as quoted material rather than executable instructions.

#### Token effect

No live-request tokens until a consumer runs a prepared stage. The prepared prompt size grows with selected sources and prerequisite entries.

#### KV Cache effect

The service does not assemble request prefixes. Cache reuse depends on the later consumer's exact prepared prompt and model route.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints define the content and recovery boundary.

- **No power-loss durability claim** — completed managed file writes do not promise directory or device durability across an abrupt power loss.
- **Domain data is required for recovery** — Markdown alone cannot reconstruct stage ownership, candidates, reviews, or Queue state.
- **Publication omits source bodies** — releases retain source metadata and snapshot identities but do not export the full imported text.
- **Model review is not human fact verification** — a passing review checks the recorded response against the available sources and rules; readers still validate consequential claims in practice.
- **Library semantics remain advisory** — checks list exact normalized-body/condition duplicate candidates. Semantic duplicate and contradiction checks report `not_run`; individual source review does not prove their absence.
- **SiYuan creation can require operator reconciliation** — if a dispatched create has no discoverable document after recovery, this version retains the continuation point and does not expose an operator-resolution action.

<a id="dev-note"></a>
### Dev Note

None.
