# Agent Note: Delivery Case 修订保留权威信息并提供执行前提输入

Status: implemented

[English](2026-09-05-delivery-case-form-readiness.md) | 中文

## 问题

如果唯一的修订表单始终省略验证来源，本地想法就无法进入执行。仅用可见字段重建修订，还会丢弃其他入口提供的限制、未决问题、参考链接和条款标识。

## 决定

[Delivery 工作台](../../../../packages/client/ui-delivery/README.zh.md)编辑现有 Contract 修订模型。表单提供基线选择与现有的两种验证来源。程序参数单独传递，计划解析、schema 执行、需求批准和 Packet 标识继续归既有 Host 所有者负责。

未编辑字段保留已记录值。条款文本不变时保留原标识，修改检查项名称或超时不会重新解释其参数数组。浏览器仅将 `HEAD` 作为缺失基线的初始值，不猜测仓库分支名。

## 考虑过的替代方案

**放宽就绪条件或提供总会成功的占位检查。** 拒绝，因为可执行 Packet 需要 operator 实际选择的验证计划。

**新建浏览器专属合同或执行器路径。** 拒绝，因为现有 Remote 和 Delivery 模型已支持这些输入；第二套模型会带来转换与所有权偏移。

## 影响

想法记录仍保持轻量。推进 Case 需要明确执行输入，同时不会擦除表单未编辑的约束。浏览器测试沿真实 Web/Delivery 组合，在分支名为 `master` 的仓库中推进到 Packet 创建；这条纯人工流程不调用模型，也不证明 Codex 执行或 verifier 正确性。
