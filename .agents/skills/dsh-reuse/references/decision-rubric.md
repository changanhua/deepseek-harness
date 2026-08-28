# Reuse decision rubric

Judge semantic ownership before code size. A candidate that supplies 90% of the lines but none of the required durability or authority may be less reusable than a small definition package that owns the correct lifecycle.

## Comparison dimensions

| Dimension | Questions |
| --- | --- |
| Outcome | Does it deliver the same user-visible result? |
| Input and result | Are request validation and terminal results compatible or cheaply adaptable? |
| Authority | Who may start, inspect, cancel, retry, or administer it? |
| Lifecycle | Foreground, process-local live, Session-durable, or host-durable? |
| Side effects | Where is the effect boundary and what is safe after an uncertain crash? |
| Ownership | Who owns execution resources, cleanup, persisted truth, and notification? |
| Composition | Is a real Provider mounted in the target Profile and scope? |
| Performance | Does reuse remove repeated startup, discovery, model, or network cost? |
| Maintenance | Who owns updates, provider drift, and compatibility? |
| Evidence | Current code/test/runtime proof, historical design, or inference? |

## Decision tests

### Direct reuse

Choose this when the candidate owns every non-negotiable dimension. Configuration, enabling a Profile row, or calling an existing method is not a new capability.

### Adapt

Choose this when lifecycle and ownership already match and the missing work is a bounded translation: request fields, result fields, protocol framing, or presentation. Reject `adapt` when the wrapper must recreate retries, persistence, authorization, or cleanup.

### Bridge

Choose this when two complete domains need integration without either becoming aware of the other. A Bridge may inject two Service Definitions and register a reversible contribution, such as a Queue Handler that consumes an image-generation service. Keep Provider selection in the Bundle.

### Vendor/Fork

Choose this for useful community knowledge or implementation that cannot be trusted or integrated unchanged. Require a fixed version, license, recorded source, local changes, restricted tools and side effects, focused evals, and an update procedure. Prefer vendoring a text-only Skill over importing its unrelated generation scripts.

### Build

Choose this only when the missing semantics are essential and remain after the strongest candidate is wrapped honestly. State why a smaller adapter or Bridge would merely relocate the new implementation.

## Extraction test

Extract shared code when the same invariant, lifecycle, or bug fix would otherwise be maintained by multiple current consumers. Keep small independent implementations when their ownership or failure semantics differ. Similar `start`, `done`, or `cancel` methods alone do not justify a universal runtime type.

## Promotion ladder

Let repeated evidence promote a capability rather than starting at the most expensive abstraction:

```text
one-off instructions
→ community Skill
→ pinned project Skill
→ typed adapter or compiler
→ Service Definition + Provider
→ Queue WorkKind when durable execution is required
```

Promotion signals include repeated use, measurable failure, a second consumer, typed integration needs, independent lifecycle, or durable recovery. A hypothetical future consumer is not a promotion signal.
