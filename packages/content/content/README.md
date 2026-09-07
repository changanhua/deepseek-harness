---
description: "Content schemas and editing contract for original text, immutable versions, drafts and idempotent commands."
kind: "package-reference"
---

# @changanhua/dsh-content

English | [中文](README.zh.md)

## Summary

Keep saved text intact while editing a separate draft. Consumers use one shared schema for records and commands, and distinguish a confirmed save from an unknown response. Trusted host consumers supply authorization and source resolution; saved content does not become an agent capability.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Import the definition to implement a provider or a trusted host consumer. Mount [content-domain](../content-domain/README.md) as the concrete service; the abstract definition is not a standalone storage plugin and has no configuration.

Every read and mutation takes a trusted synchronous authorization callback. The callback must throw when the caller lacks access. Wire adapters derive that callback from the authenticated connection; a request field cannot provide it. Mutations repeat the check at execution, after any asynchronous source preparation. A `save-text` command may retain an unverified provided-text or web-page source; web pages retain their HTTP(S), credential-free URL, page title, site, capture time and optional external message identity. It cannot supply a Host-verified Session source, and `create` accepts no source.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[Schemas](src/schema.ts) derive the record and command types. Stored aggregates preserve original versions, a separate draft and committed command receipts. Strict parsing rejects unknown fields and broken references without normalizing text. Providers additionally verify the SHA-256 digest of each exact UTF-8 body.

[The service](src/index.ts) returns detached data and payload-free errors. Receipt lookup can return an unknown result; that does not authorize a fresh retry identity. Consumers retain the original command until they reconcile its durable outcome.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Content subsystem](../../../docs/subsystems/content.md) — record ownership and shared semantics.
- [Storage provider](../content-domain/README.md) — limits and recovery.
- [Storage subsystem](../../../docs/subsystems/storage.md) — durable record access.

<a id="model-experience"></a>
## Model Experience

None, as this definition does not register model tools or contribute model context.

#### KV Cache effect

No direct effect: storing or editing content adds no model request tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The definition does not supply user entry points.

- Session authorization, remote transport and UI are consumer responsibilities and are not registered by this package.
- Arbitrary same-process plugins remain trusted code; a callback is not a sandbox for malicious plugins.

<a id="dev-note"></a>
### Dev Note

None.
