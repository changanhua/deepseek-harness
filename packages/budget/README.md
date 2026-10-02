---
description: "User resource budgets shared by Session, Goal and Workflow."
kind: "package-group"
---

# budget/ — resource budgets

English | [中文](README.zh.md)

## Summary

Reserve resources for model requests, retain actual usage and stop further dispatch when outcomes are uncertain. Parent budgets constrain Session, Goal and Workflow children. Token Meter keeps measurement ownership and Queue keeps concurrency ownership.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

Choose the budget owner and mount the bridges for the calling paths.

| Package | Role |
|---|---|
| [`budget`](budget/README.md) | Unified resource limits and accounting contract |
| [`budget-local`](budget-local/README.md) | Durable reservations, decisions, settlement and recovery |
| [`budget-llm`](budget-llm/README.md) | Mandatory final LLM dispatch admission |
| [`budget-agent`](budget-agent/README.md) | Live Session/Goal identities and interactive approval |
| [`budget-workflow`](budget-workflow/README.md) | Shared Workflow run limits and child binding |
| [`command-budget`](command-budget/README.md) | Direct Human settings and receipt inspection |

<a id="related-documentation"></a>
## Related documentation

- [Budget](../../docs/subsystems/budget.md)
- [Setup guide](../../docs/cookbook/trusted-eval-and-budget.md)
- [Eval](../eval/README.md)

<a id="dev-note"></a>
## Dev Note

None.
