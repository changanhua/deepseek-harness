---
description: "Project-memory contracts for callers storing, reviewing, and recalling source-backed claims."
kind: "package-reference"
---

# @changanhua/dsh-memory

English | [中文](README.zh.md)

## Summary

Use this Definition to propose reusable project claims, read currently usable memory, and record exact human decisions through a selected provider. A candidate does not become active merely because an agent generated it. Acceptance and source validity are separate facts.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Consumers depend on this package and use `ctx.projectMemory`; the composition mounts a concrete provider such as [memory-local](../memory-local/README.md). The abstract class has no configuration and is not a complete application composition.

The [subsystem reference](../../../docs/subsystems/project-memory.md) owns record fields, decision authority, idempotency, and recall semantics. Callers supply the initiating Agent; project identity and human authority cannot come from model arguments.

<a id="understand-the-implementation"></a>
## Understand the implementation

The [schemas](src/schema.ts) validate source locators separately from observed source fingerprints. Durable record validation reconstructs active and pending pointers from ordered receipts and human decisions, rejects orphaned revisions, and checks immutable history identities. The [service](src/index.ts) separates ordinary recall from command-authorized history inspection.

<a id="model-experience"></a>
## Model Experience

None, as this Definition registers no tools or prompts and consumers own rendered memory results.

#### KV Cache effect

None, because this package does not assemble model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The Definition does not supply storage, automatic extraction, semantic retrieval, or external knowledge synchronization.
- Human acceptance permits reuse; it does not certify that the claim is true or override current user instructions.

<a id="dev-note"></a>
### Dev Note

None.
