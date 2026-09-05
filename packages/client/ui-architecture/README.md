---
description: "Explore the complete build-time DSH workspace package catalog, dependency direction, and current Loader activation from one full-page Web workspace."
kind: "package-reference"
---

# @changanhua/dsh-client-ui-architecture

English | [中文](README.zh.md)

## Summary

The Architecture workspace lets developers browse every formal DSH workspace package without treating source presence as runtime activation. It separates the generated build catalog from the current Loader snapshot, then joins exact package names to show which catalog packages are composed. Search, group filters, dependency links, reverse consumers, and package descriptions keep the complete catalog usable on one page.

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

The shipped Web bundle mounts the package as the Architecture entry in the first-level sidebar module list. Opening the entry keeps the ordinary conversation mounted underneath while the center column displays the full workspace.

The committed catalog is generated from `packages/*/*/package.json`; `pnpm run verify-architecture-catalog` rejects a stale result. The Runtime refresh calls `pluginInventory/list` and displays only the point-in-time Loader state that the Host confirms.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The generator records package descriptions, groups, explicit browser/bundle/Remote/tool faces, and canonical in-repo `peerDependencies`. The Client plugin registers one `sidebar.modules` entry and one `shell.view` entry. An apply-private controller keeps the Loader response outside React; the Slot renderer binds its observable through the injected `useRuntime` selector hook.

| File | Role |
| --- | --- |
| [`src/client/ArchitectureWorkspace.tsx`](src/client/ArchitectureWorkspace.tsx) | Full-page package field, filters, dependency navigation, and evidence detail |
| [`src/client/runtime-controller.ts`](src/client/runtime-controller.ts) | Point-in-time `pluginInventory/list` load and stale-response rejection |
| [`src/client/catalog.generated.ts`](src/client/catalog.generated.ts) | Deterministic build catalog; generated, never edited by hand |
| [`../../../scripts/gen-architecture-catalog.ts`](../../../scripts/gen-architecture-catalog.ts) | Catalog writer and freshness check |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Architecture](../../../docs/architecture.md) — composition, runtime domains, and extension points.
- [Module dependency graph](../../../docs/module-graph.md) — generated exhaustive `peerDependencies` graph.
- [Web Client architecture](../../../docs/subsystems/web-client.md) — module loading, Slots, and Host projections.
- [Plugin inventory](../../host/plugin-inventory/README.md) — authority for the current Loader snapshot.
- [Architecture Explorer decision](../../../.agents/notes/implemented/feature/2026-08-29-architecture-explorer.md) — evidence separation and alternatives.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package is a read-only Client presentation and registers no model-facing Tool, prompt section, or Session event.

#### KV Cache effect

None; catalog generation happens during development and Runtime refresh reads a Host projection without starting a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The view states only what its two evidence owners can prove.

- **Build identity, not live source** — the catalog represents the checkout used to build `lib/client.js`; editing manifests without regenerating and rebuilding cannot change an already running page.
- **Runtime snapshot, not provenance** — Loader entries show enablement and Fiber phase but do not identify which Profile, bundle, or patch layer introduced them.
- **Manifest dependency graph** — dependency and consumer links use in-repo `peerDependencies`; they do not claim to enumerate source imports or Cordis service injection.
- **Manual Runtime refresh** — the Host exposes no plugin-inventory subscription, so an open page refreshes only on user request or plugin reload.
- **Workspace packages only** — external plugins can contribute Loader entries but have no generated package tile unless they are part of the build checkout.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
