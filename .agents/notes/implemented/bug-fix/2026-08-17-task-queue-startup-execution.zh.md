# Agent Note: 任务队列启动阶段保持执行就绪

Status: implemented

[English](2026-08-17-task-queue-startup-execution.md) | 中文

## 问题

`LocalTaskQueue` 在异步恢复仍读取持久日志时就启动了调度器。入队或领取可能先更新内存折叠结果，随后被迟到的旧恢复结果覆盖，使持久任务停在 `starting`，既没有 spawn 也没有结算。服务还在未声明插件依赖的情况下访问 `ctx.subprocess`，因此 spawn 路径可能在 task-queue 插件 fiber 中等待服务解析。

## 决策

`LocalTaskQueue` 声明 `static inject = ['subprocess']`，因此 Cordis 只会在可用 subprocess 提供方存在时加载它。服务在注册生命周期调度器前启动启动恢复，并将该操作保存为 `bootPromise`。调度器只在该 Promise 结算后启动；现有 fault 处理仍负责决定服务状态。工具入队、取消、重试和通知确认在执行持久 mutation 前等待同一个 Promise，因此启动失败会进入既有的 `faulted` 准入检查，而不会与恢复竞争。

生命周期回归测试让真实 `TaskQueueStore.recover()` 在读出旧日志后延迟返回，在该期间发起入队，并通过 `LocalSubprocessRuntime` 将任务运行到成功终态。原行为会让任务停在 `starting`；当前实现保留任务并完成 subprocess。

## 考虑过的替代方案

**只在恢复后启动调度器，但允许立即 mutation。** 迟到的恢复结果仍可能覆盖早期入队写入的内存状态，因此不能关闭覆盖竞态。

**按更大的 seq 选择恢复结果。** 当持久日志已有记录、内存尚未完成 hydration 且新 mutation 已请求时，这不能安全定义初始内存状态；由就绪顺序承担生命周期约束更直接。

**让 `spawnAndMark` 重试或把缺失任务当成失败。** 这只是在任务已经被抹掉后处理症状，可能丢失原本的执行，也不能保留持久入队或修复 subprocess 依赖解析。

## 后果

初始持久 mutation 会等待队列恢复完成，队列也不会在内存状态建立前调度任务。缺少 subprocess 提供方会阻止 task-queue 插件变为可用状态。现有粘性 `faulted` 协议继续负责恢复与存储失败。task-queue-local 的聚焦测试覆盖了新的生命周期路径；重建 host 产物后，独立真实组件复现通过。
