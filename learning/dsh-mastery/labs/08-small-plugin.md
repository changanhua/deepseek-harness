# Lab — Build and Explain a Small Plugin

## Capability Target

`seam_selection`, `cordis_lifecycle`, `capability_boundary`, `source_navigation`

## Problem

选择一个职责单一、无复杂 durable orchestration 的能力，先设计其 DSH seam，再做最小实现。

## Prediction Before Action

在编码前写出：Host/Client 归属、依赖 service、是否需要 Tool、state owner、生命周期资源、验证面。

## Tasks

1. 找一个当前官方最邻近 precedent。
2. 解释哪些结构是框架 contract，哪些只是该包的实现选择。
3. 做最小实现。
4. 运行测试或真实组合验证。
5. 写 Architecture Delta：以前没有什么、现在新增了什么、为什么放这里。

## Evidence Required

- `working_change`
- `tests_or_runtime_verification`
- `architecture_delta_explanation`
