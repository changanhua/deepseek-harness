# Agent Note: Repository-owned npm publication identity

Status: implemented

English | [中文](2026-09-04-repository-owned-npm-scope.zh.md)

## Problem

The personal distribution inherits official `@deepseek-ai/*` package names, release families, and npm workflows. A token, a manual workflow dispatch, or the local baseline publisher could therefore attempt to publish fork bytes under an official identity, while personal packages also advertised the official repository before they had an independent release boundary.

Package absence from one upstream revision is not proof of personal ownership. Renamed or removed upstream packages can be absent too, so an automatic diff cannot decide which namespace owns a package.

## Decision

[`downstream/package-identities.json`](../../../../downstream/package-identities.json) owns the two npm scopes, their only publishing repositories, the supported and observed upstream commits, and the explicit personal-package set. Unlisted packages default to upstream ownership, `vendor/*` remains vendor provenance, and only a reviewed registry edit can classify a package as personal.

The personal scope is `@changanhua`. Each confirmed personal package records its legacy name, source name, source identity, publication policy, absent release family, and explicit publication blockers. All 41 entries use `blocked-until-release-verified`; their manifests, imports, bundle rows, TypeScript paths, catalogs, and lockfile use the personal source names, while their existing versions remain unchanged.

## Publication firewall

[`scripts/package-identities.ts`](../../../../scripts/package-identities.ts) requires a GitHub Actions context and rejects an `@deepseek-ai/*` publication unless `GITHUB_REPOSITORY` is `deepseek-ai/deepseek-harness`. It rejects an `@changanhua/*` publication unless the repository is `changanhua/deepseek-harness`, the source name is explicitly registered, and its publication policy is `personal`. Missing Actions or repository identity and unowned scopes fail closed.

The dsh, vendor, baseline, and Landlock publication paths run the check before their first registry request. Before excluding a registered personal directory, the official DSH family validates that its manifest still has the registered personal source name, repository, and source-only publication settings. It then rejects every runtime or peer dependency from an official member to the personal scope. The publish step independently applies that closure to each packed manifest and requires the packed set, order, identity, version, and runtime dependency names to match the current source family before its first registry read.

The official DSH rehearsal and documentation deployment jobs run only in `deepseek-ai/deepseek-harness`: this mixed source tree is expected to fail the official closure rather than weaken it. Ordinary fork CI still builds and tests the source and documentation. The official npm release workflows guard every job by repository identity, and the public Python publication jobs carry the same official-repository restriction until the personal distribution owns separate PyPI names. A personal-fork dispatch cannot reach token-bearing jobs. These checks prevent accidental use of repository release tooling; npm or PyPI credentials and trusted-publisher configuration remain the external authorization boundary, and a hostile local process can bypass repository scripts by calling a registry client directly.

## Package ownership

The registry contains the 41 package manifests introduced on the personal line after supported upstream commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`. Explicit inclusion records the ownership decision; the commit comparison is evidence for review, not an inference rule for later upstream additions.

A personal package is a source-only workspace member: its manifest points to the personal repository, sets `private: true`, omits `publishConfig`, and is excluded by directory from the official DSH release family. A package becomes publishable only after its tarball dependency and configuration closure is independently verified, a Personal release family is defined, `private` is removed, and its publication policy changes to `personal`. Personal packages may continue to depend on unchanged official Service Definitions. A package that requires a privately modified upstream implementation remains source-only until that dependency is extracted or receives its own personal release identity.

## Alternatives considered

**Rescope every workspace package immediately.** Rejected because more than 300 manifests and thousands of source, configuration, test, and documentation references carry the official scope. Keeping that rewrite on the downstream branch would enlarge nearly every upstream merge and would mix provenance policy with runtime migration.

**Rename only the 41 manifests.** Rejected because source imports, workspace dependencies, bundle plugin names, generated catalogs, TypeScript paths, and the lockfile resolve by package name. A manifest-only rename can pass superficial review while producing an uninstallable release.

**Rewrite package names only while packing.** Rejected because the published module graph would differ from the source graph and no ordinary checkout could reproduce the installed artifact.

**Rely on fork workflows having no npm token.** Rejected because credentials can be added later, local publication paths exist, and a missing secret does not state who owns a namespace.

## Consequences

The fork has a personal source namespace without claiming that a personal npm release exists. Repository publication paths fail before registry access when their Actions and repository identities disagree, and each personal package has one reviewable source identity and an explicit stop state.

The source tree intentionally contains official upstream packages and registered personal packages under different scopes. Runtime service keys, Loader row IDs, Remote namespaces, WorkKinds, and persistence formats do not change with npm identity, so the rescope remains revertible without data migration. The registry and publication guard require a later release-family change to prove the personal tarball closure before publication becomes possible. Publish-time manifest validation prevents the source-only scope from leaking through stale artifacts; it is not a cryptographic attestation of otherwise identical package bytes, which remains a separate supply-chain hardening concern. The earlier [release-sequence](2026-08-10-npm-release-sequences.md) and [access-level](2026-08-13-public-vendor-and-native-sequences.md) decisions still govern official-scope artifacts; this decision adds repository ownership and the personal distribution boundary.
