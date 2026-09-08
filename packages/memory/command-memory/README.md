---
description: "Human project-memory review, source previews, exact-revision acceptance, rejection, and withdrawal."
kind: "package-reference"
---

# @changanhua/dsh-command-memory

English | [中文](README.zh.md)

## Summary

The `/memory` command lets a user inspect project memory and its sources, decide on one exact revision, and withdraw accepted claims. It runs through Commands without starting a model turn. Each decision is tied to the admitted command's durable identity.

## Table of Contents

- [Use this package](#use-this-package)
- [Implementation](#implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

<a id="use-this-package"></a>

Mount it with Commands and a project-memory provider, or use the [personal-memory bundle](../../bundle/personal-memory/README.md). `maxOutputBytes` defaults to 16384 and accepts 1024–16384 bytes for the complete command result.

| Command | Result |
| --- | --- |
| `/memory` or `/memory list [page]` | Stable pages of 20 project memory identities and statuses |
| `/memory show <id>[@revision]` | Candidate and active content, or one historical version, with source previews |
| `/memory accept <id>@<revision>` | Accept or reconfirm that exact revision after source checks |
| `/memory accept <id>@<revision> --review-after <ISO-time>` | Set an explicit future UTC review deadline, such as `2099-09-08T00:00:00Z` |
| `/memory reject <id>@<revision>` | Reject a pending candidate |
| `/memory retire <id>@<revision>` | Withdraw an active revision while retaining history |

Changed or unavailable sources prevent acceptance. A stale decision target fails rather than selecting a newer revision. No command bulk-accepts candidates or overrides their source checks.

## Implementation

<a id="implementation"></a>

[Parsing](src/parse.ts) accepts only the command grammar. The handler derives the record-version fence from a human-authorized inspection and sends the exact invocation id to the provider. [Rendering](src/render.ts) quotes memory and source text, bounds the complete result, and exposes historical version navigation. Direct handler invocation without the corresponding active Commands record is denied by the provider.

## Model Experience

None, as this human command renders directly through Commands without adding model prompts or tools.

#### KV Cache effect

None, because command results do not modify a model request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Withdrawal retains history and does not erase Session logs or source documents.
- Oversized inspection output requires choosing one memory revision; partial claim bodies are not returned.
- Acceptance permits reuse and does not certify factual truth.

### Dev Note

None.
