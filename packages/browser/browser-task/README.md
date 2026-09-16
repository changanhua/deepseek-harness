---
description: "Session-persistent BrowserTask evidence, action, resource, authority, delegation, and acceptance state."
kind: "package-reference"
---

# @changanhua/dsh-browser-task

English | [中文](README.zh.md)

## Summary

`@changanhua/dsh-browser-task` is the Session-backed domain authority for one browser task. Every closed-operation mutation writes a complete `browser-task/change` post-state; the projection can therefore replay after a Host restart without a process-local task map. A Session may start the next task only after the former task is terminal, and a durable source sequence prevents replaying the same input as a new task.

It deliberately separates page evidence, exact target binding, action receipts, resource disposition, authority snapshots, delegation and acceptance. Evidence binds a real Session fact or Browser receipt, page target and capability epoch. Delegation facts retain canonical Subagent run, background Job, or Cordis package/run identities plus bounded output digests; a successful delegation never satisfies acceptance by itself. A `region-content` clause requires the matching render receipt and a fresh page observation of the rendered text, while completion still waits for the region's final cleanup disposition. A resource is reserved before dispatch; `delivery:not-sent` may release that reservation without pretending a page clear occurred. Completion requires checker-backed current evidence for every clause, no unresolved writes or blockers, budgets that were never exceeded, and every page resource released or confirmed vanished. An extension-side acknowledgement of an unknown request releases only its transport lock. A newer direct user message may explicitly cancel the Session task only after every resource has a receipt-backed final disposition; the unknown attempt remains historical fact.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

### Task continuation

#### What the model sees

Consumers expose compact task state and evidence references, not raw page contents. A model uses `browser_task_start` and `browser_task_verify` through the consumer, rather than interacting with this kernel directly.

#### Token effect

Task state is bounded by the kernel's clause, evidence, attempt, resource, delegation, step, and action limits; raw page bodies remain outside this package's model-facing projection.

#### KV Cache effect

Stable task schema and consumer composition preserve the reusable prefix. Changed task state enters only as later consumer output.

## Known Limitations and Deferred Work

- The standard Web composition and `tool-browser` consumer use this service, but no dedicated task-status UI renders its generic Session projection yet.
- An owner cancellation is available only after cleanup and an explicit latest direct-user marker: `[browser-task:cancel]` or `[browser-task:accept-unknown]`. The Agent must ask for that marker when an unknown browser effect needs an owner decision; it cannot infer consent from ordinary prose or assert what the effect did.
- A representative DeepSeek-v4.1-flash extension acceptance completed through the configured standard Web deployment; package tests and live Session evidence remain separately owned.

<a id="dev-note"></a>
### Dev Note

The Session event types and projection fold in [source](src/index.ts) own the durable vocabulary; tool-browser only supplies the continuation and checker consumer.
