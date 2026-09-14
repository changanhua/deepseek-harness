# Agent Note: 收敛 upstream 合并与分叉运行时契约

Status: implemented

[English](2026-09-14-upstream-merge-reconciliation.md) | 中文

## 问题

分叉已经有一个完成的 upstream 合并提交，但合并后的树仍需在 upstream 不负责的边界上做收敛：个人包 catalog、Queue 与浏览器组合、Windows Web 回放夹具，以及分叉自己的连接恢复和设置行为。如果不留下明确记录，下一次同步可能把生成物漂移或平台专属回放细节误判成 upstream 行为，或者误判成新的分叉差异。

## 决策

分叉保留合并提交 `70a90814cb`，并把 `c291e7961a515f6d7af9304e7fd1d257929aef26` 记录为受支持的 upstream 基线。本次收敛恢复 standard preset 中 upstream 的 `present` 行，保留分叉的连接恢复指示器，隔离设置脚手架 Queue，并让 minimal preset 在 Windows 与 POSIX 使用当前单一持久 shell 组合。Cordis 与 tool catalog 现在枚举合并后的个人服务和 task-queue 工具；client 与 persistence catalog 也已从源代码重新生成。Web 回放预期只在当前运行时契约确实变化处刷新，Windows 专属的 shell 与路径处理保留在其所属测试中。

完整文档门槛被当作基线报告，而不是豁免：生成 catalog 的定向检查、类型检查、构建以及所属 Web 场景是本次合并的证据；既有文档债务单独列出，留待后续清理。

## 考虑过的替代方案

**重写合并提交。** 重写会丢失冲突解决的祖先关系，使 upstream 基线更难审计。

**把所有失败的文档预期都塞进本次合并。** 这样会把无关的 README、链接、JSDoc 和类型等价债务混入运行时收敛，反而看不清合并实际改变了什么行为。

**保留旧的 minimal 双工具 preset 和仅 Bash 的夹具。** 这会在 Windows 上保留过时行为并掩盖当前 upstream 的单 shell 契约；按平台断言是更小的兼容面。

## 影响

候选分支保持在 upstream 之上且没有落后提交，也不会推送。生成的 catalog 以及 standard/minimal preset 现在与合并后的源代码一致；分叉特有的 Queue、浏览器、runtime-facts、capability 和 delivery 面仍是已记录的刻意差异。仓库级 `doc-sync` 仍会报告基线失败；后续文档工作必须以本次收敛结果对照，不能把那些失败归因于本次合并。
