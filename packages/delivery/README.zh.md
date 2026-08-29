---
description: "Queue 无关的 Personal Delivery 约定、三个 host Service Definition、测试 fake 与故障关闭的集成包边界。"
kind: "package-group"
---

# packages/delivery

[English](README.md) | 中文

## 摘要

Delivery 组提供 Queue 无关的持久 protocol、三个抽象 host Service Definition，以及符合约定的测试 fake，用于不可变需求、有界 Packet、repository authority、evidence 和人工决定。其余包保留狭窄的 provider 与集成边界，具体行为不可用时会故障关闭。这组包目前并未组装可运行的 Personal Delivery 产品。

## 目录

- [包](#packages)
- [产品组合](#product-composition)
- [相关文档](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## 包

只有三个 Service Definition 包声明 Cordis context key。保留的 provider 可以在 composition 时满足该 key，但仍可以拒绝所有操作；因此下表区分包 identity 与可用行为。

| 包 | 当前 surface | ctx key |
|---|---|---|
| [`delivery-protocol`](delivery-protocol/README.zh.md) | 可用的 Queue 无关持久类型、严格 schema、规范 identity、readiness 派生与 fixture | — |
| [`delivery`](delivery/README.zh.md) | 可用的抽象 domain 操作，覆盖 Contract revision、派生 Packet、dispatch binding 与人工决定 | `ctx.delivery` |
| [`repo-workspace`](repo-workspace/README.zh.md) | 可用的抽象 repository base/blob proof、revision/range 检查与自有 checkout lease | `ctx.repoWorkspace` |
| [`delivery-evidence`](delivery-evidence/README.zh.md) | 可用的抽象不可变发布、id 解析、完整性校验读取与 provenance 绑定 | `ctx.deliveryEvidence` |
| [`delivery-testkit`](delivery-testkit/README.zh.md) | Consumer 测试可用的具体 fake 与每次返回新副本的 Protocol fixture | — |
| [`delivery-local`](delivery-local/README.zh.md) | 保留的 Storage provider；每项读写都以 unavailable 拒绝 | 提供 `ctx.delivery` |
| [`repo-workspace-git-local`](repo-workspace-git-local/README.zh.md) | 保留的 Git/Subprocess provider 与配置；每项 repository 操作都以 unavailable 拒绝 | 提供 `ctx.repoWorkspace` |
| [`delivery-evidence-local`](delivery-evidence-local/README.zh.md) | 保留的本地 evidence provider 与配置；save、resolve 与 read 都以 unavailable 拒绝 | 提供 `ctx.deliveryEvidence` |
| [`delivery-runner-codex`](delivery-runner-codex/README.zh.md) | 固定使用受支持 Codex app-server 子路径的类型化 factory；返回的 run 以 unavailable 拒绝 | — |
| [`delivery-verifier`](delivery-verifier/README.zh.md) | 类型化 fixed-plan verifier factory；返回的 run 以 unavailable 拒绝 | — |
| [`delivery-github-intake`](delivery-github-intake/README.zh.md) | 校验精确的公开 Issue URL 语法，然后以 unavailable 拒绝 snapshot 导入 | — |
| [`delivery-remote`](delivery-remote/README.zh.md) | 保留六个类型化 `delivery` Remote method；每个 method 都以 unavailable 拒绝 | — |
| [`delivery-task-queue`](delivery-task-queue/README.zh.md) | 拥有两个 WorkKind 声明与可用的纯 admission helper；plugin handler 注册以 unavailable 拒绝 | — |

-----

<a id="product-composition"></a>
## 产品组合

本组之外的两个包保留浏览器与 composition identity，不添加另一个 Delivery authority。两者都不会使产品可运行。

| 包 | 当前 surface |
|---|---|
| [`client/ui-delivery`](../client/ui-delivery/README.zh.md) | 空的 node 与浏览器插件；不注册 slot、Remote 调用、locale 或可见 workbench |
| [`bundle/personal-delivery`](../bundle/personal-delivery/README.zh.md) | 空 patch 载体；不激活 provider、Queue bridge、Remote 或浏览器插件 |

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
