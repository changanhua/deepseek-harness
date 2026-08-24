# Agent Note: Command knowledge plane with contribution storage and provenance merge

Status: implemented

English | [中文](2026-08-25-command-profiles-knowledge-plane.zh.md)

## Problem

`runtime_inspect(command=X)` answers whether `X` resolves, but only after the model already knows which `X` to ask about. High-frequency CLIs such as `gh`, `codex`, and `claude` are usually known; Feishu, Volcengine, cloud-vendor, internal, and self-built CLIs often are not, and their canonical executable names are exactly the knowledge the model lacks. There was no stable Knowledge plane: a model-facing registry that maps a capability to candidate executable names without probing the host.

## Decision

`@deepseek-ai/dsh-command-profile` registers `ctx.commandProfiles`, and `@deepseek-ai/dsh-tool-command-profile` registers the model-facing `command_profile` tool. Knowledge and Reality stay parallel: the registry never probes executables and never depends on `ctx.runtimeFacts`; the only connection is a candidate name flowing from `command_profile` into `runtime_inspect kind=command`.

### Contribution storage, not merged views

The registry stores `CommandProfileContribution` records — who contributed what to which profile — and computes the effective profile at read time. `contribute(contribution)` takes one self-contained record carrying `contributorId`, `source` (`builtin`/`plugin`/`user`), and `profileId`; there is no second entry point for provenance identity. The returned disposer retracts exactly that record, so unloading one plugin removes only its own candidates and provenance.

### Merge rules and provenance

Duplicate candidates merge with full provenance instead of overriding: built-in, plugin, and user all naming `gh` yields one candidate whose provenance lists all three. Attempt order is user > builtin > plugin regardless of registration order, so a plugin cannot steer the model to its own alias by registering later. Identity fields (`displayName`/`description`) resolve as user override > definition owner; the owner is the built-in when one exists, otherwise the first creating plugin, otherwise the user, and a second plugin redefining identity fields fails loud. Aliases and tags union with case-normalized dedupe, keeping the first canonical spelling in user → owner → remaining-plugin order.

### Candidate ≠ existence

`command_profile` returns candidate executable names with provenance only. The returned DTO exposes no `available`/`installed`/`resolved`/`authenticated`/`version` fields, and the package's prompt section instructs the model to confirm a candidate with `runtime_inspect kind=command` unless current execution already established the fact. The registry itself never probes, so presence is never asserted by the Knowledge plane.

### Candidate grammar

A candidate is a bare executable token, not an invocation recipe. Registration rejects whitespace, path separators, shell operators, and leading dashes, so `npx foo`, `python -m foo`, pipelines, subcommands, and file paths fail loud at registration and keep the Knowledge → inspection chain type-safe. Launcher recipes remain deferred.

### Built-in knowledge stays verified

Four built-in profiles ship as the minimal V2 set (`github-cli` → `gh`, `claude-code` → `claude`, `codex-cli` → `codex`, `opencode-cli` → `opencode`). Admission follows canonical product identity from authoritative documentation, never local resolvability, because built-in knowledge errors mislead every query for a long time. Feishu and Volcengine stay out of built-ins until their canonical CLI identities are established; user and plugin profiles are the tested path for them.

### User settings namespace

The `command-profiles` settings namespace (kebab-case because the settings platform requires it) carries partial user contributions. Profile ids must be unique within the section. A brand-new user profile requires `displayName` and `description`; patching an existing profile inherits resolved identity fields from its owner. `candidateMode: 'replace'` and `disabled` are user-only, and changes apply live to the next query.

## Alternatives considered

**Resolve profiles to a final shape at registration time.** Rejected because it loses provenance, cannot retract one contributor without recomputation, and lets load order decide authority.

**Let plugin contributions override identity fields.** Rejected because a third-party plugin must not own public knowledge semantics for a profile it did not create; the definition-owner rule keeps one authority without load-order sensitivity.

**Have the profile registry report availability.** Rejected because that folds Reality back into Knowledge; the DTO and prompt keep candidate ≠ existence explicit, with presence established only through `runtime_inspect`.

**Expose settings under the camelCase `commandProfiles` namespace.** Rejected because the settings platform enforces lowercase kebab-case namespace ids; the service key `ctx.commandProfiles` is unaffected.

## Consequences

Models gain a deterministic lexical lookup from an ability to candidate executable names, and a user can teach the model its own or internal CLIs through settings without code. Provenance is visible to the model and to debugging, and plugin knowledge is retractable per contributor. The plane deliberately does not become an installed-software inventory, a recommendation ranker, or a semantic search subsystem; presence remains the job of `runtime_inspect`, and the four built-ins are the ceiling of verified knowledge until product identities for Feishu/Volcengine CLIs are established.
