---
description: "Explicit local project-memory composition with model proposals and human review."
kind: "package-bundle"
---

# @changanhua/dsh-personal-memory

English | [中文](README.zh.md)

## Summary

This private bundle adds source-checked project memory to a Profile that already supplies Workspace, Storage Domain, Sessions, file access, Tools, Commands, and System Prompt. It mounts the local provider, three model tools, and the human `/memory` command.

## Table of Contents

- [Composition](#composition)
- [Verification](#verification)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Composition

<a id="composition"></a>

Add this bundle explicitly after `dsh-base` and `dsh-web-app` in the test or development Profile's `dsh.profile.bundles`. The package must be available to that Profile's module resolver. This source-only package is not published to a public registry. Launch the composed Profile through `dsh --profile <name>` after building the repository.

| Row | Owner | Purpose |
| --- | --- | --- |
| `project-memory-local` | [memory-local](../../memory/memory-local/README.md) | Workspace scope, source checks, durable revisions and decisions |
| `tool-project-memory` | [tool-memory](../../memory/tool-memory/README.md) | `memory_search`, `memory_read`, and `memory_propose` |
| `command-project-memory` | [command-memory](../../memory/command-memory/README.md) | Human list, inspection, acceptance, rejection, and withdrawal |

The local provider's ownership lock lives under `DSH_HOME/storages/project-memory-ownership/`. The composed Storage Domain backend owns the `project_memory` domain data. The bundle does not alter the base or Web defaults, register a new page, or replace existing providers. Omitting it leaves the new tools and command absent.

## Verification

<a id="verification"></a>

The [Loader test](tests/loader.e2e.ts) starts built CLI artifacts through the supported ACP Profile in an isolated test home, adds Workspace for that test, and exercises a real Agent's tool and human command paths without inference. It checks explicit enablement, durable acceptance, normal shutdown, and lock release. This establishes composition behavior; it does not establish live-model recall or browser acceptance.

The [acceptance test](tests/acceptance.e2e.ts) uses the actual Web Host composition and real model calls to check new-session artifacts, normal restart, revised sources, project isolation, and withdrawal. The separate [Web snapshot driver](../../../apps/web/tests/project-memory.snapshot.ts) owns browser proposal and human-review evidence. [Benefit comparison](tests/benefit.e2e.ts) measures five fixed artifact tasks with memory enabled and disabled, then checks expired and conflicting claims. It reports reuse of already accepted memory separately from setup effort; five samples do not establish general productivity or lifecycle cost.

After building, run `pnpm run test:e2e -- packages/bundle/personal-memory/tests/acceptance.e2e.ts` and the same command with `benefit.e2e.ts` for the comparison. These suites use the authorized `DEEPSEEK_API_KEY` with DeepSeek V4 Flash, never replay, and disable retries. They self-skip without a key for secretless CI; that result does not satisfy live acceptance. The model-free [restart test](tests/acceptance-scaffold.e2e.ts) checks retained test storage separately. Test evidence belongs under `.artifacts/project-memory/`.

## Model Experience

### Composed memory capability

#### What the model sees

The [tool-memory consumer](../../memory/tool-memory/README.md#model-experience) owns `memory_search`, `memory_read`, and `memory_propose`, their fixed guidance, and bounded results. This bundle supplies no additional prompt text.

#### Token effect

Enablement adds the consumer's schemas and guidance. Result tokens depend on the memories the agent requests.

#### KV Cache effect

Stable composition keeps schemas and guidance stable; source-checked results enter conversation history when requested.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- One local Host owns a memory root. An abandoned ownership lock requires verification that its process has exited before removing that exact lock.
- Workspace identities stay separate, including worktrees. The bundle does not merge projects or synchronize external knowledge stores.
- Models propose candidates; only exact human commands accept or withdraw them. Acceptance does not bypass current source, review-date, or conflict checks.

No invariant companion is published because this static Bundle owns patch composition; its provider and consumers own runtime facts.

### Dev Note

Keep this package a static patch carrier. Runtime state and authority belong to the memory plugins and existing infrastructure owners.
