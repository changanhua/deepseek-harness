# Lab — Persistence / Restart / Recovery

## Capability Target

`persistence_recovery`, `state_ownership`

## Problem

对一个有 durable task 和 worker 的最小系统，验证“能落盘”不等于“能恢复”。

## Prediction Before Action

先写出：创建、claim、start、success/fail 的状态迁移，以及进程在每个边界崩溃时预期发生什么。

## Tasks

1. 固定一个真实或最小 DSH 持久化实现。
2. 做一次 restart experiment。
3. 制造重复请求或 replay。
4. 制造执行中断并观察恢复语义。
5. 判断是否需要 idempotency、lease、attempt 或其他机制。

## Evidence Required

- `restart_experiment`
- `duplicate_or_replay_experiment`
- `recovery_design_review`
