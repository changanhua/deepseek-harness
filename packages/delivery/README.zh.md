---
description: "Queue 无关的 Personal Delivery 约定、本地 provider、Queue 集成与浏览器 workbench 包。"
kind: "package-group"
---

# packages/delivery

[English](README.md) | 中文

## 摘要

Delivery 组提供 Queue 无关的持久 protocol、三个 host Service Definition、本地 provider、受治理的 Codex execution、独立 verification、Queue 集成、GitHub Issue intake 与浏览器 Remote，用于不可变需求、有界 Packet、repository authority、evidence 和人工决定。Personal Delivery bundle 把这些包组合成本地 Windows 产品。

## 目录

- [包](#packages)
- [产品组合](#product-composition)
- [相关文档](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## 包

只有三个 Service Definition 包声明 Cordis context key。具体 provider 满足这些 key；Consumer 让 Queue、Git、evidence、浏览器与 executor authority 留在各自 owning package。

| 包 | 当前 surface | ctx key |
|---|---|---|
| [`delivery-protocol`](delivery-protocol/README.zh.md) | 可用的 Queue 无关持久类型、严格 schema、规范 identity、readiness 派生与 fixture | — |
| [`delivery`](delivery/README.zh.md) | 可用的抽象 domain 操作，覆盖 Contract revision、派生 Packet、dispatch binding 与人工决定 | `ctx.delivery` |
| [`repo-workspace`](repo-workspace/README.zh.md) | 可用的抽象 repository base/blob proof、revision/range 检查与自有 checkout lease | `ctx.repoWorkspace` |
| [`delivery-evidence`](delivery-evidence/README.zh.md) | 可用的抽象不可变发布、id 解析、完整性校验读取与 provenance 绑定 | `ctx.deliveryEvidence` |
| [`delivery-testkit`](delivery-testkit/README.zh.md) | Consumer 测试可用的具体 fake 与每次返回新副本的 Protocol fixture | — |
| [`delivery-local`](delivery-local/README.zh.md) | Storage Domain-backed 不可变 record、projection、binding 与 decision | 提供 `ctx.delivery` |
| [`repo-workspace-git-local`](repo-workspace-git-local/README.zh.md) | Git/Subprocess repository proof 与 Attempt-owned change/verification worktree | 提供 `ctx.repoWorkspace` |
| [`delivery-evidence-local`](delivery-evidence-local/README.zh.md) | 本地 content-addressed publication 与完整性校验 evidence read | 提供 `ctx.deliveryEvidence` |
| [`delivery-runner-codex`](delivery-runner-codex/README.zh.md) | 生成 checkpoint 与 evidence 的受治理 Codex app-server change runner | — |
| [`delivery-verifier`](delivery-verifier/README.zh.md) | 带 path 与 evidence finding 的独立 fixed-argv verifier | — |
| [`delivery-github-intake`](delivery-github-intake/README.zh.md) | 严格 Work Brief 解析与显式 GitHub Issue-to-Case import | — |
| [`delivery-github-publisher`](delivery-github-publisher/README.zh.md) | Host-only Issue rendering、publication、uncertainty 与 GET reconciliation | — |
| [`delivery-remote`](delivery-remote/README.zh.md) | 浏览器安全 projection 与显式 import、publish、run、verify、evidence 和 decision operation | `remote.delivery` |
| [`delivery-task-queue`](delivery-task-queue/README.zh.md) | 拥有两个 WorkKind、持久跨 store admission、recovery 与 handler registration | — |

-----

<a id="product-composition"></a>
## 产品组合

本组之外的两个包负责渲染与组合产品，但不添加另一个 Delivery authority。

| 包 | 当前 surface |
|---|---|
| [`client/ui-delivery`](../client/ui-delivery/README.zh.md) | 基于浏览器安全 Remote projection 的五 lane Delivery workbench |
| [`bundle/personal-delivery`](../bundle/personal-delivery/README.zh.md) | 完整 Host、Queue、Remote 与 UI 链路的本地 Windows composition |

-----

<a id="related-documentation"></a>
## 相关文档

- [Delivery subsystem](../../docs/subsystems/delivery.zh.md) — public protocol object、三个 service、lifecycle ownership、readiness 和 limitation。
- [Personal Delivery MVP](../../docs/specs/2026-08-29-personal-delivery-mvp.md) — 有界用户流程和验收场景。
- [Delivery Protocol V1](../../docs/specs/2026-08-29-delivery-protocol-v1.md) — provider 与集成实现必须保持的持久语义和恢复规则。
- [Personal Delivery 架构提议](../../.agents/notes/proposed/architecture/2026-08-29-personal-delivery-above-queue.zh.md) — Delivery 为何组合在 Queue 之上以及各包为何保持分离。

-----

<a id="dev-note"></a>
## Dev Note

None.
