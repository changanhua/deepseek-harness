# Lesson — Model-visible Context

## Why

Agent 不仅需要能力，还需要在正确时机知道能力和事实存在。把所有 Runtime 信息塞进 prompt 会同时制造 token、陈旧性、权限和噪声问题。

## Objectives

训练 `model_visibility` 与 `seam_selection`。

## Mental Model

把信息面拆成：

```text
push summary      # 少量、稳定、常用
pull introspection # 按需、详细、动态
hidden state       # 不应暴露给模型
```

每个事实还必须问 authority、freshness、scope 和 cost。

## Assignment

为一个 runtime-awareness 需求设计 push/pull 边界，但此阶段不读取现有自定义 runtime-awareness 实现。

## Evidence Required

- `design_push_pull_runtime_awareness_surface`
- `identify_staleness_and_authority_risks`
