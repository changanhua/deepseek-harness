# @deepseek-ai/dsh-command-profile

English | [中文](README.zh.md)

Command Knowledge Plane registry: stable knowledge about which executables a capability maps to. Contributors register knowledge records through `contribute`; consumers query effective profiles through `query`/`resolve`. The registry stores contributions, never merged views, so provenance survives every merge and disposal retracts exactly one contributor. It never probes executables and never depends on runtime facts — Knowledge and Reality stay parallel. Decision record: [the command-profiles Agent Note](../../../.agents/notes/implemented/architecture/2026-08-25-command-profiles-knowledge-plane.md).

## Config

```yaml
- id: command-profile
  name: '@deepseek-ai/dsh-command-profile'
  config:
    includeBuiltins: true
```

`includeBuiltins` defaults to `true` and seeds the four verified built-in profiles: `github-cli` → `gh`, `claude-code` → `claude`, `codex-cli` → `codex`, `opencode-cli` → `opencode`. Admission follows authoritative product identity, never local resolvability. Set it to `false` for an empty registry that only plugin and user contributions populate.

## Contribution model

`ctx.commandProfiles.contribute(contribution)` stores one knowledge record and returns its exact disposer. Each record carries its own provenance (`contributorId`, `source`, `profileId`), so there is no second entry point competing for identity. Disposing a contribution removes only its records; other contributors' records and provenance stay.

`candidateMode` and `disabled` are valid only for `source: 'user'`. Every candidate is a bare executable token: registration rejects whitespace, path separators, shell operators, and leading dashes, so the Knowledge → `runtime_inspect` chain stays type-safe.

## Merge rules

The effective profile is computed at read time from all active contributions.

- **Identity fields** (`displayName`, `description`): a user explicit value wins over the profile's definition owner. The definition owner is the built-in contribution when one exists, otherwise the first plugin that created the profile, otherwise the user. A second plugin cannot redefine identity fields on a profile it does not own — registration fails loud.
- **Aliases and tags**: union of active contributions, deduplicated with case-normalized comparison while keeping the first canonical spelling. Display order is user → definition owner → remaining plugins by contributor id.
- **Candidates**: deduplicated with full provenance retained, so a candidate named by built-in, plugin, and user yields one entry whose provenance lists all three. Attempt order is user → builtin → plugin regardless of registration order. A user `candidateMode: 'replace'` cuts all lower layers; `disabled: true` hides the whole profile from query results.

## User settings

The `command-profiles` settings namespace carries user contributions as an array of partial profiles:

```yaml
command-profiles:
  profiles:
    - id: github-cli
      candidates: [mygh]          # patch: append (default)
      # candidateMode: replace    # explicit replace cuts built-in candidates
      # disabled: true            # hide the whole profile
    - id: my-feishu               # new profile: displayName/description required
      displayName: My Feishu CLI
      description: My Feishu automation CLI
      aliases: [feishu-sync]
      candidates: [feishu-sync]
```

Profile ids must be unique within the section (registration fails loud). A brand-new user profile must supply `displayName` and `description`; patching an existing profile inherits resolved identity fields from its owner. Changes apply live to the next query.

## Query

`query({ query, limit? })` performs deterministic lexical matching: id exact/prefix, alias exact, displayName contains, tag exact, then description token. Matching trims and lowercases; same-rank matches sort by profile id. `limit` defaults to 5 and clamps to 1..10.

## Model Experience

Indirectly, through the `command_profile` tool that `@deepseek-ai/dsh-tool-command-profile` registers; the registry itself renders no prompt, schema, or result.

#### KV Cache effect

Prefix-stable while the registry contributions and the consuming tool's definition are unchanged; profile content appears only in tool results, never in the request prefix.

## Known Limitations and Deferred Work

- **Candidates are identifiers, not recipes** — launcher forms such as `npx foo` or `python -m foo` are rejected and remain deferred to a later V2 slice.
- **No installed-software inventory** — the registry never probes the host; presence is established only through `runtime_inspect`.
- **No semantic search** — query is lexical and bounded; a second search subsystem is deferred until real usage shows it is needed.
