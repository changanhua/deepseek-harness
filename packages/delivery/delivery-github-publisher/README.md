---
description: "Host-only library that renders approved Personal Delivery Case revisions as GitHub Issues and records truthful publication outcomes."
kind: "package-library"
---

# @changanhua/dsh-delivery-github-publisher

English | [中文](README.zh.md)

## Summary

`dsh-delivery-github-publisher` lets a Host Consumer publish one approved, ready Delivery Case revision to its configured GitHub repository without giving browser or model callers a credential, repository path, idempotency key, or external-resolution authority. [`delivery-remote`](../delivery-remote/README.md) supplies Delivery, credential, target-map, clock, and HTTP boundaries; the library renders the Issue, persists intent before network I/O, validates the 201 response, and commits the resulting Issue binding. Transport uncertainty and invalid post-request responses become durable `unknown` state instead of automatic retries. The entry is a plain library API and registers no Cordis service.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### When to use it

Use this library from a trusted Host Consumer that already owns a configured `RepositoryId -> GitHubRepositoryRef + CredentialRef` mapping and any optional Issue labels. Callers that need browser-safe operations use [`delivery-remote`](../delivery-remote/README.md); callers that only import an existing Issue use [`delivery-github-intake`](../delivery-github-intake/README.md). Do not mount this package as a `cordis.yml` row.

### Entry point

The smallest publication call passes capabilities rather than a Context:

```text
const publication = await publishGitHubIssue(
  { delivery: ctx.delivery, credentials: ctx.credentials, fetch, targetForRepository, now },
  { caseId, revisionId, signal },
)
```

Success returns the durable `published` record. A repeated logical call returns the same binding without another POST. Missing configuration fails before the HTTP request; a failure after the request starts is recorded as `unknown`. Use `resolveGitHubIssuePublication()` only after a human selects a candidate Issue number: the function performs a fresh GET and confirms `published` only when the complete body, terminal marker, and digest match.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The renderer derives one publication id from the Case and revision ids, emits human-readable requirement sections, and computes `renderedDigest` over the title plus marker-free content. The terminal marker then carries that real publication id and digest without creating a self-referential hash. Delivery owns the persisted `prepared -> publishing -> published|failed|unknown` transitions; this library owns the HTTP side-effect boundary and never caches a resolved credential.

| File | Role |
|---|---|
| [`src/render.ts`](src/render.ts) | Deterministic Issue body, bounded UTF-8 output, digest, and terminal marker |
| [`src/index.ts`](src/index.ts) | Publication, response validation, failure classification, and GET reconciliation |
| [`src/failures.ts`](src/failures.ts) | Stable Host error codes without raw provider or credential detail |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion; Delivery owns the mutable state machine |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Delivery package group](../README.md) — ownership map for Cases, execution, evidence, publication, and UI.
- [Delivery protocol](../delivery-protocol/README.md) — durable publication record and transition types.
- [Credential seam](../../credentials/credentials/README.md) — per-operation credential-reference resolution.
- [Delivery Remote](../delivery-remote/README.md) — Host configuration and browser-safe publication operations.
- [GitHub REST Issue endpoints](https://docs.github.com/en/rest/issues/issues) — upstream Create/Get Issue behavior and token permissions.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the consuming Delivery Remote or UI; this library registers no model tool, prompt, schema, or result rendering.

#### KV Cache effect

No direct invalidation; Issue rendering and HTTP results never enter a model request prefix in this package.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **GitHub.com REST only** — Enterprise hosts, alternate API roots, GraphQL, proxies, and custom trust policies are unsupported.
- **No automatic `confirm-not-created` proof** — after an uncertain create request, a missing search result cannot prove absence and the create endpoint does not preallocate an Issue number; the lower-level Delivery transition therefore remains human-authorized until a future Host proof source exists.
- **The complete Issue body is capped at 64 KiB** — oversized rendered requirements fail before publication rather than being truncated.
- **Repository mapping stays with the Host Consumer** — this library consumes a target lookup capability and does not own settings, discovery, RBAC, or multi-host leases.
- **Issue creation only** — configured labels may accompany creation; milestones, comments, Projects, PR creation, merge, close, and bidirectional synchronization remain outside this package.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
