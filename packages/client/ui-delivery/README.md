---
description: "Locale-owned Personal Delivery workbench over the browser-safe Delivery Remote projection."
kind: "package-reference"
---

# @changanhua/dsh-client-ui-delivery

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-delivery` lets one operator capture a local Delivery Case from a single idea, leave it in Shaping, and choose later whether to complete its delivery conditions. A ready revision can then be approved, executed, verified, accepted, and optionally published as a GitHub Issue.

The primary Case list exposes Shaping, Ready, Running, Review, Blocked, and Accepted phases while publication remains a separate visible lifecycle. The secondary Packet ledger keeps the scope-to-decision evidence chain, and the shared controller owns cancellation, recoverable snapshots, and every active request.

## Contents

- [Composition](#composition)
- [Workbench boundary](#workbench-boundary)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Composition

- The node entry remains inert and contributes only its package invariant companion.
- The browser entry consumes `slots`, `locale`, and `remote`, mounts the generated Delivery Remote contribution, then registers its UI in a nested context that requires `remote.delivery`.
- `shell.view/delivery` renders the workbench; `sidebar.modules/delivery-module` opens it and reports the derived blocked count.
- One shared observable controller feeds both entries, so navigation and workbench never keep competing browser copies of Delivery facts.

The Remote contribution, slot registrations, and locale dictionaries disappear together when the plugin is disposed. A failed UI registration also unmounts the Remote contribution.

<a id="workbench-boundary"></a>

## Workbench boundary

The default intake saves one idea as a local Shaping Case with incomplete outcome, scope, acceptance, base, and verification fields. Completing those delivery conditions is an explicit revision action; existing-Issue import and GitHub publication are secondary actions. The browser submits bounded content and selections only; repository binding, human actor identity, idempotency, credentials, publication markers, raw Queue authority, and acceptance proof remain Host-owned.

<a id="dev-note"></a>

## Dev Note

Keep lanes and blocked reasons derived from the Host snapshot. New operations require a narrow Remote method, package-owned locale copy, cancellation, and product-visible tests together.

## Model Experience

### No direct model context

#### What the model sees

Nothing directly. The `./client` workbench registers browser UI and Remote calls, but no prompts, tools, or resources.

#### Token effect

Zero direct tokens; workbench state is browser control data rather than model input.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Profile composition is required** — the workbench appears only when a supported bundle/profile installs its Client plugin and the matching Delivery Remote plus providers.
- **Single-operator MVP** — the browser never selects or claims an operator identity; multi-user authentication and authorization remain outside this package.
- **Real publication requires Host configuration** — the Case stays local when its repository has no `githubTargets` entry, and a real Issue requires a separately approved credential and target.
