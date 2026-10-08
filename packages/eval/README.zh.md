---
description: "评测包组：确定性回归约定与无密钥快照执行，供选择或扩展 DSH 评测的读者使用。"
kind: "package-group"
---

# eval/ — 确定性回归评测

[English](README.md) | 中文

## 概述

eval 包组支持录制回归比较和 Host 准入的隔离评估。`eval` 拥有严格的套件/运行值、顺序执行、结果折叠与报告。`eval-session-snapshot` 驱动无密钥 ACP 回放；`eval-isolated` 在锁定核心下运行独立 Subject 和 Grader Agent。录制、回放派生与快照归一化仍由测试支持包拥有。

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
| [`eval-plans`](eval-plans/README.zh.md) | 可信来源与准入契约 |
| [`eval-plans-local`](eval-plans-local/README.zh.md) | Host 固定文件、运行时预检与持久准入 |
| [`command-eval-plan`](command-eval-plan/README.zh.md) | 人工发现、预检与准入 |
| [`eval-repo-workspace`](eval-repo-workspace/README.zh.md) | 已验证 commit 与 Queue Attempt 工作目录桥接 |
| [`eval-isolated`](eval-isolated/README.zh.md) | Windows 隔离的 Subject/Grader 执行与认证证据交接 |
| [`eval-runs`](eval-runs/README.zh.md) | 持久 run 控制契约 |
| [`eval-runs-local`](eval-runs-local/README.zh.md) | 基于 Queue 的恢复和私有证据 |
| [`eval-gates`](eval-gates/README.zh.md) | 独立决策及有效性契约 |
| [`eval-gates-local`](eval-gates-local/README.zh.md) | 保留 Host 决策并启动 verifier |
| [`eval-verifier`](eval-verifier/README.zh.md) | 固定的确定性检查器 Profile |
| [`eval-activation`](eval-activation/README.zh.md) | 显式一次性续跑契约 |
| [`eval-activation-local`](eval-activation-local/README.zh.md) | 持久认领 Grant 并续跑一轮 Goal |
| [`eval-app`](eval-app/README.zh.md) | CLI 运行、决策和续跑消费者 |

仓库内的 [`minimal-v1` 套件](eval-session-snapshot/suites/minimal-v1/suite.json)提供十个 Case 和二十个独立路由 fixture，作为首个可复现比较。

<a id="related-documentation"></a>
## 相关文档

- [确定性 Eval 决策](../../.agents/notes/implemented/architecture/2026-08-31-deterministic-eval-contract-and-snapshot-adapter.zh.md)——包归属、证据分类与被否决的替代方案。
- [Eval 契约](../../docs/subsystems/eval.zh.md)——意图、记录的执行身份与决策一致性。
- [ACP 快照测试](../../.agents/notes/implemented/testing/2026-06-19-acp-snapshot-tests.zh.md)——录制、回放、归一化与应用启动 owner。

<a id="dev-note"></a>
## 开发备注

无。
