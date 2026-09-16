---
description: "Session-persistent BrowserTask evidence, action, resource, authority, delegation, and acceptance state."
kind: "package-reference"
---

# @changanhua/dsh-browser-task

English | [中文](README.zh.md)

## Summary

`@changanhua/dsh-browser-task` is the Session-backed domain authority for one browser task. Every closed-operation mutation writes a complete `browser-task/change` post-state; the projection can therefore replay after a Host restart without a process-local task map. A Session may start the next task only after the former task is terminal, and a durable source sequence prevents replaying the same input as a new task.

It deliberately separates page evidence, exact target binding, action receipts, resource disposition, authority snapshots, delegation and acceptance. Evidence binds a real Session fact or Browser receipt, page target and capability epoch. A resource is reserved before dispatch; `delivery:not-sent` may release that reservation without pretending a page clear occurred. An observed action or completed delegated job is not task completion. Completion requires checker-backed current evidence for every clause, no unresolved writes or blockers, budgets that were never exceeded, and every page resource released or confirmed vanished. Retained ownership remains fail-closed until a dedicated owner-decision fact exists.

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
- User-retained page resources are not accepted as final in V1; release or confirmed document replacement is required.
- Real DeepSeek-v4.1-flash extension acceptance depends on the configured deployment and is tracked separately from package tests.

<a id="dev-note"></a>
### Dev Note

The Session event types and projection fold in [source](src/index.ts) own the durable vocabulary; tool-browser only supplies the continuation and checker consumer.
