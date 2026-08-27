# Lab — Trace One Real DSH Request

## Capability Target

`source_navigation`, `request_tracing`, `runtime_mental_model`

## Problem

选择一次真实 DSH 用户请求，从入口开始追到模型调用；如果发生 Tool Call，再继续追到工具结果被记录并进入后续上下文。

## Prediction Before Action

在搜索源码前先画出你预计的路径，并标记：Session、Agent Loop、Model、Tool execution、record/persistence 可能出现在哪里。

## Tasks

1. 固定当前 repository commit。
2. 找入口，不允许先看完整架构总结。
3. 每一步只记录“谁调用谁、输入输出、状态变化、文件位置”。
4. 把预测图与真实 trace 对比。
5. 选一个不同请求，验证同一心智模型是否还能迁移。

## Verification

最终 trace 必须包含具体文件/符号证据，并能解释“下一轮模型为什么能看到上一轮 Tool Result”。

## Evidence Required

- `source_trace_with_files_and_responsibilities`
- `prediction_vs_actual_diff`
