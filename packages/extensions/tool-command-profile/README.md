# `@deepseek-ai/dsh-tool-command-profile`

English | [中文](README.zh.md)

`command_profile` is the model-facing consumer of DSH's command knowledge plane. Lookup delegates to `ctx.commandProfiles.query()`, which returns candidate executable names with full provenance. The tool never asserts installation or availability, keeping candidate ≠ existence.

## Tool contract

The tool takes one object-rooted argument set:

```json
{ "query": "github", "limit": 3 }
```

`query` is required and matched lexically across profile ids, aliases, display names, tags, and descriptions; `limit` is an optional integer from 1 to 10 (default 5). A failed lookup returns an empty `matches` array rather than an error, so the model can retry with a different query.

## Candidate ≠ existence

A profile names candidates only. It does not prove that a candidate is resolvable, installed, authenticated, or a particular version. The package's prompt section instructs the model to confirm a candidate with `runtime_inspect kind=command` unless current execution already established that fact; the returned DTO deliberately exposes no availability fields.

## Model Experience

### System prompt

#### What the model sees

The package contributes one stable guidance section pinning candidate ≠ existence.

##### Command-profile guidance

```markdown
A command profile supplies candidate executable names only. It does not prove installation or runtime availability. Before concluding that a candidate command is available or unavailable, use authoritative runtime command inspection (runtime_inspect kind=command) unless current execution already established that fact.
```

#### Token effect

Fixed guidance cost per request while the plugin is loaded; profile content never enters this stable section.

#### KV Cache effect

Prefix-stable while the plugin and guidance text are unchanged.

### command_profile tool

#### What the model sees

One `command_profile` tool accepting `{ query, limit? }`. The tool definition enumerates no profile content.

#### Token effect

Fixed tool-definition cost per request while the plugin is visible.

#### KV Cache effect

Prefix-stable while the tool definition and scope visibility are unchanged.

### Query results

#### What the model sees

A result lists matched profiles with `id`, `displayName`, `description`, and `candidates` — each candidate carrying `command` plus its `provenance` (`source`/`contributorId`). No availability field appears.

#### Token effect

Data-dependent: bounded by `limit` and the matched profile count. Retained results stay in conversation history until compaction.

#### KV Cache effect

Append-only; newly returned profile content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Candidates are not recipes** — launcher forms (`npx foo`, `python -m foo`) are out of scope and rejected by the registry.
- **No recommendation ranking** — matches are lexical and deterministic; the model decides which candidate to attempt.
