# DSH capability search sources

Use this map selectively. Start with the owning subsystem and expand only when the evidence leaves a real ambiguity.

## Standing architecture

- `AGENTS.md` and the nearest subtree `AGENTS.md`
- `docs/architecture.md`
- `docs/glossary.md`
- `docs/capability-seams.md`
- `packages/README.md`
- `packages/AGENTS.md` when changing packages

## Generated and current-state inventories

- `docs/tool-catalog.md`
- `docs/config-catalog.md`
- `docs/persistence-catalog.md`
- `docs/module-graph.md`
- generated `cordis-surface` regions in `docs/subsystems/*.md`
- `packages/host/capability-registry` for the runtime Skills, Tools, and MCP management projection
- `TaskQueue.listKinds()` and the registered `WorkKindMap` for Queue work

Generated catalogs prove declared current source only when freshness checks pass. They do not prove a Profile composes the capability or a real Provider works.

## Runtime composition

- `$DSH_HOME/profiles/<profile>/package.json`
- `$DSH_HOME/profiles/<profile>/cordis.patch.yml`
- `$DSH_HOME/cordis.patch.yml`
- shipped Bundle patches under `packages/bundle/`
- Cordis runtime inspection when the target process is live
- `ctx.skills.managementSnapshot()` for resolved Skill candidates and shadowing
- `ctx.tools.schemas()` and MCP management projection for the viewing scope

Do not expose credentials while inspecting configuration. Report a Provider as composed only after its row is active or its required service is observable; package installation alone is not composition proof.

## Source and tests

Start with `git branch --show-current` and `git status --short`. Distinguish committed source, uncommitted WIP, generated drift, and a live process proven to consume the current checkout. Do not reset, clean, switch, or absorb unrelated changes while auditing reuse.

Search exact and adjacent terms with `rg` before broader tooling:

```powershell
rg -n "<service-key>|<type>|<tool-name>|<event>|<work-kind>" packages docs .agents/notes
rg -n "register|inject|ctx\.<key>|resolve\(|start\(|cancel\(|retry|recover|reconcile" packages/<group>
```

Inspect Service Definition, Provider, Consumer, Bundle composition, focused tests, package README, subsystem reference, and owning active Agent Notes. Exclude `vendor/` and frozen `.agents/notes/archived/` from ordinary review.

## Community search

Search only after stating the missing local semantics. Useful query dimensions include:

- the user outcome and protocol name;
- `SKILL.md`, plugin, npm package, or GitHub repository;
- the target model/provider or file format;
- batch, structured output, cancellation, retry, or recovery as applicable;
- the DSH or Cordis ecosystem when the capability is Harness-specific.

Open primary repositories and exact files. Search-result summaries are candidate discovery, not adoption evidence.
