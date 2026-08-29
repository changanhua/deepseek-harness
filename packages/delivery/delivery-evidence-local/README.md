---
description: "Local immutable evidence bytes for maintainers composing evidence-backed Personal Delivery."
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-evidence-local

English | [中文](README.zh.md)

## Summary

`dsh-delivery-evidence-local` is the reserved local provider for `ctx.deliveryEvidence`. Its storage boundary covers atomic publication of bounded logs, Git facts, patches, checkpoint metadata, verification output, screenshots, and Resume Capsules as immutable content-addressed bytes.

The local `root` configuration is a stable composition contract. Save, resolve, and read currently fail with explicit unavailable errors; no reference is returned before immutable bytes can be committed and verified.

## Configuration

`root` is a private directory for content-addressed objects. The provider derives the evidence id, URI, byte length, SHA-256 digest, and creation time; callers supply only the bytes, label, and already-bound provenance.

## Integrity boundary

`save()` publishes bytes before returning their `EvidenceRef`. `read()` must verify identity, size, and digest rather than trusting the durable reference alone. Queue stores references, not these bytes.

## Dev Note

Do not broaden this delivery-specific store into a generic artifact platform without another concrete consumer and a retention decision.

## Model Experience

### No direct model context

#### What the model sees

Nothing directly. The provider implements host-side `ctx.deliveryEvidence` storage and does not register prompts, tools, or resources.

#### Token effect

Zero direct tokens; evidence bytes remain artifacts unless a separate caller deliberately selects them for model input.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Evidence storage is unavailable** — atomic publication, metadata resolution, verified reads, immutable naming, bounded inputs, and corruption tests remain unimplemented.
