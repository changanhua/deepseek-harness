# Agent Note: Work Observatory 将人类活动证据与 Agent 步骤时间分离

Status: implemented

[English](2026-08-22-work-observatory-accounting.md) | 中文

## Problem

DSH 需要持久化的协作指标，但不能把打开浏览器标签页当成人类活动证据，不能重复计算并发 Agent 工作，也不能把运行遥测写入模型可见的 Session 日志。

## Decision

Work Observatory 使用独立的 SQLite accounting store。`@deepseek-ai/dsh-client-ui-work-observatory` 的 Client 插件 `apply()` 会安装针对主文档、App 级别的活动生产器；它通过 BFF Remote 报告带类型的可见性与近期交互快照，绝不导入 Host runtime。每个文档生命周期拥有内存中的 client 身份和单调序列，并提供即时状态转换、本地 60 秒 idle 结束以及可见期间每 15 秒心跳。

Host 为接受的观测加上自己的时间戳，拒绝无效或乱序状态，并从收到的证据推导 Human Active 与 Page Visible 区间。Agent Running 从规范的串行 step bracket 投影而来，range 结果使用归一化的半开区间代数计算 Human Active、Page Visible、Agent Running、Together 和 Agent Solo。Client 包注册无界面的应用级 tracker 和一个只读的工作观测设置分区，该分区从一段 Host range 渲染五个指标与三条归一化时间线；tracker 保持应用级生命周期，与分区生命周期相互独立。

## Alternatives considered

**用页面打开到卸载的时间作为工作时间。** 否决，因为后台、遗弃和崩溃的标签页不能证明有人类活动。

**把 tracker 挂在 Observatory Settings 页面内部。** 否决，因为那会测量 dashboard 浏览时间，而不是主 DSH 应用中的工作时间。

**使用浏览器时间戳或累加 Agent 组件时长。** 否决，因为浏览器时钟不是 Host accounting 时钟，并发或嵌套工作会重复计算 wall time。

**把浏览器活动追加到 Session 日志。** 否决，因为这些数据是运行遥测，不是模型可见的对话事实。

## Consequences

设计采取保守计量：消失的浏览器只贡献最后一次接受证据覆盖的时间，V1 中一个 Host 会合并所有浏览器文档实例。该包没有持久 outbox、跨标签页身份、用户或租户归属、生产力解释。这些限制保持了小而可审计的 accounting 核心，并让后续归属决策保持独立。
