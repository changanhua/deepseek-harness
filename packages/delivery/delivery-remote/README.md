---
description: "Personal Delivery browser Remote for users importing, publishing, running, verifying, and deciding one delivery."
kind: "package-reference"
---

# @changanhua/dsh-delivery-remote

English | [中文](README.zh.md)

## Summary

`dsh-delivery-remote` implements the browser-safe `ctx.remote.delivery` namespace for shaping, approving, publishing, executing, verifying, and accepting Delivery Cases without exposing raw Queue authority, filesystem paths, process handles, credentials, or a generic shell.

The snapshot joins one Delivery read with the trusted operator's Queue view into six derived Case phases, downstream Packet cards, readiness reasons, and safe publication state. Every asynchronous operation accepts an operation-local `AbortSignal`; stable Typert failures classify expected domain refusals without copying arbitrary infrastructure text into the browser.

## Contents

- [Remote methods](#remote-methods)
- [Authority boundary](#authority-boundary)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="remote-methods"></a>

## Remote methods

- `snapshot()` returns ordered Case cards with their head revision, readiness, requirement decision, configured publication target, safe publication state, and downstream Packet cards. Human actor ids, publication markers, digests, and failure details remain Host-only.
- `createCase(input, signal)` creates one human-origin Case in the Host-configured `repositoryId`; the browser supplies requirement content but no repository, actor, identity, or idempotency field.
- `reviseCase(input, signal)` advances one observed Case head through the Delivery compare-and-set boundary and returns the browser-safe child revision.
- `recordRequirementDecision(input, signal)` records approval, rejection, or deferral for one exact revision. Trusted Host configuration supplies the actor, and the Host derives the decision nonce and idempotency key.
- `importIssue(input, signal)` explicitly imports the current revision of one GitHub Issue URL into a Case for the required configured repository. The Issue's strict Work Brief owns requirement fields, while the Host derives Case lineage; neither base/plan substitution nor lineage is browser input.
- `publishIssue(input, signal)` accepts one Case and revision selection. The Host resolves `githubTargets[repositoryId]`, re-resolves its credential reference for this operation, and delegates the durable external side-effect boundary to the GitHub publisher.
- `resolvePublication(input, signal)` accepts one uncertain publication and candidate Issue number. The Host performs a fresh authenticated GET and confirms `published` only after the exact terminal marker and digest match.
- `createPacket(input, signal)` accepts only the selected Contract and bounded Packet draft. The host resolves repository identity, base proof, and verification source from the immutable Contract, then derives the idempotency key from Contract identity and the canonical Packet digest.
- `startChange(input, signal)` delegates the idempotent binding and ownerless Queue admission to the Delivery/Queue bridge.
- `startVerification(input, signal)` accepts a Packet and its bound change dispatch; the host derives the exact checkpoint and trusted verification plan before admission.
- `readEvidence(input, signal)` accepts one existing evidence id, integrity-reads it through Delivery Evidence, and returns safe metadata plus base64 bytes without its provider URI.
- `recordDecision(input, signal)` accepts a human decision and the selected bound change and verification dispatches. The host resolves their Queue results, trusted Host configuration supplies the actor, and the host derives the idempotency key from the decision nonce and resolved immutable target.

The `./types` export contains the JSON wire declarations. Generated `./typert` and `./remote` entries carry the host and browser faces.

<a id="authority-boundary"></a>

## Authority boundary

The Remote injects `credentials`, `delivery`, `deliveryEvidence`, `repoWorkspace`, and `taskQueue`, but does not make browser input authoritative. Git proves commits, Queue owns execution, evidence storage resolves and integrity-reads every exact referenced object, and the publisher owns GitHub request uncertainty. Trusted Host configuration supplies a non-blank `operatorId` (default `local-operator`), one `repositoryId` for new human Cases (default `workspace`), and optional `githubTargets` entries keyed by Delivery repository id; each target carries owner, repository name, a credential reference, and optional Issue labels, never a token value. Browser inputs contain bounded content and selections rather than authority-bearing identities, raw Queue payloads, host paths, provider URIs, publication markers, digests, credentials, or caller-defined idempotency keys.

<a id="dev-note"></a>

## Dev Note

Keep Case phases, Packet lanes, readiness, and publication presentation derived. Do not add a writable status or expose generic Queue operator authority to the browser.

## Model Experience

### No direct model context

#### What the model sees

Nothing directly. The `delivery` Remote namespace exposes browser RPC methods but no prompts, tools, or resources.

#### Token effect

Zero direct tokens; Typert transport payloads are browser control data rather than model input.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Composition remains external** — a supported profile must compose credentials, the Delivery domain, evidence, repository workspace, Queue bridge, Typert transport, this Remote, and the GitHub intake/publisher libraries before a real browser flow can run.
- **Single trusted operator** — `operatorId` is Host configuration rather than browser input or a multi-user authentication claim.
- **Publication target configuration is static per Host activation** — editing `githubTargets` requires recomposition; credentials themselves are re-resolved for every operation.
