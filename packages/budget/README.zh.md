---
description: "统一 Session、Goal 和 Workflow 的用户资源预算。"
kind: "package-group"
---

# budget/ — 资源预算

[English](README.md) | 中文

## 摘要

为模型请求预留资源、保留真实用量，并在不确定时停止继续派发。父预算约束 Session、Goal 和 Workflow 子任务。Token Meter 保留测量职责，Queue 保留并发调度职责。

## 目录

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

选择预算 owner，并按调用路径挂载桥接。

| Package | Role |
|---|---|
| [`budget`](budget/README.zh.md) | 统一资源上限与记账契约 |
| [`budget-local`](budget-local/README.zh.md) | 持久预留、决策、结算和恢复 |
| [`budget-llm`](budget-llm/README.zh.md) | LLM 最终派发准入 |
| [`budget-agent`](budget-agent/README.zh.md) | 存活 Session/Goal 身份与交互审批 |
| [`budget-workflow`](budget-workflow/README.zh.md) | 共享 Workflow 运行上限与子任务绑定 |
| [`command-budget`](command-budget/README.zh.md) | 人工设置与回执检查 |

<a id="related-documentation"></a>
## Related documentation

- [Budget](../../docs/subsystems/budget.zh.md)
- [Setup guide](../../docs/cookbook/trusted-eval-and-budget.zh.md)
- [Eval](../eval/README.zh.md)

<a id="dev-note"></a>
## Dev Note

无。
