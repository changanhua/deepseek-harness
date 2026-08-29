---
description: "Personal Delivery browser Remote for users importing, running, verifying, and deciding one delivery."
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-remote

English | [中文](README.zh.md)

## Summary

`dsh-delivery-remote` implements the browser-safe `ctx.remote.delivery` namespace, its derived workbench projection, and six explicit operations without exposing raw Queue enqueue authority, filesystem paths, process handles, credentials, or a generic shell.

The snapshot joins one Delivery read with the trusted operator's Queue view into five derived lanes. Every asynchronous operation accepts an operation-local `AbortSignal`; stable Typert failures classify expected domain refusals without copying arbitrary infrastructure text into the browser.

## Contents

- [Remote methods](#remote-methods)
- [Authority boundary](#authority-boundary)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Remote methods

- `snapshot()` returns Contract revisions without Packets and Packet cards derived into Ready, Running, Review, Blocked, or Accepted lanes.
- `importIssue(input, signal)` explicitly adopts the current revision of one GitHub Issue URL for the required configured repository. The Issue's strict Work Brief owns Contract fields, while the host derives any previous revision; neither base/plan substitution nor lineage is browser input.
- `createPacket(input, signal)` accepts only the selected Contract and bounded Packet draft. The host resolves repository identity, base proof, and verification source from the immutable Contract, then derives the idempotency key from Contract identity and the canonical Packet digest.
- `startChange(input, signal)` delegates the idempotent binding and ownerless Queue admission to the Delivery/Queue bridge.
- `startVerification(input, signal)` accepts a Packet and its bound change dispatch; the host derives the exact checkpoint and trusted verification plan before admission.
- `readEvidence(input, signal)` accepts one existing evidence id, integrity-reads it through Delivery Evidence, and returns safe metadata plus base64 bytes without its provider URI.
- `recordDecision(input, signal)` accepts a human decision and the selected bound change and verification dispatches. The host resolves their Queue results, trusted Host configuration supplies the actor, and the host derives the idempotency key from the decision nonce and resolved immutable target.

The `./types` export contains the JSON wire declarations. Generated `./typert` and `./remote` entries carry the host and browser faces.

## Authority boundary

The Remote injects `delivery`, `deliveryEvidence`, `repoWorkspace`, and `taskQueue`, but does not make browser input authoritative. Git proves commits, Queue owns execution, and evidence storage resolves and integrity-reads every exact referenced object. In this single-user MVP, trusted Host configuration supplies a non-blank `operatorId` (default `local-operator`) as the decision actor; `actorId` is never a browser field. Only the human decision endpoint may request an acceptance record. Browser inputs contain selections rather than authority-bearing identities, raw Queue payloads, host paths, provider URIs, or caller-defined idempotency keys.

## Dev Note

Keep the five lanes derived. Do not add a writable status or expose generic Queue operator authority to the browser.

## Model Experience

### No direct model context

#### What the model sees

Nothing directly. The `delivery` Remote namespace exposes browser RPC methods but no prompts, tools, or resources.

#### Token effect

Zero direct tokens; Typert transport payloads are browser control data rather than model input.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Composition remains external** — a supported profile must compose the Delivery domain, evidence, repository workspace, Queue bridge, Typert transport, this Remote, and a concrete GitHub intake provider before a real browser flow can run.
- **Single trusted operator** — `operatorId` is Host configuration rather than browser input or a multi-user authentication claim.
