# Case Study — <title>

## Problem Only

只给原始问题、约束和目标。此阶段不要泄露旧实现。

## Independent Reconstruction

学习者先提交：

- SEE / ACT / OWN / SURVIVE；
- 五层映射；
- seam 选择；
- authoritative state；
- lifecycle / recovery；
- 至少两个候选方案；
- verification plan。

先把这一阶段写入 evidence，再继续。

## Source Investigation

读取当前 DSH precedent 和目标自定义实现，记录版本与关键源码路径。

## Existing Design

还原现有实现真正做了什么，而不是只总结 README。

## Review

分别记录：

- sound decisions；
- accidental implementation choices；
- blocking flaws；
- missing semantics；
- outdated assumptions。

## Redesign

根据 evidence 和当前源码重新设计；明确与最初 independent reconstruction 的差异。

## Transferable Patterns

只提炼能够迁移到其他问题的规律，不把一次成功实现自动提升为框架 contract。

## Evidence Required

至少保留 independent design、source evidence、review findings 和 redesigned contract。
