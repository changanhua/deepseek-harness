# Agent Note: Architecture Explorer evidence layers

Status: implemented

English | [中文](2026-08-29-architecture-explorer.zh.md)

## Problem

The repository contains hundreds of formal workspace packages, while one running Web profile composes only a subset of package entries. A static package list cannot show current activation, and a Loader snapshot cannot explain packages that are absent from that process. Combining both sources without provenance would make source presence, build composition, and runtime observation appear equivalent.

## Decision

The Web bundle includes `@deepseek-ai/dsh-client-ui-architecture` as a first-level sidebar module and a full `shell.view` workspace. The package keeps the ordinary conversation mounted while developers browse the package field, filters, dependency direction, reverse consumers, and one package's evidence detail.

The build catalog and Runtime overlay remain separate evidence layers. `scripts/gen-architecture-catalog.ts` deterministically derives the committed Client catalog from formal `packages/*/*/package.json` manifests. It records manifest descriptions, directory groups, explicit browser/bundle/Remote/tool faces, and in-repo `peerDependencies`; `verify-architecture-catalog` rejects drift.

The Runtime layer reuses `pluginInventory/list`. It reads the current Loader directly and supplies enablement plus Fiber phase without another lifecycle cache. The Client joins a Runtime row to a catalog tile only when the exact module specifier equals the generated package name. The UI labels unjoined packages as unobserved instead of inferring that the current Profile excludes or cannot load them.

Fetch state belongs to an apply-private snapshot controller. Components receive the catalog as immutable injected data, receive Runtime state through the Slot renderer's `hooks` compartment, and keep search, group, and selected-package state locally.

## Alternatives considered

**Scan the source checkout from the Host at runtime.** A packaged installation may not contain a source checkout, and filesystem discovery would add path authority and platform behavior to a read-only Client feature. The build already has the exact manifests needed for a deterministic catalog.

**Expand `pluginInventory/list` into a repository catalog.** The plugin-inventory package owns current Loader entries and intentionally carries no cache or provenance model. Build metadata is a different authority and remains in a generated Client artifact.

**Publish only the generated module graph document.** The document remains the exhaustive dependency reference, but it cannot preserve interactive selection or join the current Loader state. The Architecture workspace links rather than replaces that owner.

**Infer Profile and bundle provenance from Loader order.** Loader order proves current configuration order, not which layer last introduced or replaced a row. The first version leaves provenance absent until the profile composer exposes it explicitly.

## Consequences

The Architecture entry is always available in the shipped Web workspace and requires no new Host service. Its generated Client artifact grows with the formal package catalog, and every manifest change must satisfy the freshness check. Dependency links intentionally cover `peerDependencies`, not arbitrary imports or Cordis injection.

Runtime state is point-in-time and refreshes manually because plugin inventory exposes no stream. External Loader modules remain visible only through aggregate Runtime counts until a separate installed-package catalog has an authority. Profile comparison, bundle provenance, behavior verification, and flow playback remain outside this evidence layer instead of appearing as guessed facts.
