# Requirement Assessment

English | [中文](requirement-assessment.zh.md)

## Ownership

The [requirement-assessment group](../../packages/requirement-assessment/README.md) owns immutable investment assessments, frozen inputs, and request receipts. Planning retains Plan / Focus state and execution authority remains with existing owners.

## Contracts

The [domain schema](../../packages/requirement-assessment/requirement-assessment/src/schema.ts) validates exact dimensions, stress tests, allocation categories, routes, and baseline/input consistency. Trusted Host access supplies actor and workspace identity; browser and model data cannot mint authority.

The local provider owns bounded atomic records and exclusive filesystem ownership. Completed requests replay their immutable result. A durable pending request is not automatically retried after uncertain model consumption; a user must explicitly start a new request.

The review runner captures subject input before one bounded call through the existing LLM runtime. It supplies no executable tools and validates output before persistence. The Remote validates workspace membership and derives drift without mutating Planning.

## Consumer integration

The optional [client UI](../../packages/client/ui-requirement-assessment/README.md) uses the generated assessment Remote and a Planning-owned subject-action slot. The [WP1 specification](../specs/2026-10-01-requirement-investment-review-wp1.md) owns scope and real-case acceptance.
