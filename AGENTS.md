# AGENTS.md

> **语言规则：所有思考和回复必须使用中文。** 每次 compact 后重新读到此文件时，立即恢复中文思考和中文回复，不要用英文。

DeepSeek Harness is a plugin-based agent harness on vendored Cordis: **everything is a plugin**. Read [docs/architecture.md](docs/architecture.md) before changing `packages/`; follow [docs/AGENTS.md](docs/AGENTS.md) for documentation.

## Pre-release stance

**Remove this section at the first tagged release.** With no external consumers, prefer the correct foundation over compatibility shims: rename or repackage freely and update every reference together. Backends reject old on-disk formats. SQLite uses monotonic `SCHEMA_VERSION`; `dsh-session` keeps `SESSION_FORMAT_VERSION` at `0` with no compatibility promise.

## Repository layout

Repository layout and package groups: see [packages/README.md](packages/README.md).

## Commands

Use repository scripts for install, test, typecheck, build, hygiene, docs, and e2e validation. See [docs/development.md](docs/development.md) and [docs/testing.md](docs/testing.md) for the command matrix.

Run the narrowest relevant checks before reporting completion. Do not default to the full suite; CI owns exhaustive coverage. Match evidence to the change: behavior → focused tests; model/user-visible output → snapshots; docs → doc-sync; published artifacts → build/hygiene/smoke; provider behavior → real-API e2e. If a required command is blocked by the Agent sandbox, retry with the narrowest host escalation before diagnosing the project. Never bypass genuine test failures.

## Secrets

Never commit credentials. Real-API tests use `DEEPSEEK_API_KEY`; see [docs/testing.md](docs/testing.md) for test/key policy.

## Conventions

- **Registrations are effects**: every contribution goes through `ctx.effect()` / `ctx.on()`; a registry's `register()` returns the disposer.
- **Runtime invariants assert owned relationships.** Check authoritative event streams or mutable data, not service or method presence, plugin metadata or effects, or fixed pure examples. Without a plausible relationship, an explained empty companion is correct ([package invariant rules](packages/AGENTS.md)).
- **Model-visible ⟺ logged**: anything that reaches a model request must be reconstructable from the session log; a new model-visible input requires a session event.
- **Plugins, not loop changes**: new behavior goes on documented extension points; changing `agent-loop` requires updating docs/architecture.md.
- **A capability seam comprises Service Definition / Service Provider / Consumer roles.** It is complete, never one role; split only when roles evolve independently ([glossary](docs/glossary.md#capability-seam)).
- **Explicit > implicit at package boundaries**: defaulting is an explicit `resolve(request): Spec` step in the owning implementation, never a hidden `?? default` inside `run()` (the `dsh-shell` request/spec split is the template).
- **No hardcoded tunables in plugins**: deployment-varying choices are validated `Config` fields changeable from `cordis.yml`; a `DEFAULT_*` constant or test hook is not configurability. Protocol constants, external specs, and security invariants stay fixed ([detail](docs/development.md#no-hardcoded-tunables)).
- **Misconfiguration fails loud** at load when self-contained, otherwise at the earliest resolvable point; never silently skip a missing referent.
- **Source plane vs artifact plane, never mixed.** Static gates and tests resolve workspace imports through tsconfig `paths` to `src` and pass on a clean tree; gates consuming built `lib/` declare that dependency ([layout](docs/development.md#typescript-project-layout)).
- **Non-trivial changes MUST include an Agent Note in the same PR;** only mechanical/local edits are exempt ([scope](.agents/notes/README.md#when-to-write-one)). Archived notes are frozen: never edit or treat them as current authority ([archive policy](.agents/notes/README.md#archiving-and-deletion)).

## Secondary documentation

- **Fork divergence record** — the owner-maintained list of deliberate differences from the official upstream, reconciled when the owner requests an update or merge: [FORK-DIVERGENCE.md](FORK-DIVERGENCE.md).
- **Testing policy** — [docs/testing.md](docs/testing.md).
- **Defensive patterns** — read [docs/defensive-patterns.md](docs/defensive-patterns.md) before lifecycle, concurrency, subprocess, or teardown work.
- **Type safety and documentation** — [docs/development.md](docs/development.md).
- **Cordis semantics** — [docs/cordis-primer.md](docs/cordis-primer.md).
- **Tool authoring** — [docs/cookbook/adding-a-tool.md](docs/cookbook/adding-a-tool.md).
- **AGENTS.md maintenance** — how the root, global, and subtree AGENTS.md files are owned and edited: [docs/AGENTS-maintenance.md](docs/AGENTS-maintenance.md).
- **Hard-won lessons** — [docs/lesson.md](docs/lesson.md).
- **Future work candidates** — [docs/future-work-candidate.md](docs/future-work-candidate.md).

## Type safety and documentation

Everything compiles under `strict: true` with `noImplicitAny`; every remaining `any` explains why narrowing is infeasible. Every module and export has concise JSDoc for its non-obvious contract; function-like exports include `@param`/`@returns`, as enforced by `verify-export-jsdoc`. Heritage-declared members, plugin-protocol slots, and constructors keep their docs at the declaring Service Definition, protocol, or class.

Comments and docs state complete contracts and context, not reasoning transcripts. Use direct, concrete terms. Do not use metaphors. Before writing `contract`, `boundary`, or `shape`, ask whether a more exact term names the subject: write `response fields`, `JSON validation`, or `ESM exports` instead of `response shape`, `validation boundary`, or `module shape`. Keep `contract` for preconditions, postconditions, invariants, compatibility promises, and other obligations that callers, callees, implementers, providers, producers, or consumers rely on. Keep a literal process, wire, security, transaction, or lifecycle boundary. Do not narrate control flow or tests, preserve review history, or restate code. Keep behavior, failure, timing, ownership, and safe-use facts; link the rationale. Use [dsh-prose-standard](.agents/skills/dsh-prose-standard/SKILL.md) for decisions. Wire mechanically checkable invariants into an executed top-level gate and prove each changed acceptance path rejects an invalid case. Use narrow, justified exceptions instead of disabling a rule globally.

Docs accompany every code change: update affected README and JSDoc contracts together. Routine bilingual work follows [docs/AGENTS.md](docs/AGENTS.md); only explicit user invocation may run `dsh-translate-docs`. Current-state prose, one physical line per paragraph, one home per fact, and word budgets live there.

## Editing these instructions

`CLAUDE.md` symlinks `AGENTS.md` at root, `packages/`, and `examples/`; edit the real file. Keep each rule self-contained while linking high-level docs. Condense when clarity survives; raise a `verify-doc-budgets` ceiling when the required content genuinely needs more space.

## Vendoring policy

`vendor/` packages are pinned source copies (manifest with upstream SHAs in [vendor/README.md](vendor/README.md)). Update via the sync procedure there; re-apply or retire the logged local modifications; rerun `pnpm run test && pnpm run build`.
