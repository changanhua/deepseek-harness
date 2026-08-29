---
description: "Locale-owned Personal Delivery workbench over the browser-safe Delivery Remote projection."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-delivery

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-delivery` renders the Personal Delivery workbench from the browser-safe Delivery Remote projection. It registers package-owned Chinese and English copy, one existing shell view, and one existing sidebar module entry.

The workbench presents a five-lane Packet ledger, a scope-to-decision evidence spine, and six explicit operations. Its controller owns snapshot and mutation cancellation, keeps the last accepted snapshot during recoverable failures, and disposes every active request with the client plugin lifecycle.

## Contents

- [Composition](#composition)
- [Workbench boundary](#workbench-boundary)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Composition

- The node entry remains inert and contributes only its package invariant companion.
- The browser entry consumes `slots`, `locale`, `remote`, and `remote.delivery`.
- `shell.view/delivery` renders the workbench; `sidebar.modules/delivery-module` opens it and reports the derived blocked count.
- One shared observable controller feeds both entries, so navigation and workbench never keep competing browser copies of Delivery facts.

Slot registration and locale dictionaries are effect-owned and disappear when the plugin is disposed.

## Workbench boundary

Issue import, Packet creation, change start, verification start, evidence read, and a human decision are the in-scope workbench actions. The browser submits selected references and bounded form fields only. Direct lane writes, raw Queue access, paths or provider URIs, credentials, Agent prose as evidence, unverified success, and automatic acceptance are out of scope.

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

- **Profile composition is required** — the workbench appears only when a supported bundle/profile installs its Client plugin and the matching Delivery Remote plus providers.
- **Single-operator MVP** — the browser never selects or claims an operator identity; multi-user authentication and authorization remain outside this package.
