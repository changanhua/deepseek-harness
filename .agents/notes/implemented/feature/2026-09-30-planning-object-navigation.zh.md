# Agent Note: Planning 导航以 Plan 为中心

Status: implemented

[English](2026-09-30-planning-object-navigation.md) | 中文

## Problem

计划池、完整详情和全部操作挤在同一页面。继续推进 Plan 或 Focus 时需要重建查看上下文，首个探索案例又把领域专用动作放进了通用对象工作区。

## Decision

总览和 Plan 工作页是同一个 Board 上的不同导航状态。当前状态、工作与讨论、思考桌面、历史与来源投影已有事实。项目搜索、筛选、最近明确选择以及各 Plan 的 Focus/tab 都是可丢弃的 Client 交互状态，不授予权限，也不表示正式状态改变。Proposal 审阅保留精确代次采纳和陈旧基础版本拒绝。

继续推进会对照原生 owner 的可用 Session 列表解析精确作用对象。已有绑定保留原 subject 和基础修订。没有仍可用的 Session 时，复用既有原生创建路径，绑定新 Session 后再打开。列表读取失败会停止继续动作，不推断 Session 已不存在。

思考桌面消费通用 Design Case 摘要和 ResourceRef 身份。既有 SBC owner 只返回保留记录，并从当前 Provider 事实计算漂移。摘要读取不创建探索。独立 owner 页面保留原记录键、基线、坐标、选择和撤销。返回时刷新 Planning 并保留查看上下文；导航不会触发变基、Proposal 或正式状态修改。

## Alternatives considered

- 第二份总览或思考状态数据库会与正式 Planning 竞争，并重复生命周期规则。
- 把每个 Plan 当作 SBC Case 会在普通浏览时创建探索，并让产品成为领域专用界面。
- 把 Session 重新绑定到当前选择会抹掉其提案产生时的持久上下文。
- 案例 registry 或完整思考平台没有第二个真实 Consumer，继续延后。

## Consequences

正式状态与探索保留已有 owner 和 schema。只读 adapter 扩展既有 Remote，不扩展 Planning core。UI 检查覆盖 tab 分离、精确作用对象继续推进与非 FC27 摘要；Loader 检查覆盖只读摘要和重启后的探索持久性。组合 Web 检查覆盖原生 Session 绑定/采纳、案例导航、探索保留和可见漂移。个人安装仍是独立交付结论。
