---
description: "Domain artifacts, provider discovery and FC27 read-only candidate planning."
kind: "package-group"
---

# packages/domain-runtime

[English](README.md) | 中文

## 摘要

读取不可变领域观察并生成候选方案，不执行业务写入。通用包将工件读取路由给各自所有者；FC 包编译并持久化 FC 观察与方案。工具包向智能体提供类型化 FC 操作。本组任何包都不授予批准或执行方案。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| Package | Role | ctx key |
|---|---|---|
| [`domain-runtime`](domain-runtime/README.zh.md) | 按 provider 路由元数据与工件读取 | `ctx.domainArtifacts` |
| [`fc-sbc-domain`](fc-sbc-domain/README.zh.md) | FC 所有的不可变 Reality 与 Plan 持久化 | `ctx.fcSbcDomain` |
| [`tool-fc-sbc-domain`](tool-fc-sbc-domain/README.zh.md) | 类型化 inspect、plan、status 模型工具 | `ctx.tools` 消费方 |

<a id="related-documentation"></a>
## 相关文档

- [Domain Runtime 子系统](../../docs/subsystems/domain-runtime.zh.md) — 身份、覆盖与派生关系合同。
- [Storage 子系统](../../docs/subsystems/storage.zh.md) — 所有者持久化。
- [所有权决策](../../.agents/notes/implemented/architecture/2026-09-30-domain-runtime-artifact-owners.zh.md) — 边界与替代方案。

<a id="dev-note"></a>
## 开发备注

无。
