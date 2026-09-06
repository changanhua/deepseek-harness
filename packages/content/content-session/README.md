---
description: "Verified completed-session message sources for Content capture."
kind: "package-reference"
---

# @changanhua/dsh-content-session

English | [中文](README.zh.md)

## Summary

This Host-only Cordis service resolves one completed assistant message into the verified source required by Content capture. It has no configuration and registers no Remote method, model tool, or model context.

## Use this package

Mount it with `dsh-session-query`. A trusted consumer passes its access callback and request cancellation signal to `resolve()`, then gives that resolver to `Content.capture()`.

The request's `messageId` is the canonical decimal sequence of an `assistant/message` event. The service accepts only appended, non-interrupted messages with one or more text blocks and a non-empty concatenated body. It does not trim or normalize text.

## Behavior

The service reads with `sessionQuery.readSession(id)`, which replay-validates the complete logical log and returns a detached snapshot; caller cancellation races that read. It never resumes or activates an Agent. Sessions without a working directory are hidden; subagent-origin sessions are forbidden. Authorization runs before and after the read.

The resolved source has `captureId` `event:<seq>`, `scope` `full-message`, and `boundary` `completed-text`. Missing sessions report `not_found`; malformed requests report `invalid_request`; incomplete or mixed output reports `invalid_transition`; other read failures report `unavailable`; cancellation reports `closed`.

## Further Exploration

- [Content definition](../content/README.md) — capture contract and persisted records.
- [Session query](../../session-query/session-query/README.md) — live-preferred observation leases.

## Model Experience

None, as this Session source bridge registers no model tools or model context.

#### KV Cache effect

None. Resolving a source does not invoke a model.

## Known Limitations and Deferred Work

- Capture recognizes only text-only assistant messages. Reasoning, tool, image, or future non-text blocks reject the whole message.
- This package reads a durable Session cut. Content owns byte limits, duplicate detection, and persistence.

### Dev Note

No runtime invariant is needed because a resolve call retains no state after its read completes.
