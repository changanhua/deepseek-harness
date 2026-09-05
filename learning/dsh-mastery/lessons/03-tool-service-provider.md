# Lesson — Tool / Service / Provider

## Why

很多 Agent 设计错误来自把“模型能调用的接口”误当成“系统真正的业务能力”，或者把可替换实现直接写死进调用面。

## Objectives

训练 `capability_boundary` 与 `seam_selection`。

## Mental Model

```text
Model
  ↓
Tool          # model-facing command surface
  ↓
Service       # domain capability / ownership boundary
  ↓
Provider      # replaceable implementation when needed
```

这只是起始模型，具体 DSH 实现必须回到当前源码取证。

## Assignment

对至少 5 个未见过的需求分类：主要需要 Tool、Service、Provider 还是组合；每个例子都要解释为什么另外两个选择不够。

## Knowledge Check

重点测试：什么时候一个 Tool 足够；什么时候必须有独立 Service；什么时候 Provider 才真正有价值。

## Evidence Required

- `classify_unseen_capability_examples`
- `defend_two_rejected_alternatives`
