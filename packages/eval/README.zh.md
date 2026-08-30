---
description: "评测包组：确定性回归约定与无密钥快照执行，供选择或扩展 DSH 评测的读者使用。"
kind: "package-group"
---

# eval/ — 确定性回归评测

[English](README.md) | 中文

## 概述

eval 包组让调用方无需 judge 模型即可比较录制的 DSH 行为。`eval` 拥有严格的套件/运行值、顺序执行、结果折叠与报告。`eval-session-snapshot` 通过现有无密钥 ACP 快照 harness 驱动这些 case。录制、回放派生与快照归一化仍由测试支持包拥有。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

除非评测必须启动 DSH 应用并比较持久化 session 日志，否则请选择纯约定库。

| 包 | 职责 |
|---|---|
| [`eval`](eval/README.zh.md) | 严格的套件与运行、顺序执行、四类结果折叠和稳定报告 |
| [`eval-session-snapshot`](eval-session-snapshot/README.zh.md) | 无密钥 ACP 回放执行器与归一化 session 日志比较 |

仓库内的 [`minimal-v1` 套件](eval-session-snapshot/suites/minimal-v1/suite.json)提供十个 Case 和二十个独立路由 fixture，作为首个可复现比较。

<a id="related-documentation"></a>
## 相关文档

- [确定性 Eval 决策](../../.agents/notes/implemented/architecture/2026-08-31-deterministic-eval-contract-and-snapshot-adapter.zh.md)——包归属、证据分类与被否决的替代方案。
- [ACP 快照测试](../../.agents/notes/implemented/testing/2026-06-19-acp-snapshot-tests.zh.md)——录制、回放、归一化与应用启动 owner。

<a id="dev-note"></a>
## 开发备注

无。
