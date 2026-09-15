# Case Study — task_queue

## Problem Only

让 DSH 能创建、消费、恢复和查询后台任务，任务不能因为当前 turn、session 或进程结束而错误丢失。

在产生 independent reconstruction evidence 前，不读取现有本地 `task_queue` 设计作为答案。

## Independent Reconstruction

先定义：command surface、queue/service owner、durable truth、worker、claim/start/success/fail 生命周期、restart/recovery、replay/idempotency、UI/model projection。

## Source Investigation

再对照当前 DSH 中最邻近的 durable job / persistence / worker / tool precedent，并阅读本地旧实现。

## Review Focus

- Queue 是否真的被消费；
- authoritative state 是否明确；
- claim 与 start 是否混淆；
- worker 崩溃后是否可恢复；
- lease/attempt 是否有必要且语义正确；
- model surface 是否只是“创建了记录”而没有真正赋能执行系统。

## Evidence Required

- `independent_design_before_reveal`
- `failure_scenarios`
- `redesigned_lifecycle`
