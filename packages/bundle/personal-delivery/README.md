---
description: "Personal Delivery add-on composition for users running the complete Issue-to-acceptance workflow in DSH."
kind: "package-bundle"
---

# @deepseek-ai/dsh-personal-delivery

English | [中文](README.zh.md)

## Summary

`dsh-personal-delivery` is the add-on bundle carrier for the Personal Delivery vertical slice: GitHub Issue intake, durable Delivery records, isolated Git worktrees, governed Codex execution, immutable evidence, independent verification, Queue bridging, Remote projection, UI, and human acceptance.

The published patch is the runnable local Windows composition over `dsh-base` and `dsh-web-app`. It mounts the durable Delivery provider, local evidence and Git-worktree providers, Queue bridge, browser Remote, and Delivery UI without adding another scheduler or control-plane store.

## Table of Contents

- [Composition](#composition)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="composition"></a>
## Composition

The bundle boundary is a patch layer over the existing base and Web application bundles. Start DSH from the exact Git repository to deliver: the launch directory is exposed as repository id `workspace`, while evidence and Attempt-owned worktrees live under `DSH_HOME/personal-delivery/`. The Git provider verifies that the launch directory is the repository toplevel before minting authoritative revision facts.

The patch mounts `delivery-local`, `delivery-evidence-local`, `repo-workspace-git-local`, `delivery-task-queue`, `delivery-remote`, and `ui-delivery` in dependency order. The base layer continues to own Storage Domain, Subprocess, Queue capacity, transport, and the Web shell.

The bundle contains composition only. It does not implement a scheduler, duplicate Queue state, parse Issues, execute Git, verify evidence, or accept a delivery.

<a id="dev-note"></a>
## Dev Note

Keep this package a static patch carrier. Runtime behavior and durable authority remain in the independently owned Delivery, Queue, Git-workspace, and evidence plugins.

<a id="model-experience"></a>
## Model Experience

### No direct model context

#### What the model sees

Nothing directly. `cordis.patch.yml` composes providers, Remote, and UI that register no prompts, tools, or model resources.

#### Token effect

Zero direct tokens; this package selects host and browser plugins only.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One launch-directory repository** — the P0 profile exposes only repository id `workspace`; start DSH from the exact Git toplevel that the Issue targets.
- **Local execution and evidence only** — worktrees and evidence remain on this Windows host; multi-host execution requires different providers.
- **Codex authentication remains external** — the bundle uses the existing Codex installation and credentials and never copies secrets into Delivery configuration.
