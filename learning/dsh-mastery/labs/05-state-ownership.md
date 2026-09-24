# Lab — State Ownership

## Capability Target

`state_ownership`, `persistence_recovery`, `host_client_boundary`

## Problem

给一个跨 Session 的后台任务系统，要求同时支持模型查询和 Web UI 展示。先决定 authoritative state，再讨论接口。

## Prediction Before Action

分别标出：模型上下文、Session、Service 内存、Durable Store、Worker、本地 UI 状态中哪些是 truth、cache、projection 或 command surface。

## Tasks

1. 画 ownership map。
2. 模拟 Session 关闭。
3. 模拟 Host 重启。
4. 模拟 UI 与后端短暂不同步。
5. 判断哪些状态必须恢复，哪些可以重建。

## Evidence Required

- `ownership_map`
- `crash_scenario_reasoning`
- `projection_vs_truth_classification`
