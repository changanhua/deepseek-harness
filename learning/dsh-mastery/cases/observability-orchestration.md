# Case Study — Observability / Durable Orchestration

## Problem Only

研究复杂 Agent 系统中时间、事件、持久化、并发、恢复和可观测性如何共同决定“系统事实”。

本 case 可以使用 Work Observatory、durable planning job / worker 等历史设计作为材料，但必须先独立建立 invariants。

## Independent Reconstruction

先写出：

- 哪些时间指标需要 union / intersection / host authority；
- 哪些事件必须幂等；
- 哪些状态必须 durable；
- worker / attempt / lease 如何避免 split brain；
- UI/metrics 如何保持 projection 身份。

## Source Investigation

读取当前相关本地实现与官方 precedent，重点比较设计语义，而不是代码风格。

## Review Focus

- 时间语义是否定义清楚；
- replay 是否改变结果；
- 多 worker 是否存在竞态；
- 过期 lease、start deadline、heartbeat 是否相互污染；
- observability 是否反过来成为业务 truth；
- recovery 是否只覆盖 happy path。

## Evidence Required

- `invariant_set`
- `concurrency_or_time_semantics_review`
- `architecture_tradeoff_report`
