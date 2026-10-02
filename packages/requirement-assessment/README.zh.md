---
description: "独立的需求投资评估与不可变证据历史。"
kind: "package-group"
---

# packages/requirement-assessment

[English](README.md) | 中文

## 概述

需求投资评估独立于 Planning 保存有界、建议性的投资判断。它固定被评估的输入与基线，记录不确定性，并保留每份已完成结果。

## 包

- [requirement-assessment](requirement-assessment/README.zh.md) 拥有领域 schema 与可信 Host 服务。
- [requirement-assessment-local](requirement-assessment-local/README.zh.md) 提供本地原子持久化与评估器调用预留。
- [requirement-assessment-review](requirement-assessment-review/README.zh.md) 固定授权输入并运行隔离的 Quick Review。
- [requirement-assessment-remote](requirement-assessment-remote/README.zh.md) 提供已认证的人类请求与读取时的 drift 投影。

## 相关文档

- [需求评估子系统](../../docs/subsystems/requirement-assessment.zh.md) 描述权限与评估生命周期。
- [Planning 子系统](../../docs/subsystems/planning.zh.md) 拥有 canonical Plan 与 Focus。

## 开发说明

评估 route 只是建议，不授予修改 Planning 或分派执行的权限。
