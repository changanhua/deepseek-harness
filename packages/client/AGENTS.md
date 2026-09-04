# AGENTS.md — Web client stack

These rules apply only to `packages/client/*`. They supplement the repo-wide [conventions](../../AGENTS.md#conventions) and [package rules](../README.md). Before changing a layer, read its owning [Web Client architecture](../../docs/subsystems/web-client.md), [Slots reference](../../docs/subsystems/slots.md), or [Conversation reference](../../docs/subsystems/conversation.md).

Packages use the directory prefix `@deepseek-ai/dsh-client-<name>`. Follow the [client-plugin package checklist](../../docs/cookbook/adding-a-package.md#client-plugin-package) when creating one.

## Composition and live data

- Compose only with `ctx.slots.register({ name, children?, store?, inject? }, Component)`; the shell alone renders `'root'`. A component may render only the slots declared by its `children` keys. Registering into another package's slot uses `ctx.slots.inject()` so the contribution follows that declaration's lifecycle.
- Derive component props from `PropsRuntime`, `PropsRenderSlots`, `PropsStore`, and the inject face. `ctx` belongs to `apply` and inject factories, never to feature components.
- A rendering component reads external live state through framework hooks. Put parent-known state in owner props, component-private state in local state, and cross-entry or remount-surviving interaction state in a register-declared store. Use `props.useStore` to read and `props.actions` to write; export `createXXXStore()` factories, create their production handles only in `apply`, and do not make module singletons.
- Injected and shared values are JSON-compatible data or callbacks. Route React nodes through slots. Business components do not subscribe manually, use `useSyncExternalStore`, mirror external snapshots, or manufacture framework hooks/selectors.
- Keep sessions, frames, connections, and transport in the React-free object layer. Stores hold shared viewing and interaction state. Persist a model-visible input as a Session event.

## Package boundaries

The `/client` export exposes only Cordis loading values, allowed store factories, and shared types. A new public value export needs user confirmation. A feature plugin neither runtime-imports nor re-exports another feature plugin; use slots for UI and injected services for behavior, or escalate.

Declare Cordis in matching peer and development dependencies. A dynamic workspace relationship is peer plus development; a static input is development-only; ordinary installed libraries remain dependencies. `verify-client-packages` owns the complete manifest rules.

## Shared modules and the module graph

[`web/src/platform.ts`](web/src/platform.ts) owns `PLATFORM_MODULES` and `PRELOADED_CLIENT_EXTERNALS`; [client modules](../../docs/subsystems/client-modules.md) and the [modules README](modules/README.md) own their complete rules. Baseline React, Cordis, `client/store`, `ui-primitives`, and `ui-slots` externals are implicit. `dsh.client.external` is only for an infrastructure, transport, or generated-assembly request with an exact module-table supplier; it is not a feature-plugin dependency mechanism. A non-baseline request must be supplied by its dynamic package or the static module table, and synchronous request cycles are invalid. Cordis `inject`, `dsh.client.inject`, and module `external` have different timing and must not substitute for one another.

## Presentation and checks

Use [web styling](../../docs/web-styling.md): shared `--dsw-*` tokens, CSS Modules, semantic aliases, and no literal colors, component library, or Tailwind. Product-visible copy belongs to typed locale dictionaries; pass localized labels into Cordis-free primitives and never use translated text as a discriminator. `DSH_CLIENT_*` values are public build-artifact content; use runtime configuration for choices that change after build. Conversation features register a `ConversationNodeDefinition` and renderer under [conversation.md](../../docs/subsystems/conversation.md), without central event folding or full-window scans.

Component specs put `// @vitest-environment jsdom` on the first line, use realistic props or a driven fixture, and assert visible behavior rather than classes, hook internals, or render counts. Run `pnpm run test:gui` for GUI code. Also run `DSH_SNAPSHOT=replay pnpm run test:web` when assembled browser output can change, `pnpm run verify-client-ui-i18n` for visible copy, and `pnpm run verify-client-packages` for package or module declarations. Use [dsh-pre-push-checks](../../.agents/skills/dsh-pre-push-checks/SKILL.md) before a PR.
