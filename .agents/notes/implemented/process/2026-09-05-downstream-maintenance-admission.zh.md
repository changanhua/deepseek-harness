# Agent Note: 下游维护准入

Status: implemented

[English](2026-09-05-downstream-maintenance-admission.md) | 中文

## Problem

upstream canary 可以检测官版 drift，却不能授权同步。此前 merge 流程可能在一份机器报告固定目标、patch 影响、清理状态和证据计划前，就 fetch 并 merge 持续移动的 remote-tracking branch。因此，技术上干净的 merge 仍可能在审查期间扩大，或污染用户日常 checkout。

新的个人行为也存在类似歧义。DSH 提供官版 service、Profile、plugin、slot、个人 package、Bundle、适配器和上游 extension seam，而 `core-patches.json` 只守住最终 core 修改边界。如果没有一个放置顺序，便利性 patch 可能绕过更低扩展点，或者适配器可能暗中变成第二个事实所有者。

## Decision

[`scripts/upstream-sync-dry-run.ts`](../../../../scripts/upstream-sync-dry-run.ts) 是机械式准入前 rehearsal。它要求 source checkout 干净且没有正在进行的 Git 操作，根据 `upstream-base.json` 验证 upstream remote，解析一个官版 branch SHA，通过已验证 URL fetch 到唯一临时 ref，并拒绝目标漂移。它比较受支持 base 和目标，对个人 HEAD 运行 `merge-tree`，归组 package 路径、映射有效 patch 并分类冲突。

干净临时树会被包装成不受 ref 引用的双 parent commit，并在系统临时目录中以 detached worktree 物化一次。脚本验证该 checkout 干净、删除它、删除准确临时 ref，并证明没有遗留临时或 remote-tracking ref。它可能增加由正常垃圾回收后续删除的不可达 Git object。它不会解决冲突、准入、commit、push、发布、更新 `FETCH_HEAD` 或修改 source worktree。

[功能放置政策](../../../../docs/downstream/feature-placement.zh.md)使用以下 first-fit 顺序：官版能力、配置/Profile、Plugin/Slot、`@changanhua` package、Bundle、Compatibility Adapter、通用上游 seam，最后是私人 core patch。第一个层级必须满足完整生命周期、权限、事实所有权、副作用、恢复和验证需求；代码更少不能成为选择较弱所有者的理由。

Bundle 仍只负责 composition。Compatibility Adapter 保持 `factOwnershipEffect: "none"`。Queue、Delivery、repository workspace、evidence 和其他领域保留现有事实所有者。个人增量矩阵是解释性内容，派生自 `downstream/package-identities.json`、`core-patches.json`、package source 和当前 composition；它不是新的持久放置 registry 或控制面。

`dsh-merge-upstream` Skill 会消费[同步 SOP](../../../../docs/downstream/upstream-sync.zh.md)，把固定目标带入独立具名 worktree，并让冲突决定、base 准入、commit、push、发布和清理保持为不同动作。Windows 是阻断式个人兼容性载体；除非改动结论拥有可移植或 Linux 专属约定，否则 Linux 保持建议性。

## Alternatives considered

**快速 fetch 后 merge `upstream/master`。** 不采用，因为目标可能在评估、冲突解决和验证之间移动。一次同步决定必须命名一个 commit。

**只使用 `merge-tree` 输出而不物化。** 不采用，因为干净 tree hash 本身不能证明 Git 可以把结果树 checkout 为干净 worktree。临时 checkout 增加了这项有界机械证明，但不会变成实际 merge workspace。

**把所有个人行为放进一个下游 package 或 Bundle。** 不采用，因为 Queue、Delivery、runtime fact、evidence、repository workspace、UI 和 adapter 具有不同权限和生命周期。Bundle 可以选择它们，但不能拥有它们的状态机。

**把放置矩阵变成另一个 JSON registry。** 不采用，因为 package 来源和 core-patch 清单已经有机器所有者，domain service 则拥有 runtime 事实。第三个 registry 会复制并漂移这些事实。

**根据冲突分类自动删除或保留 patch。** 不采用，因为路径匹配无法证明语义等价、数据兼容、权限或已接受的产品行为。脚本负责分类，维护者负责决定。

## Consequences

每次同步都从可复现目标与一份不会改变 source branch、index、working file、remote-tracking ref 或用户数据的报告开始。干净的机械 rehearsal 可以低成本重复，而后续具名 merge worktree 仍是显式准入动作。

每项个人功能在消耗私人 core 预算前，必须说明每个更低放置层级为何失败。通用可靠性修复可以保持 `upstream-candidate`；个人状态与 workflow 留在 `@changanhua` package；adapter 和 Bundle 不能吸收不属于自己的事实。

针对具体 release 的 merge Agent Note 仍是其真实 reconciliation 的有效记录，没有被本流程决定取代。[core patch 预算](2026-09-05-downstream-core-patch-budget.zh.md)、[upstream canary](2026-09-05-read-only-upstream-compatibility-canary.zh.md)和 [Windows 平台路由](2026-09-05-personal-windows-platform-routing.zh.md)也保留各自独立所有权。本决定不会新增 push、merge 个人 `master`、部署或发布权限。
