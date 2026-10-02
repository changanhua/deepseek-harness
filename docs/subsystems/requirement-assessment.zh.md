# Requirement Assessment

[English](requirement-assessment.md) | 中文

## Ownership

[requirement-assessment 包组](../../packages/requirement-assessment/README.zh.md)拥有不可变投资评估、固定输入与请求回执。Planning 保留 Plan / Focus 状态，执行授权仍由现有 owner 持有。

## Contracts

[domain schema](../../packages/requirement-assessment/requirement-assessment/src/schema.ts)验证维度、反事实测试、分配类别、路线，以及基线与输入一致性。可信 Host access 提供 actor 与 workspace identity，浏览器和模型数据不能产生授权。

本地 provider 拥有有界的原子记录与排他文件系统占用。已完成请求重放其不可变结果。持久 pending 请求在模型消耗不确定后不自动重试，需要用户显式开始新请求。

review runner 在通过现有 LLM runtime 进行一次有界调用前固定 subject 输入。它不提供可执行工具，并在持久化前验证输出。Remote 验证 workspace 归属，只派生 drift，不修改 Planning。

## Consumer integration

可选[客户端 UI](../../packages/client/ui-requirement-assessment/README.zh.md)使用生成的 assessment Remote 及 Planning 拥有的 subject-action slot。[WP1 规格](../specs/2026-10-01-requirement-investment-review-wp1.md)定义范围与真实案例验收。
