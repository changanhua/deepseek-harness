---
description: "面向来源可追溯的可编辑知识库、其持久生成 Queue 桥接，以及 DSH 工具和命令入口的 knowledge 包组。"
kind: "package-group"
---

# knowledge/ — 基于来源的知识库

[English](README.md) | 中文

## Summary

此包组让 DSH Profile 从有版本的来源构建可编辑知识库、检查结果，并在用户选择时发布通过检查的版本，或将当前条目维护在思源。业务包拥有 Domain 记录、来源快照、版本导出和发布证据；Queue 桥接拥有持久的 Codex 阶段执行；bundle 提供工具和 `/knowledge` 命令。可选思源投影拥有可编辑文档映射和接纳观测。同一受信 Profile 内的项目由其会话共享，本包组不提供 session 私有 ACL。配置、失败处理和模型可见细节请查看各包页面。

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

这些包分别负责持久内容、执行恢复，以及人工或模型请求。

| Package | Role |
|---|---|
| [`knowledge-base`](knowledge-base/README.zh.md) | 保存项目事实、来源快照、可编辑条目或思源映射、不可变产物、检查和发布物。 |
| [`knowledge-base-task-queue`](knowledge-base-task-queue/README.zh.md) | 通过持久本地 Queue 运行已准备的知识阶段，并恢复已验证结果。 |
| [`tool-knowledge-base`](tool-knowledge-base/README.zh.md) | 增加知识 bundle、`knowledge_base` 模型工具和可选的 `/knowledge` 命令。 |

<a id="related-documentation"></a>
## Related documentation

- [Package map](../README.zh.md) — 仓库的包族与组合约定。
- [Storage subsystem](../../docs/subsystems/storage.zh.md) — Domain 持久化和后端选择。
- [知识子系统](../../docs/subsystems/knowledge.zh.md) — 业务值和阶段/发布身份。
- [Application launch](../../docs/architecture.zh.md) — 受支持的 `dsh --profile` 入口。

<a id="dev-note"></a>
## Dev Note

[使用原生 Codex 执行的知识库](../../.agents/notes/implemented/feature/2026-09-08-knowledge-base-native-codex.zh.md)。
