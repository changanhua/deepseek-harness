# Challenge — DSH Architecture Reviewer

## Goal

测试 `architecture_review`：面对一份陌生 DSH 设计，能否在不重写全部方案的前提下找到真正 blocking 的架构问题。

## Input

给出一份包含若干真实或刻意设计缺陷的 proposal / diff / implementation spec。

## Review Dimensions

至少检查：

- seam selection；
- state owner；
- lifecycle / effect ownership；
- host/client boundary；
- persistence / restart / replay；
- concurrency；
- configuration plane；
- model-visible vs operator-visible state；
- hidden state；
- observability；
- verification completeness。

## Required Output

每条 finding 必须包含：severity、evidence、failure scenario、minimal corrective design。避免只写“这里可能有问题”。

## Evidence Required

- `blocking_findings`
- `severity_and_evidence`
- `minimal_corrective_design`

## Exit

Review 需要能抓到设计中大部分关键 blocking flaw，并且误报不能主要来自个人风格偏好。
