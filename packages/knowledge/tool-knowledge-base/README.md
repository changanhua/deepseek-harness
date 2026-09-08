---
description: "An installable DSH knowledge-library bundle that adds source, build, check, publish, and recovery operations to the model tool and /knowledge command."
kind: "package-bundle"
---

# @changanhua/dsh-tool-knowledge-base

English | [中文](README.zh.md)

## Summary

`dsh-tool-knowledge-base` adds an editable, source-grounded knowledge-library workflow to a `dsh --profile` surface. Its bundle patch mounts the business repository, native Codex Queue bridge, and `knowledge_base` tool; profiles with commands also receive `/knowledge`. Add this bundle after `dsh-base`, then use explicit create, source, confirm, build, check, publish, SiYuan, and recovery requests. Build never publishes automatically, and generation remains stopped until the human `/knowledge` command or a trusted Host sends `resume-generation`; the model tool rejects that action.

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

Install the bundle into a custom profile whose bundle order places it after `@deepseek-ai/dsh-base`, then launch the profile through `dsh --profile <name>`.

In a built source checkout with a configured Web profile, the supported add-on launch is `pnpm dsh --profile web --patch packages/knowledge/tool-knowledge-base/cordis.patch.yml`. The patch belongs to this launch; it does not edit the saved profile. Use the repository's normal Host build before selecting built artifacts.

### Minimal workflow

Use each JSON object as the `request` string of `knowledge_base`, or append it to `/knowledge`. After `plan`, inspect the returned work until it succeeds, then read `status` and confirm its current `planHash` before building.

```json
{"action":"create","spec":{"id":"game-vibe","title":"Game ideas","readerTask":"plan a prototype","language":"en","seeds":[]}}
{"action":"source","projectId":"game-vibe","sourceId":"brief","title":"Brief","text":"Prototype the core loop."}
{"action":"plan","projectId":"game-vibe"}
{"action":"confirm","projectId":"game-vibe","planHash":"<status planHash>"}
{"action":"build","projectId":"game-vibe"}
{"action":"check","projectId":"game-vibe"}
{"action":"publish","projectId":"game-vibe","version":"v1"}
{"action":"siyuan-sync","projectId":"game-vibe","version":"v1"}
{"action":"siyuan-verify","projectId":"game-vibe"}
{"action":"status","projectId":"game-vibe"}
```

`build.maxRevisions` is 0–3 and defaults to 2; the same configured bound limits format correction for one input. Build stops on an `unknown` work item and never resends it automatically. Use `resume` only after a verified receipt can settle an unknown item; use `retry` only for known `not-started` failures, and `correct` only for known `knowledge-validation` failures. `export-draft` explicitly writes a partial draft without registering a complete release or changing `currentRelease`; `diff` verifies two complete releases before listing added, removed, and changed entry ids. `stop-generation` persists the stop and waits for known active calls to end. Only the human `/knowledge` command and trusted Host request path may send `resume-generation`; a `knowledge_base` tool call receives a rejection.

### SiYuan editing

Configure `knowledge-base.siyuan` and an existing native `mcp-client` server before synchronizing. `siyuan-sync` accepts only a formal published version and creates the first entry documents or separately named update candidates. `siyuan-status` reports mapped document and candidate IDs. Use `siyuan-inspect` to read one editable entry and receive its `snapshotHash`; after a person edits its title or knowledge-body section in SiYuan, use `/knowledge` or a trusted Host with `siyuan-adopt` and that hash. The model-facing tool allows `siyuan-status`, `siyuan-verify`, and `siyuan-inspect`, but rejects `siyuan-sync` and `siyuan-adopt`. Changes to the source-and-conditions section are not adopted. Run `siyuan-verify` when you need live document and search-index evidence; a version directory only links readers to entries.

### Profile Queue override

The bundle patch sets `knowledge-base: 1` and `codex: 1` beside existing Queue capacities. A profile-local `task-queue` config replacement must restate those capacities because a row config is replaced as a whole.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`cordis.patch.yml` is a layer over `dsh-base`. It configures Queue capacities and inserts the repository, Queue bridge, and tool in dependency order. The request executor validates a closed action set before invoking package services; the model-facing executor rejects `resume-generation`, `siyuan-sync`, and `siyuan-adopt`, while the human command and trusted Host use the same business executor for those actions. It does not expose subprocess, credential, or storage configuration to the model.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Bundle layer and default knowledge Queue capacities. |
| [`src/index.ts`](src/index.ts) | Tool, optional command, request validation, and operation dispatch. |
| [`src/build.ts`](src/build.ts) | Bounded dependency-ordered build orchestration. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge package map](../README.md) — the package family.
- [Knowledge business repository](../knowledge-base/README.md) — editable content and publication.
- [Knowledge Queue bridge](../knowledge-base-task-queue/README.md) — native execution and recovery.
- [Base bundle](../../bundle/base/README.md) — profile layering and launch conventions.

-----

<a id="model-experience"></a>
## Model Experience

### Knowledge tool

#### What the model sees

The model sees one `knowledge_base` tool with a JSON request field and descriptions of the supported business actions. It does not see filesystem roots, Queue configuration, credentials, or subprocess controls.

#### Token effect

The tool schema and its action guidance add one tool definition to a request. Build and stage prompts are owned by the repository and Queue packages.

#### KV Cache effect

The tool definition remains stable within a composed profile. Changing its bundle composition or tool set can change the request prefix and cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits keep automation bounded and publication deliberate.

- **No automatic publication** — `build` returns completed or incomplete work; `publish` is always a separate request after `check` passes, while `export-draft` is explicitly partial.
- **Bounded corrections** — `maxRevisions` limits both format correction and review-driven regeneration to 0–3 additional revisions; its default is 2.
- **Unknown work requires explicit recovery** — build will not resend an unknown model side effect.
- **Fetch depends on the profile** — URL fetch and refresh need the optional web service; direct source text does not.
- **SiYuan writes need a trusted caller** — synchronize and adopt are unavailable through the model tool; a configured native MCP client and the human command or trusted Host path are required.

<a id="dev-note"></a>
### Dev Note

None.
