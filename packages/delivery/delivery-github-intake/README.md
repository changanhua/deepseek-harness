---
description: "GitHub Issue snapshot intake Consumer for immutable Personal Delivery contract revisions."
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-github-intake

English | [中文](README.zh.md)

## Summary

`dsh-delivery-github-intake` is a pure Consumer that turns one exact GitHub Issue snapshot into an immutable Delivery Contract revision. It exports `importGitHubIssue`, accepts an explicit host-provided `fetch`, and can only inspect `Delivery.snapshot()` plus call `Delivery.adoptContractRevision`. It does not persist GitHub credentials, synchronize every Issue, register a service, or own Delivery storage.

## Use this package

Pass the canonical Issue URL and the required configured local repository identity. Intake derives the preceding revision for that same Issue from the trusted Delivery snapshot; a browser cannot select or splice revision lineage. The function returns the existing or newly adopted immutable revision under a content-derived idempotency key.

```text
const revision = await importGitHubIssue(
  { delivery: ctx.delivery, fetch },
  {
    issueUrl: 'https://github.com/example/project/issues/42',
    repositoryId,
    signal,
  },
)
```

Admission accepts only the exact form `https://github.com/{owner}/{repository}/issues/{positive-safe-integer}`. It rejects credentials, ports, query strings, fragments, trailing or extra paths, percent-encoded path segments, non-public hosts, look-alike hosts such as `github.com.evil`, zero or padded issue numbers, and numbers beyond JavaScript's safe integer range before `fetch` can run. The caller owns authentication and selects the URL.

The Issue body contains exactly one authoritative block: the line `<!-- dsh-delivery-work-brief@1 -->`, immediately followed by an exact `yaml` fence. [`fixtures/work-brief.valid.md`](fixtures/work-brief.valid.md) is the copyable template. The strict YAML value requires `format`, outcome, context, both scope arrays, explicitly identified acceptance clauses and open decisions, base-selection rule, verification source, and reference links. Narrative outside the block is supporting context only. Stable clause, decision, and inline-check ids match `^[a-z][a-z0-9-]{0,63}$`; missing fields fail instead of receiving defaults. The exported parser rejects duplicate blocks, aliases, duplicate YAML keys, unknown fields, and authoritative YAML over 64 KiB.

## Understand the implementation

The request boundary validates the strict public github.com Issue grammar before any I/O, closing the authenticated-fetch SSRF and credential-leak path. It fetches the one derived GitHub API snapshot through the supplied host `fetch`, requires HTTP 200 and `application/json`, and rejects malformed, stale-coordinate, or invalid immutable snapshots. `parseGitHubIssueWorkBrief()` and `workBriefContractRevisionDraft()` freeze the executable body grammar and its exact Delivery mapping. The Consumer returns an existing Contract revision for content-equivalent source fields; otherwise it derives the latest same-Issue predecessor, a content-derived idempotency key, and one adoption request. HTTP cache state and mutable GitHub status are never durable Delivery authority.

## Model Experience

### Imported Issue context

#### What the model sees

This package sends nothing to a model; downstream shaping or execution code can render fields from the adopted `ContractRevision`, while this Consumer only preserves the exact Issue snapshot and parsed contract structure.

#### Token effect

Intake adds no prompt tokens, tool schemas, or model calls; one concise Work Brief can reduce execution context assembled by other packages.

#### KV Cache effect

There is no direct KV-cache contribution; stable Issue templates may make downstream prompts more regular, but those consumers own their cache behavior.

## Known Limitations and Deferred Work

- **Only one public Issue read is supported** — intake reads the derived public GitHub API endpoint for one canonical Issue URL and accepts no Enterprise host, credentials, cache, webhook, polling, or write-back authority.
- **GitHub Enterprise is unsupported** — arbitrary hosts are rejected because no separate trusted-host policy exists.
- **One Issue snapshot per call** — webhooks, polling, bulk synchronization, comments, Projects, labels, and PR mutation are out of scope.
- **No automatic requirement invention** — every authoritative field must be present; unresolved ambiguity is an explicitly identified `openDecisions` entry, and intake cannot silently make a Contract ready.
