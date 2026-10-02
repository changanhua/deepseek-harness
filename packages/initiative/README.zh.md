---
description: "不产生执行权限的 Planning 前共享候选入口。"
kind: "package-group"
---

# packages/initiative

[English](README.md) | 中文

## Summary

人工命令和 scoped Agent 工具创建同一种 durable Candidate。Initiative 拥有 immutable origin、revision、调查事实和晋升关系；不调查、评分、启动 Agent 或派发工作。参见 [Initiative 子系统](../../docs/subsystems/initiative.zh.md)。

## Packages

- [initiative](initiative/README.zh.md)：Service Definition、严格 schema 和品牌化 Candidate 身份。
- [initiative-local](initiative-local/README.zh.md)：单 Host Storage Domain provider、可信身份和仅 pending Proposal 的 Planning 晋升。
- [command-initiative](command-initiative/README.zh.md)：人工直接命令，包含 disposition 与 promotion。
- [tool-initiative](tool-initiative/README.zh.md)：Agent propose、investigate、read 工具，不授予最终处置权限。

## Tutorial: opt-in Web composition

前提：已构建的源码检出、现有 Web/base 服务，以及在 Web UI 中选中的已注册 Workspace。这是本地单操作者功能；Host 需要其他稳定人工标签时，在复制的 patch 中修改 `operatorId`。此标签不认证远程账户。访问同一 Candidate 存储的所有 Host 必须使用同一 ownership 目录。

```sh
pnpm run build
pnpm dsh web --patch "$PWD/packages/bundle/personal-planning/cordis.patch.yml" --patch "$PWD/packages/bundle/personal-planning/initiative.patch.yml"
```

可选 overlay 装载两个 scoped 模型工具及 `/initiative`，不改默认配置。人工在输入框使用下列命令，不触发模型：

```text
/initiative {"action":"propose","key":"audit-delta-1","kind":"simplify","trigger":"The pinned audit ages","facts":{"claim":"Investigate a lighter current-state delta"}}
/initiative {"action":"read"}
```

将返回的 `id`、`recordVersion`、`headVersion` 复制进下一条命令。以下占位符须替换成这些准确值：

```text
/initiative {"action":"investigate","key":"audit-probe-1","id":"CANDIDATE_ID","expectedRecordVersion":1,"expectedVersion":1,"facts":{"claim":"Compare a current-state delta with the existing snapshot audit","uncertainties":["Does repeated maintenance justify new code?"],"evidenceRefs":[{"owner":"repository","kind":"document","id":"docs/audits/2026-10-01-dsh-system-gap-audit.zh.md","verification":"unverified"}],"counterEvidenceRefs":[{"owner":"repository","kind":"document","id":"docs/audits/2026-10-01-dsh-system-gap-audit.zh.md","verification":"unverified","excerpt":"The audit explicitly describes a snapshot."}]},"completion":"complete"}
/initiative {"action":"read","id":"CANDIDATE_ID","version":2}
/initiative {"action":"promote","key":"audit-human-promotion-1","id":"CANDIDATE_ID","expectedRecordVersion":2,"expectedVersion":2,"rationale":"I want to review this exact hypothesis as a pending Planning Proposal"}
```

在 Planning 读取返回的 Proposal；它保持 pending，直到独立的 Planning 决定。Board 聚合 CAS version 增加，但 canonical items/revisions、lanes 和 Delivery handoffs 不变。晋升失败或中断后，重试完全相同的命令和 key。prepared promotion 冻结 Candidate 的编辑，直到原操作恢复。确定的 Planning CAS 冲突会记录新的固定尝试，要求同 key 重试。

要延后或放弃，使用 `action: disposition`、exact Candidate versions、`status: DEFERRED` 或 `DROPPED`、新 key 和 rationale。用 `status: INVESTIGATING` 重开 deferred Candidate。Agent 工具只能推荐这些结果，不能最终处置。Agent 可在 live turn 观察到有益工作时调用 `initiative_record`；不安装后台触发器。既有工具、credential 和预算不变。

## Verification boundaries

Loader/Commands/Tools 集成测试通过 inert Agent handle 验证 durable owner 与重启恢复，不证明真实模型自主 initiative。基线没有真实 RIR，所以不伪造 Assessment，RIR vertical 保持 blocked。来源定位符和摘录明确为 unverified/unknown/unavailable；提供 digest 不等于核实证据。不要在 Candidate 中保存 credential、secret 或原始 provider payload。
