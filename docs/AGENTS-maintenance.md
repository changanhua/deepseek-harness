# Maintaining the AGENTS.md files

English | [中文](AGENTS-maintenance.zh.md)

This repository has several AGENTS.md files at different scopes. Each is an **operating constitution** for the agent working in that scope, not an encyclopedia. This guide covers where each file lives, the rule that decides which file owns a fact, the word-budget discipline, and the discipline for editing them. It exists so future agents and humans keep the split as clean as the restructure made it.

## The three scopes

| File | Scope | What belongs there |
|---|---|---|
| Global (`~/.dsh/AGENTS.md`) | every DSH session on this machine, every project | Cross-project agent work habits. Never DSH-specific content. |
| Root [`AGENTS.md`](../AGENTS.md) | every agent entering this repository | Rules an agent needs in context every session: the identity, pre-release stance, core invariants, minimal validation discipline, secrets rule, Agent Note rule. Target 60–80 lines. |
| Subtree `AGENTS.md` (`packages/`, `examples/`, `docs/`, `.agents/notes/`) | agents working in that subtree | Orders specific to that subtree. Never repo-wide rules the root file already carries. Repo-wide rules are the root file's job, not a subtree's. |

The line between root and subtree is **one home per fact** ([docs/AGENTS.md](AGENTS.md#the-tier-taxonomy-one-home-per-fact)): each rule has exactly one home, and everywhere else only links to it. A rule is a root rule when an agent needs to act on it in every session regardless of task. A rule is a subtree or secondary-doc rule when an agent needs it only for a kind of work — then it belongs in the doc for that kind (`docs/development.md` for TypeScript conventions, `docs/testing.md` for test policy, `docs/cordis-primer.md` for Cordis semantics, and so on), not in the root.

## Which file owns a fact

Ask in this order before adding or moving a rule:

1. **Is it DSH-specific?** If so it can never go in the global file. Global holds only habits that hold in every repo (verify before claiming; read the project's AGENTS first; report actual commands run; distinguish facts from inference). DSH vocabulary (`everything is a plugin`, `Cordis`, `SessionEventMap`, `ctx.effect()`, `dsh-brand`) is never global.
2. **Does an agent need it in every session here?** Then it belongs in root `AGENTS.md` as a one-to-three-line rule linked to its home.
3. **Does an agent need it only when doing a kind of work?** Then it belongs in the secondary doc or subtree file for that kind, not the root. The root keeps only a link in the secondary-documentation index.
4. **Is it a layout, command matrix, or generated catalog?** Then it belongs in the doc whose tier carries it (layout → `development.md`, commands → `development.md` + `testing.md`, type inventory → subsystem pages). The root does not restate it.

## Word-budget discipline

`pnpm run verify-doc-budgets` (part of `doc-sync`) enforces the ceilings in [`scripts/doc-budgets.manifest.json`](../scripts/doc-budgets.manifest.json). The manifest is authoritative — update it, not the advisory target prose, when a ceiling is wrong.

- Root `AGENTS.md` ceiling is **1900 words** in the manifest. Do not treat the 1,600-word target in [docs/AGENTS.md](AGENTS.md#wordcount-budgets) as the gate value; the manifest is the gate.
- When the gate goes red, fix by **relocating** (move the rule to its owning home, leave a one-line link) before **condensing**, and only then consider **raising** the ceiling, with the manifest diff justified in the PR.
- At or below target, retain at least 5% headroom. Above target, the ceiling freezes until relocation or condensation brings it back under.

The restructure reached 60 lines because most conventions moved out, not because the prose was shaved one word at a time. Shaving prose without moving content is the wrong first move.

## Editing discipline

- **State the rule in one to three lines in the root, linking its home.** Expanding context lives at the home, never inline in the root.
- **Moving a rule means landing complete content at its new home.** The failure this guide prevents: delete a rule from the root and add nothing at the destination, so the fact silently disappears from the doc tree. Every moved convention must be fully written into its owning document in the same change ([the hardcoded-tunables miss](../AGENTS.md#conventions) is the recorded example).
- **`CLAUDE.md` symlinks `AGENTS.md`** at root, `packages/`, and `examples/`; edit the real file, never the symlink.
- **Never duplicate a rule.** Grep a distinctive phrase; keep one home, link the rest. A restated rule rots independently.
- **Do not hardcode a specific incident into a standing rule.** A named episode becomes a `Lesson` entry (see [docs/lesson.md](lesson.md)); the standing rule keeps only the general behavior, not the case.
- **Keep each rule self-contained while linking high-level docs.** Condense when clarity survives.

## Verification after a change

After touching any AGENTS.md or moving a convention, run the documentation gates:

```sh
pnpm run verify-doc-budgets   # word ceilings
pnpm run verify-md-links      # relative links and fragments resolve
pnpm run verify-agent-note-format  # Agent Note structure (if notes moved)
```

Report only the commands run. A moved rule that breaks a link or blows a budget is a failed change, not a cosmetic one.
