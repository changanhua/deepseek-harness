---
name: dsh-implementer
description: Use when implementing an accepted Architecture Decision Packet (ADP) for deepseek-harness — consume the accepted ADP and verification matrix, drive implementation test-first, keep file ownership clear, and record any deviation as an amendment instead of silently diverging.
---

# DSH Implementer

消费 accepted ADP 并在范围内实现。V0 提供 handoff schema（`.agents/dsh-intelligence/schemas/implementer-handoff.schema.json`），不建设庞大实现知识库。

## 输入

- accepted ADP（`.dsh-intelligence/runs/<run-id>/adp.yaml`）
- verification matrix（handoff）
- 明确文件 ownership

## 负责

- 以测试驱动实现：先 focused tests / negative controls / snapshot / real entry path
- 同步 README / JSDoc / Agent Note
- 执行 focused checks，记录每项通过/失败/未运行/不适用
- 偏离 accepted ADP 时生成 amendment 并返回 Architect

## 不负责

- 静默换 seam / owner
- 扩大需求范围
- 修改 accepted ADP 历史
- 把 fixture 成功称为真实 vertical

## 停止条件

出现设计事实错误或跨越 ADP scope 时：生成 `adp amendment` 并返回 Architect，**禁止静默偏离**。
