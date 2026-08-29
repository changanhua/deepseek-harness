---
description: "Empty client package boundary reserved for the Personal Delivery workbench."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-delivery

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-delivery` reserves a publishable browser entry for the Personal Delivery workbench. Its client plugin is intentionally empty: loading it registers no slot, locale, Remote call, subscription, or visible component.

This keeps package discovery and Loader composition stable without claiming a user experience before the Remote-backed projection, actions, disposal behavior, and product-visible tests exist.

## Empty composition

- The node entry remains an empty plugin body.
- The browser entry exports an empty dependency list and no-op `apply()`.
- The manifest preserves the `./client` export and web platform declaration.
- Peer and development dependencies reserve the future dynamic Remote, locale, renderer, and client-test boundary. Static slot, primitives, and React inputs remain development-only until source code actually imports them; none is injected or invoked yet.

No shell or sidebar identity is reserved at runtime. Slot registration is unsupported without the normal registry lifecycle and disposal proof.

## Workbench boundary

Issue import, Packet creation, change start, verification start, and a human decision are the in-scope workbench actions. Direct lane writes, Agent prose as evidence, unverified success, and automatic acceptance are out of scope.

## Dev Note

Keep this scaffold empty unless generated Remote access, framework seats, locale, components, and lifecycle disposal are added and tested together.

## Model Experience

### No direct model context

#### What the model sees

Nothing directly. The empty `./client` entry registers no prompts, tools, resources, Remote calls, or UI.

#### Token effect

Zero direct tokens; no workbench state is currently rendered.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **No product-visible workbench** — Remote-backed cards, human actions, slot composition, accessibility behavior, and disposal are unsupported.
