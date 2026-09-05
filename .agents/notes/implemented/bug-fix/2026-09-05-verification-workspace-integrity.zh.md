# Agent Note: 验证判定必须绑定未变的 Git 输入

Status: implemented

[English](2026-09-05-verification-workspace-integrity.md) | 中文

## 问题

验证命令可以写入自己的检出目录。成功退出并不能证明受检查代码仍对应 Packet 的目标提交。只检查初始提交，会让被修改的源码、索引状态或 HEAD 获得仍标注原目标的判定。

## 决定

[仓库 lease](../../../../packages/delivery/repo-workspace/src/types.ts) 负责与 provider 无关的 `assertUnchanged()` 操作。[Git provider](../../../../packages/delivery/repo-workspace-git-local/README.zh.md) 重新核对检出目录归属、Git 身份、HEAD、索引、已跟踪内容及可能隐藏修改的标志。verifier 在每项已停稳检查的前后等待此操作，无法证明输入时拒绝且不生成 Verdict，并保留检出目录。既有 [Queue 结算负责方](../architecture/2026-08-30-delivery-queue-bridge.zh.md) 将 `workspace-integrity` 映射为不可重试的已启动失败；验收和持久化格式保持不变。

## 考虑过的替代方案

**信任退出码或只在整个计划后检查。** 两者都不能把每项检查绑定到目标：后续检查可能恢复前项检查改动的输入。因此每项检查都有自己的前后观察。

**拒绝所有文件系统写入。** 构建需要未跟踪和被忽略的输出。受保护输入是 Git 索引和已跟踪树，包括已跟踪生成文件；仅写入输出不会使目标失效。

**在本次修复中加入 OS 沙箱。** Windows 约束和恶意同用户写入需要独立执行策略。Git 时点检查修复这条具体的错误判定路径，不宣称持续隔离或原始字节隔离。

## 后果

每项检查增加有界 Git 检查。Git 比较语义仍具有权威性，包括 clean filter。无法检测单项检查内修改后恢复的内容；执行或证据发布失败也可能跳过后置检查，但仍会阻止任何 Verdict。这些失败路径保留既有的停稳后清理行为。

此保证只适用于使用本实现的运行。更新不会重验或作废已经存储的历史 Verdict。Host 配置的 verifier 标识保持不变；它不是历史重验策略。

真实 Git 回归覆盖已跟踪修改、仅暂存修改、索引隐藏标志、HEAD 变化、现场保留、后续检查抑制，以及重启后的验收拒绝。正常检查和未跟踪构建输出仍可接受。构建产物检查使用真实 Git、Subprocess 和证据 provider，独立断言拒绝并保留或通过并移除；不需要 Codex 或模型调用。
