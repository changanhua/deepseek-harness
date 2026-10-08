---
description: "从 Host 原始证据和独立 verifier Profile 生产并保留有边界的决策。"
kind: "package-reference"
---

# @changanhua/dsh-eval-gates-local

[English](README.md) | 中文

## 概述

本生产者通过 createEvalGateSnapshotReader 读取原始 Queue、证据和 Budget 记录，在独立 dsh Profile 中运行固定检查器，并将准确报告、源快照、输入、Host 观测和策略与决策一起保存。同一 Workspace、run 和策略的并发评估串行处理。

## 目录

- [使用方式](#use-this-package)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用方式

可信 Host 组合提供明确的策略、账本及保留期限边界、快照能力和 createLocalVerifierExecution。运行器需要 Subprocess。每个策略锁定完整物理核心目录、启动器和 Profile。锁定目录中的 eval-core.json 提供与批准构建来源一致的 sourceCommit；产物摘要独立标识实际全部字节，不以源代码检查点代替。不会把任务仓库提交冒充 verifier 核心来源。

读取已保留的 pass 时，会根据存储的源快照核验原始输入、批准报告、完整 cell 覆盖、派生 Manifest 和证据回执。材料缺失或不匹配会阻止读取，不会保留缺乏依据的 pass。

<a id="further-exploration"></a>
## 进一步阅读

- [包组](../README.zh.md)
- [Eval 契约](../../../docs/subsystems/eval.zh.md)
- [架构](../../../docs/architecture.zh.md)

<a id="model-experience"></a>
## 模型体验

无；本包不增加模型提示词或工具。

#### KV Cache 影响

既有 Session 前缀保持不变；续跑时只追加本轮输入。检查器不发起模型请求。

## 已知限制与后续工作

不发布 invariant companion，因为公开状态直接派生自已有 owner 或唯一账本，没有独立缓存的投影。

<a id="known-limitations-and-deferred-work"></a>

- 首版检查器支持 output-equals 和 output-contains，并在需要时检查捕获的 Grader PASS。尚不支持基线和 session-snapshot 条件。核心来源由已批准的可信构建提供，不由本检查器独立认证。Verifier 世界保留私有文件供检查；不提供自动清理或文件系统总配额。公共视图直接来自唯一账本和当前源读取，因此本生产者不发布 invariant companion。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
